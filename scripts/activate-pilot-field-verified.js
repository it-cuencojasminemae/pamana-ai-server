'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const manifest = require('./data/pilot-mexico-san-fernando-field-verified.json');
const { connect, snapshot } = require('./seed-phase5b-transfer-research');
const { planningEligibilityFor } = require('../src/services/transport-data/planning-eligibility');
const { routeVariantPlanningEligibilityFor } = require('../src/services/pamana-journey/graph-builder');

const VERIFIED_AT = manifest.verification.verified_at;
const ACTIVATION_REFERENCE = manifest.verification.source_reference;
const CODE_FIELDS = Object.freeze({
  transport_nodes: 'node_code', routes: 'route_code', route_variants: 'variant_code',
});
const COUNT_TABLES = Object.freeze([
  'transport_nodes', 'routes', 'route_variants', 'route_variant_stops', 'fare_rules', 'service_patterns',
]);
const LOCK_TABLES = Object.freeze([
  ...COUNT_TABLES,
  'route_variants_route_lnk', 'route_variants_start_node_lnk', 'route_variants_end_node_lnk',
  'route_variant_stops_route_variant_lnk', 'route_variant_stops_transport_node_lnk',
  'fare_rules_route_variant_lnk',
]);

const documentId = () => crypto.randomBytes(12).toString('hex');

function validateManifest() {
  assert.equal(manifest.manifest_version, '1.0.0');
  assert.equal(manifest.activation, 'PILOT-MEXICO-SAN-FERNANDO-2026-09-27');
  assert.equal(manifest.verification.status, 'FIELD_VERIFIED');
  assert.equal(manifest.verification.data_mode, 'REAL');
  assert.equal(manifest.nodes.length, 4);
  assert.equal(new Set(manifest.nodes.map((item) => item.node_code)).size, 4);
  assert.equal(manifest.routes.filter((item) => item.create).length, 1);
  assert.equal(manifest.variants.length, 4);
  assert.equal(manifest.stops.length, 8);
  assert.equal(manifest.fare_rules.length, 2);
  assert.deepEqual(manifest.service_patterns, []);
  for (const variant of manifest.variants) {
    assert.ok(manifest.stops.filter((stop) => stop.variant_code === variant.variant_code).length === 2);
  }
  for (const fare of manifest.fare_rules) {
    assert.equal(Object.hasOwn(fare, 'student_discount_percent'), false);
  }
}

function commonEvidence(notes) {
  return {
    verification_status: manifest.verification.status,
    data_mode: manifest.verification.data_mode,
    verified_at: VERIFIED_AT,
    source_name: manifest.verification.source_name,
    source_url: null,
    source_reference: ACTIVATION_REFERENCE,
    notes,
  };
}

function sameValue(current, desired) {
  if (current == null || desired == null) return current == null && desired == null;
  if (current instanceof Date && /^\d{4}-\d{2}-\d{2}$/.test(String(desired))) {
    const localDate = [current.getFullYear(), String(current.getMonth() + 1).padStart(2, '0'),
      String(current.getDate()).padStart(2, '0')].join('-');
    return localDate === desired;
  }
  if (current instanceof Date || /T\d\d:\d\d/.test(String(desired))) {
    const left = new Date(current).getTime();
    const right = new Date(desired).getTime();
    if (Number.isFinite(left) && Number.isFinite(right)) return left === right;
  }
  if (typeof desired === 'number') return Number(current) === desired;
  if (typeof desired === 'object') return JSON.stringify(current) === JSON.stringify(desired);
  return current === desired;
}

async function ensureCoordinatePrecision(client) {
  const columns = (await client.query(`
    select column_name, numeric_precision, numeric_scale
    from information_schema.columns
    where table_schema = current_schema() and table_name = 'transport_nodes'
      and column_name in ('latitude', 'longitude')
    order by column_name`)).rows;
  assert.equal(columns.length, 2, 'Transport-node coordinate columns are missing');
  if (columns.every((column) => column.numeric_precision === 20 && column.numeric_scale === 15)) return false;
  await client.query(`alter table transport_nodes
    alter column latitude type numeric(20, 15) using latitude::numeric(20, 15),
    alter column longitude type numeric(20, 15) using longitude::numeric(20, 15)`);
  return true;
}

