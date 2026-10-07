'use strict';

// Explicit simulated fixture. Uses Strapi documents so defaults and relations
// follow the application's models. Never changes credentials or pilot records.
const assert = require('node:assert/strict');
const { compileStrapi, createStrapi } = require('@strapi/strapi');
const { snapshot } = require('./seed-phase5b-transfer-research');
const { driverVariantEligibility } = require('../src/services/driver-trip/driver-trip-policy');

const ROUTE_CODE = 'DEMO-MEX-CSF-DRIVER-001';
const VEHICLE_NUMBER = 'DEMO-MEX-CSF-JEEP-001';
const NODE_SOURCES = [
  ['PSU', 'RCH-PSU-MEXICO-FRONT'],
  ['SM', 'RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF'],
  ['ROB', 'RCH-ROB-STARMILLS-ARAYAT-GATE-LOAD'],
];
const VARIANTS = [
  { suffix: 'OUT', direction: 'OUTBOUND', source: 'RCH-SJ-SMROB-OUT', start: 'PSU', end: 'SM' },
  { suffix: 'IN', direction: 'INBOUND', source: 'RCH-SJ-SMROB-IN', start: 'ROB', end: 'PSU' },
];
const doc = (app, name) => app.documents(`api::${name}.${name}`);

async function inspect(app, username) {
  const user = await app.db.query('plugin::users-permissions.user').findOne({ where: { username }, populate: ['role'] });
  assert.ok(user, `Account ${username} does not exist. Create a Driver-role app user first.`);
  assert.equal(user.role?.name, 'Driver', 'Account must have the Driver role.');
  assert.equal(user.blocked, false, 'Account is blocked.');
  const driver = await doc(app, 'driver').findFirst({ filters: { user: { id: user.id } }, populate: ['vehicle'] });
  if (driver) {
    assert.equal(driver.data_mode, 'SIMULATED', 'Refusing to modify a REAL Driver.');
    assert.equal(driver.driver_status, 'active', 'Driver must be active.');
    assert.ok(!driver.vehicle || driver.vehicle.vehicle_number === VEHICLE_NUMBER, 'Driver already has another vehicle; no assignment was replaced.');
  }
  const nodes = {};
  for (const [key, code] of NODE_SOURCES) {
    nodes[key] = await doc(app, 'transport-node').findFirst({ filters: { node_code: code } });
    assert.ok(nodes[key]?.latitude && nodes[key]?.longitude, `Missing source node ${code}`);
  }
  const variants = {};
  for (const v of VARIANTS) {
    variants[v.suffix] = await doc(app, 'route-variant').findFirst({ filters: { variant_code: v.source } });
    assert.ok(variants[v.suffix], `Missing source variant ${v.source}`);
  }
  return { user, driver, nodes, variants };
}

async function ensure(app, name, field, value, data, created) {
  const existing = await doc(app, name).findFirst({ filters: { [field]: value } });
  if (existing) {
    assert.equal(existing.data_mode, 'SIMULATED', `Existing ${value} is not simulated.`);
    // Do not reset live occupancy, vehicle state, or manually edited records.
    for (const key of ['source_reference', 'capacity', 'vehicle_type']) {
      if (data[key] !== undefined) assert.equal(existing[key], data[key], `${value}.${key} differs.`);
    }
    return existing;
  }
  const record = await doc(app, name).create({ data: { ...data, [field]: value } });
  created.push({ type: name, documentId: record.documentId, label: value });
  return record;
}