async function findOne(client, table, code) {
  const field = CODE_FIELDS[table];
  assert.ok(field, `Unsupported coded table ${table}`);
  const rows = (await client.query(`select * from ${table} where ${field} = $1 for update`, [code])).rows;
  assert.ok(rows.length <= 1, `Duplicate ${table}.${field}: ${code}`);
  return rows[0] || null;
}

async function updateChanged(client, table, row, desired) {
  const fields = Object.keys(desired).filter((field) => !sameValue(row[field], desired[field]));
  if (!fields.length) return { action: 'unchanged', id: row.id, document_id: row.document_id, fields: [] };
  const values = fields.map((field) => desired[field]);
  values.push(row.id);
  const assignments = fields.map((field, index) => `${field} = $${index + 1}`);
  const updated = (await client.query(
    `update ${table} set ${assignments.join(', ')}, updated_at = now()
     where id = $${values.length} returning id, document_id`, values
  )).rows[0];
  return { action: 'updated', ...updated, fields };
}

async function insertRow(client, table, desired) {
  const data = { document_id: documentId(), ...desired };
  const columns = Object.keys(data);
  const values = Object.values(data);
  const placeholders = values.map((_, index) => `$${index + 1}`);
  return (await client.query(
    `insert into ${table} (${columns.join(', ')}, created_at, updated_at, published_at)
     values (${placeholders.join(', ')}, now(), now(), now()) returning id, document_id`, values
  )).rows[0];
}

async function updateNodes(client, actions) {
  for (const definition of manifest.nodes) {
    const row = await findOne(client, 'transport_nodes', definition.node_code);
    assert.ok(row, `Required Phase 5A/5B node is missing: ${definition.node_code}`);
    assert.notEqual(row.verification_status, 'AUTHORITATIVE_CURRENT', `Refusing to downgrade ${definition.node_code}`);
    const desired = {
      latitude: definition.latitude,
      longitude: definition.longitude,
      ...commonEvidence(definition.notes),
    };
    actions.nodes.push({ code: definition.node_code, ...(await updateChanged(client, 'transport_nodes', row, desired)) });
  }
}

async function updateRoutes(client, actions) {
  for (const definition of manifest.routes) {
    let row = await findOne(client, 'routes', definition.route_code);
    if (!row) {
      assert.equal(definition.create, true, `Required existing route is missing: ${definition.route_code}`);
      row = await insertRow(client, 'routes', {
        route_code: definition.route_code,
        route_name: definition.route_name,
        transport_mode: definition.transport_mode,
        origin: definition.origin,
        destination: definition.destination,
        base_fare: null,
        estimated_travel_time: null,
        route_status: 'active', active: true,
        planning_enabled: false,
        ...commonEvidence(definition.notes),
      });
      actions.routes.push({ code: definition.route_code, action: 'created', ...row });
      continue;
    }
    assert.notEqual(row.verification_status, 'AUTHORITATIVE_CURRENT', `Refusing to downgrade ${definition.route_code}`);
    const desired = {
      transport_mode: definition.transport_mode,
      base_fare: null,
      estimated_travel_time: null,
      route_status: 'active',
      active: true,
      ...commonEvidence(definition.notes),
    };
    actions.routes.push({ code: definition.route_code, ...(await updateChanged(client, 'routes', row, desired)) });
  }
}

async function ensureSingleLink(client, { table, sourceColumn, sourceId, targetColumn, targetId, orderColumn }) {
  const rows = (await client.query(`select * from ${table} where ${sourceColumn} = $1 for update`, [sourceId])).rows;
  assert.ok(rows.length <= 1, `Multiple ${table} relations for ${sourceColumn}=${sourceId}`);
  if (rows.length) {
    assert.equal(rows[0][targetColumn], targetId, `Refusing to replace relation in ${table}`);
    return 'unchanged';
  }
  await client.query(
    `insert into ${table} (${sourceColumn}, ${targetColumn}, ${orderColumn}) values ($1, $2, 1)`,
    [sourceId, targetId]
  );
  return 'created';
}

async function updateVariants(client, actions) {
  for (const definition of manifest.variants) {
    const route = await findOne(client, 'routes', definition.route_code);
    const start = await findOne(client, 'transport_nodes', definition.start_node_code);
    const end = await findOne(client, 'transport_nodes', definition.end_node_code);
    assert.ok(route && start && end, `Missing relation target for ${definition.variant_code}`);
    let row = await findOne(client, 'route_variants', definition.variant_code);
    const desired = {
      display_name: definition.display_name,
      direction: definition.direction,
      signboard_text: definition.signboard_text,
      operating_status: 'ACTIVE',
      geometry_source: 'UNKNOWN',
      encoded_polyline: null,
      geometry_geojson: null,
      source_type: 'PROJECT_TEAM_FIELD_VERIFICATION',
      effective_from: '2026-09-27',
      effective_to: null,
      planning_enabled: row ? row.planning_enabled : false,
      ...commonEvidence(definition.notes),
    };
    let action;
    if (!row) {
      assert.equal(definition.create, true, `Required existing variant is missing: ${definition.variant_code}`);
      row = await insertRow(client, 'route_variants', { variant_code: definition.variant_code, ...desired });
      action = { action: 'created', ...row };
    } else {
      assert.notEqual(row.verification_status, 'AUTHORITATIVE_CURRENT', `Refusing to downgrade ${definition.variant_code}`);
      action = await updateChanged(client, 'route_variants', row, desired);
      row = { ...row, ...desired, ...action };
    }
    await ensureSingleLink(client, { table: 'route_variants_route_lnk', sourceColumn: 'route_variant_id', sourceId: row.id, targetColumn: 'route_id', targetId: route.id, orderColumn: 'route_variant_ord' });
    await ensureSingleLink(client, { table: 'route_variants_start_node_lnk', sourceColumn: 'route_variant_id', sourceId: row.id, targetColumn: 'transport_node_id', targetId: start.id, orderColumn: 'route_variant_ord' });
    await ensureSingleLink(client, { table: 'route_variants_end_node_lnk', sourceColumn: 'route_variant_id', sourceId: row.id, targetColumn: 'transport_node_id', targetId: end.id, orderColumn: 'route_variant_ord' });
    actions.variants.push({ code: definition.variant_code, ...action });
  }
}

async function ensureStops(client, actions) {
  for (const definition of manifest.stops) {
    const variant = await findOne(client, 'route_variants', definition.variant_code);
    const node = await findOne(client, 'transport_nodes', definition.node_code);
    assert.ok(variant && node, `Missing stop relation target for ${definition.variant_code}:${definition.sequence}`);
    const rows = (await client.query(`
      select s.* from route_variant_stops s
      join route_variant_stops_route_variant_lnk l on l.route_variant_stop_id = s.id
      where l.route_variant_id = $1 and s.sequence = $2 for update`,
    [variant.id, definition.sequence])).rows;
    assert.ok(rows.length <= 1, `Duplicate stop sequence for ${definition.variant_code}:${definition.sequence}`);
    const desired = {
      sequence: definition.sequence,
      pickup_allowed: definition.pickup_allowed,
      dropoff_allowed: definition.dropoff_allowed,
      transfer_allowed: definition.transfer_allowed,
      is_timepoint: false,
      instruction_template: definition.instruction_template,
      distance_from_variant_start_m: null,
    };
    let row;
    let action;
    if (!rows.length) {
      row = await insertRow(client, 'route_variant_stops', desired);
      action = 'created';
    } else {
      row = rows[0];
      const changed = await updateChanged(client, 'route_variant_stops', row, desired);
      action = changed.action;
      row = { ...row, ...changed };
    }
    await ensureSingleLink(client, { table: 'route_variant_stops_route_variant_lnk', sourceColumn: 'route_variant_stop_id', sourceId: row.id, targetColumn: 'route_variant_id', targetId: variant.id, orderColumn: 'route_variant_stop_ord' });
    await ensureSingleLink(client, { table: 'route_variant_stops_transport_node_lnk', sourceColumn: 'route_variant_stop_id', sourceId: row.id, targetColumn: 'transport_node_id', targetId: node.id, orderColumn: 'route_variant_stop_ord' });
    actions.stops.push({ variant_code: definition.variant_code, sequence: definition.sequence, node_code: definition.node_code, action, id: row.id });
  }
}