// Strapi 5.52 runs document events asynchronously after transaction commit.
// Wait for their hydration/listeners before destroying a standalone instance.
async function withEntryEvents(app, operation) {
  const seen = new Set();
  let expected;
  let resolve;
  const done = new Promise(r => { resolve = r; });
  const check = () => { if (expected && expected.every(key => seen.has(key))) resolve(); };
  const unsubscribe = app.eventHub.subscribe((event, payload) => {
    seen.add(`${event}:${payload?.entry?.documentId}`);
    check();
  });
  let timer;
  try {
    const result = await operation();
    expected = result.events || [];
    check();
    await Promise.race([done, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Document events did not finish within 15 seconds.')), 15000); })]);
    const { events, ...publicResult } = result;
    return publicResult;
  } finally { clearTimeout(timer); unsubscribe(); }
}

async function seed(app, context) {
  const created = [];
  let assignedExisting = false;
  return withEntryEvents(app, () => app.db.transaction(async ({ trx }) => {
    await trx.raw("set local lock_timeout = '5s'");
    await trx.raw("set local statement_timeout = '30s'");
    await trx.raw("select pg_advisory_xact_lock(hashtext('pamana-driver-demo-001'))");
    const adapter = { query: sql => trx.raw(sql) };
    const before = await snapshot(adapter);
    const trust = {
      data_mode: 'SIMULATED', verification_status: 'SIMULATED_DEMO', planning_enabled: true,
      verified_at: '2026-10-06T00:00:00.000Z', source_name: 'PAMANA driver testing fixture',
      source_reference: 'scripts/seed-driver-demo.js; SIMULATED copies of current pilot locations/geometry',
      notes: 'Fictional service for driver testing. Copied map references do not establish a real operator, vehicle, or service.',
    };
    const nodes = {};
    for (const [key] of NODE_SOURCES) {
      const source = context.nodes[key];
      nodes[key] = await ensure(app, 'transport-node', 'node_code', `DEMO-DRIVER-${key}`, {
        ...trust, name: `DEMO · ${source.name}`, node_type: source.node_type,
        latitude: source.latitude, longitude: source.longitude,
        municipality_city: source.municipality_city, province: source.province,
      }, created);
    }
    const route = await ensure(app, 'route', 'route_code', ROUTE_CODE, {
      ...trust, route_name: 'DEMO · Mexico / PSU – San Fernando / SM–Robinsons',
      origin: 'PSU Mexico / San Juan', destination: 'SM Pampanga / Robinsons Starmills',
      transport_mode: 'jeepney', route_status: 'active', active: true,
    }, created);
    const variants = [];
    for (const v of VARIANTS) {
      const variant = await ensure(app, 'route-variant', 'variant_code', `${ROUTE_CODE}-${v.suffix}`, {
        ...trust, display_name: `DEMO · ${v.direction === 'OUTBOUND' ? 'PSU Mexico → SM Pampanga' : 'Robinsons Starmills → PSU Mexico'}`,
        direction: v.direction, route: route.documentId, operating_status: 'ACTIVE',
        start_node: nodes[v.start].documentId, end_node: nodes[v.end].documentId,
        signboard_text: `DEMO ONLY · ${v.end === 'SM' ? 'SM Pampanga' : 'PSU Mexico'}`,
        geometry_source: context.variants[v.suffix].geometry_geojson ? 'SIMULATED' : 'UNKNOWN',
        geometry_geojson: context.variants[v.suffix].geometry_geojson || null,
      }, created);
      const stops = await doc(app, 'route-variant-stop').findMany({ filters: { route_variant: { documentId: variant.documentId } }, populate: ['transport_node'], sort: ['sequence:asc'] });
      if (!stops.length) {
        for (const [index, key] of [v.start, v.end].entries()) {
          const stop = await doc(app, 'route-variant-stop').create({ data: {
            route_variant: variant.documentId, transport_node: nodes[key].documentId, sequence: index + 1,
            pickup_allowed: index === 0, dropoff_allowed: index === 1,
            transfer_allowed: false, is_timepoint: true,
            instruction_template: 'SIMULATED driver-test stop; not a verified operating service.',
          } });
          created.push({ type: 'route-variant-stop', documentId: stop.documentId, label: `${v.suffix} stop ${index + 1}` });
        }
      } else {
        assert.deepEqual(stops.map(s => [s.sequence, s.transport_node?.documentId]), [[1, nodes[v.start].documentId], [2, nodes[v.end].documentId]], 'Demo stops were edited; no replacement performed.');
      }
      variants.push(variant);
    }
    const vehicle = await ensure(app, 'vehicle', 'vehicle_number', VEHICLE_NUMBER, {
      plate_number: 'DEMO-TEST-001', vehicle_type: 'jeepney', capacity: 20,
      current_occupancy: 0, occupancy_level: 'empty', vehicle_status: 'available',
      data_mode: 'SIMULATED', route: route.documentId,
    }, created);
    const owner = await doc(app, 'driver').findFirst({ filters: { vehicle: { documentId: vehicle.documentId } }, populate: ['user'] });
    assert.ok(!owner || owner.user?.id === context.user.id, 'Demo vehicle already belongs to another account; no assignment was replaced.');
    let driver = context.driver;
    if (!driver) {
      driver = await doc(app, 'driver').create({ data: {
        driver_number: `DEMO-DRIVER-${context.user.id}`, first_name: 'Demo', last_name: 'Driver',
        driver_status: 'active', data_mode: 'SIMULATED', user: context.user.id, vehicle: vehicle.documentId,
      } });
      created.push({ type: 'driver', documentId: driver.documentId, label: driver.driver_number });
    } else if (!driver.vehicle) {
      driver = await doc(app, 'driver').update({ documentId: driver.documentId, data: { vehicle: vehicle.documentId } });
      assignedExisting = true;
    }
    const assigned = await doc(app, 'driver').findOne({ documentId: driver.documentId, populate: { vehicle: { populate: ['route'] } } });
    assert.equal(assigned.vehicle?.documentId, vehicle.documentId);
    assert.equal(assigned.vehicle.route?.documentId, route.documentId);
    for (const variant of variants) {
      const populated = await doc(app, 'route-variant').findOne({ documentId: variant.documentId, populate: ['route'] });
      const eligibility = driverVariantEligibility({ driver: assigned, vehicle: assigned.vehicle, route: assigned.vehicle.route, variant: populated });
      assert.ok(eligibility.eligible, `Demo route is not startable: ${eligibility.reasons.join(', ')}`);
    }
    const after = await snapshot(adapter);
    for (const [table, rows] of Object.entries(before)) {
      const current = new Map(after[table].map(r => [r.id, r.hash]));
      for (const row of rows) {
        if (table === 'drivers' && row.id === driver.id) continue; // Authorized vehicle assignment.
        assert.equal(current.get(row.id), row.hash, `Existing ${table} row ${row.id} changed.`);
      }
    }
    return { username: context.user.username, driver: driver.driver_number, vehicle: vehicle.vehicle_number, plate: vehicle.plate_number, capacity: vehicle.capacity, route: route.route_code, variants: variants.map(v => v.variant_code), dataMode: 'SIMULATED', created, existingRecordsPreserved: true,
      events: [...created.map(r => `entry.create:${r.documentId}`), ...(assignedExisting ? [`entry.update:${driver.documentId}`] : [])] };
  }));
}

async function main() {
  const username = process.argv.find(a => a.startsWith('--username='))?.slice(11) || 'driver';
  const app = await createStrapi(await compileStrapi()).load();
  try {
    const context = await inspect(app, username);
    if (!process.argv.includes('--apply')) {
      console.log(JSON.stringify({ mode: 'read-only preview', username, existingDriver: context.driver?.driver_number || null, vehicle: VEHICLE_NUMBER, route: ROUTE_CODE, directions: ['OUTBOUND', 'INBOUND'], nodes: 3, stops: 4, dataMode: 'SIMULATED' }, null, 2));
      return;
    }
    console.log(JSON.stringify(await seed(app, context), null, 2));
  } finally { await app.destroy(); }
}
if (require.main === module) main().catch(error => { console.error(`Driver demo seed failed: ${error.message}`); process.exitCode = 1; });
module.exports = { inspect, seed, withEntryEvents, ROUTE_CODE, VEHICLE_NUMBER };