async function enablePlanning(client) {
  for (const definition of manifest.nodes) {
    const row = await findOne(client, 'transport_nodes', definition.node_code);
    const eligibility = planningEligibilityFor({ ...row, planning_enabled: true });
    assert.deepEqual(eligibility.reasons, [], `${definition.node_code} is not eligible: ${eligibility.reasons.join(', ')}`);
    if (row.planning_enabled !== true) {
      await client.query('update transport_nodes set planning_enabled = true, updated_at = now() where id = $1', [row.id]);
    }
  }
  for (const definition of manifest.routes) {
    const row = await findOne(client, 'routes', definition.route_code);
    const eligibility = planningEligibilityFor({ ...row, planning_enabled: true }, { requireActive: true });
    assert.deepEqual(eligibility.reasons, [], `${definition.route_code} is not eligible: ${eligibility.reasons.join(', ')}`);
    if (row.planning_enabled !== true) {
      await client.query('update routes set planning_enabled = true, updated_at = now() where id = $1', [row.id]);
    }
  }
  for (const definition of manifest.variants) {
    const variant = await loadVariant(client, definition.variant_code);
    const eligibility = routeVariantPlanningEligibilityFor({ ...variant, planning_enabled: true }, { serviceDate: new Date(VERIFIED_AT) });
    assert.deepEqual(eligibility.reasons, [], `${definition.variant_code} is not eligible: ${eligibility.reasons.join(', ')}`);
    if (variant.planning_enabled !== true) {
      await client.query('update route_variants set planning_enabled = true, updated_at = now() where id = $1', [variant.id]);
    }
  }
}

async function loadVariant(client, variantCode) {
  const variant = (await client.query(`
    select v.*, to_jsonb(r.*) as route
    from route_variants v
    join route_variants_route_lnk rl on rl.route_variant_id = v.id
    join routes r on r.id = rl.route_id
    where v.variant_code = $1`, [variantCode])).rows[0];
  assert.ok(variant, `Variant missing during eligibility check: ${variantCode}`);
  for (const field of ['effective_from', 'effective_to']) {
    if (variant[field] instanceof Date) variant[field] = variant[field].toISOString().slice(0, 10);
  }
  variant.route_variant_stops = (await client.query(`
    select s.*, to_jsonb(n.*) as transport_node
    from route_variant_stops s
    join route_variant_stops_route_variant_lnk sl on sl.route_variant_stop_id = s.id
    join route_variant_stops_transport_node_lnk nl on nl.route_variant_stop_id = s.id
    join transport_nodes n on n.id = nl.transport_node_id
    where sl.route_variant_id = $1 order by s.sequence`, [variant.id])).rows;
  return variant;
}

async function ensureFareRules(client, actions) {
  for (const definition of manifest.fare_rules) {
    const variant = await findOne(client, 'route_variants', definition.variant_code);
    assert.ok(variant, `Fare variant missing: ${definition.variant_code}`);
    const reference = `${ACTIVATION_REFERENCE}; fare-key=${definition.key}`;
    const rows = (await client.query(`
      select f.* from fare_rules f
      join fare_rules_route_variant_lnk l on l.fare_rule_id = f.id
      where l.route_variant_id = $1 and f.source_reference = $2 for update`, [variant.id, reference])).rows;
    assert.ok(rows.length <= 1, `Duplicate pilot FareRule ${definition.key}`);
    const desired = {
      fare_type: 'FLAT', currency: 'PHP', regular_base_fare: definition.regular_base_fare,
      base_distance_km: null, per_km_after_base: null, minimum_fare: null,
      rounding_rule: null, student_discount_percent: null,
      senior_discount_percent: null, pwd_discount_percent: null,
      effective_from: '2026-09-27', effective_to: null,
      ...commonEvidence(definition.notes),
      planning_enabled: true,
      source_reference: reference,
    };
    const eligibility = planningEligibilityFor(desired);
    assert.deepEqual(eligibility.reasons, [], `FareRule ${definition.key} is not eligible`);
    let row;
    let action;
    if (!rows.length) {
      row = await insertRow(client, 'fare_rules', desired);
      action = 'created';
    } else {
      row = rows[0];
      const changed = await updateChanged(client, 'fare_rules', row, desired);
      action = changed.action;
      row = { ...row, ...changed };
    }
    await ensureSingleLink(client, { table: 'fare_rules_route_variant_lnk', sourceColumn: 'fare_rule_id', sourceId: row.id, targetColumn: 'route_variant_id', targetId: variant.id, orderColumn: 'fare_rule_ord' });
    actions.fares.push({ key: definition.key, variant_code: definition.variant_code, action, id: row.id });
  }
}

async function counts(client) {
  const result = {};
  for (const table of COUNT_TABLES) result[table] = (await client.query(`select count(*)::int count from ${table}`)).rows[0].count;
  const trust = (await client.query(`select
    (select count(*)::int from transport_nodes where verification_status = 'FIELD_VERIFIED') field_verified_nodes,
    (select count(*)::int from routes where verification_status = 'FIELD_VERIFIED') field_verified_routes,
    (select count(*)::int from route_variants where verification_status = 'FIELD_VERIFIED') field_verified_variants,
    (select count(*)::int from fare_rules where verification_status = 'FIELD_VERIFIED') field_verified_fares,
    (select count(*)::int from transport_nodes where planning_enabled) planning_nodes,
    (select count(*)::int from routes where planning_enabled) planning_routes,
    (select count(*)::int from route_variants where planning_enabled) planning_variants`)).rows[0];
  return { ...result, ...trust };
}

async function digest(client) {
  return crypto.createHash('sha256').update(JSON.stringify(await snapshot(client))).digest('hex');
}

async function activate(client) {
  validateManifest();
  await client.query("set local lock_timeout = '5s'");
  await client.query("set local statement_timeout = '30s'");
  await client.query("select pg_advisory_xact_lock(hashtext('pamana-pilot-mexico-san-fernando-2026-09-27'))");
  await client.query(`lock table ${LOCK_TABLES.join(', ')} in share row exclusive mode`);
  const before = { counts: await counts(client), digest: await digest(client) };
  const coordinate_precision_changed = await ensureCoordinatePrecision(client);
  const actions = { nodes: [], routes: [], variants: [], stops: [], fares: [] };
  await updateNodes(client, actions);
  await updateRoutes(client, actions);
  await updateVariants(client, actions);
  await ensureStops(client, actions);
  await enablePlanning(client);
  await ensureFareRules(client, actions);
  const after = { counts: await counts(client), digest: await digest(client) };
  return { manifest_version: manifest.manifest_version, coordinate_precision_changed, before, after, actions };
}

async function main() {
  const client = await connect();
  const dryRun = process.argv.includes('--dry-run');
  try {
    await client.query('begin');
    const result = await activate(client);
    if (dryRun) await client.query('rollback');
    else await client.query('commit');
    console.log(JSON.stringify({ mode: dryRun ? 'dry-run' : 'committed', ...result }, null, 2));
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}

if (require.main === module) main().catch((error) => {
  console.error(`Pilot activation failed: ${error.message}`);
  process.exitCode = 1;
});

module.exports = { activate, counts, digest, loadVariant, manifest, validateManifest };
