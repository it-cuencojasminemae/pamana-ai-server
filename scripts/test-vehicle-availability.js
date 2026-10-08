'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { STATUSES, availabilityForTrip } = require('../src/services/vehicle-availability/policy');
const { reportAvailability } = require('../src/services/vehicle-availability/report');
const { resetRateLimits, validateDataEnvelope } = require('../src/services/security/request-guard');
const { ROLE_PERMISSION_MATRIX } = require('../src/services/security/access-control');
const { resolveLiveVehicles } = require('../src/services/pamana-journey/live-vehicle-resolver');
const NOW = new Date('2026-10-08T10:00:00Z');
const uid = 'api::trip.trip';

function fixture(mode = 'REAL') {
  const vehicle = { id: 2, documentId: 'vehicle-test', data_mode: mode, capacity: 20, current_occupancy: 7, occupancy_level: 'moderate', vehicle_status: 'in_transit', active_route_variant: { documentId: 'variant-test' } };
  const driver = { id: 3, data_mode: mode, driver_status: 'active', vehicle };
  return { vehicle, driver, id: 1, documentId: 'trip-test-123', data_mode: mode, is_simulated: mode === 'SIMULATED', trip_status: 'active',
    route: { id: 4, data_mode: mode }, route_variant: { documentId: 'variant-test', data_mode: mode } };
}
function harness(mode = 'REAL') {
  let trip = fixture(mode), audits = [], queue = Promise.resolve();
  const locks = [];
  const strapi = {
    db: { metadata: { get: key => ({ tableName: key }) },
      async transaction(callback) {
        const previous = queue;
        let release;
        queue = new Promise(resolve => { release = resolve; });
        await previous;
        const before = structuredClone(trip), auditBefore = structuredClone(audits);
        const trx = table => ({ where(query) { locks.push({ table, query }); return this; }, forUpdate() { return this; }, async select() { return [{ id: 1 }]; } });
        try { return await callback({ trx }); }
        catch (error) { trip = before; audits = auditBefore; throw error; }
        finally { release(); }
      } },
    documents(key) {
      if (key === uid) return {
        async findOne({ documentId }) { return documentId === trip.documentId ? trip : null; },
        async findFirst() { return trip.trip_status === 'active' ? trip : null; },
        async update({ data }) { if (strapi.failUpdate) throw Error('WRITE_FAILED'); trip = { ...trip, ...data }; return trip; },
      };
      if (key === 'api::driver.driver') return { async findFirst({ filters }) { return filters.user.id === 10 ? trip.driver : null; } };
      if (key === 'api::vehicle-availability-report.vehicle-availability-report') return { async create({ data }) { audits.push(structuredClone(data)); return data; } };
      throw Error(`Unexpected service ${key}`);
    },
  };
  return { strapi, get trip() { return trip; }, get audits() { return audits; }, locks };
}
function controller(strapi, target = '../src/api/trip/controllers/trip') {
  const file = require.resolve(target);
  const local = createRequire(file), module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, require: name => name === '@strapi/strapi'
    ? { factories: { createCoreController: (_, build) => build({ strapi }) } } : local(name) });
  return module.exports;
}
function context({ user = { id: 10, role: { name: 'Driver' } }, status = 'AVAILABLE', tripId = 'trip-test-123', body } = {}) {
  return { state: { user }, params: { id: tripId }, request: { body: body || { data: { status } } },
    unauthorized() { this.status = 401; }, forbidden() { this.status = 403; }, notFound() { this.status = 404; }, badRequest() { this.status = 400; }, set() {} };
}

test('all four states persist on the exact active trip, reload through the Driver API, and preserve counts', async () => {
  const h = harness();
  for (const status of STATUSES) {
    const ctx = context({ status });
    await controller(h.strapi).availability(ctx);
    assert.equal(ctx.body.data.status, status);
    assert.equal(ctx.body.data.source, 'DRIVER');
    assert.ok(ctx.body.data.reportedAt);
    const reload = context();
    await controller(h.strapi).active(reload);
    assert.equal(reload.body.data.availability.status, status);
  }
  assert.equal(h.audits.length, 4);
  assert.ok(h.audits.every(a => a.trip === 1 && a.vehicle === 2 && a.driver === 3 && a.data_mode === 'REAL'));
  assert.equal(h.trip.vehicle.current_occupancy, 7);
  assert.equal(h.trip.vehicle.capacity, 20);
  assert.equal(h.trip.vehicle.occupancy_level, 'moderate');
  assert.equal(h.trip.vehicle.vehicle_status, 'in_transit');
});

test('concurrent duplicate submissions create one audit and do not renew reporting time', async () => {
  const h = harness();
  const input = { userId: 10, tripId: h.trip.documentId, status: 'FULL' };
  const results = await Promise.all([reportAvailability(h.strapi, input), reportAvailability(h.strapi, input)]);
  assert.equal(h.audits.length, 1);
  assert.equal(results[1].duplicate, true);
  assert.equal(results[0].availability.reportedAt, results[1].availability.reportedAt);
  assert.ok(h.locks.some(lock => lock.table === 'api::driver.driver'));
  assert.ok(h.locks.some(lock => lock.table === 'api::vehicle.vehicle'));
});

test('failed snapshot writes roll back the audit too', async () => {
  const h = harness(); h.strapi.failUpdate = true;
  await assert.rejects(reportAvailability(h.strapi, { userId: 10, tripId: h.trip.documentId, status: 'AVAILABLE' }), /WRITE_FAILED/);
  assert.equal(h.audits.length, 0);
  assert.equal(h.trip.availability_reported_at, undefined);
});

test('authentication, role, ownership, active assignment, modes and bounded status payloads are enforced', async () => {
  resetRateLimits();
  for (const [options, status] of [
    [{ user: null }, 401], [{ user: { id: 10, role: { name: 'Passenger' } } }, 403],
    [{ user: { id: 99, role: { name: 'Driver' } } }, 404], [{ tripId: 'other-trip-123' }, 404],
    ...['near_full', null, 0, {}, ['FULL'], ''].map(value => [{ status: value }, 400]),
    [{ body: { data: { status: 'FULL', current_occupancy: 20 } } }, 400],
  ]) {
    const h = harness(), ctx = context(options);
    await controller(h.strapi).availability(ctx);
    assert.equal(ctx.status, status, JSON.stringify(options));
    assert.equal(h.audits.length, 0);
  }
  for (const change of [h => { h.trip.trip_status = 'completed'; }, h => { h.trip.driver.id = 88; h.trip.driver = { ...h.trip.driver, vehicle: { id: 99 } }; },
    h => { h.trip.vehicle.data_mode = 'SIMULATED'; }, h => { h.trip.driver.driver_status = 'inactive'; }, h => { h.trip.route_variant = null; },
    h => { h.trip.vehicle.active_route_variant = { documentId: 'unrelated-variant' }; }]) {
    const h = harness(); change(h);
    await assert.rejects(reportAvailability(h.strapi, { userId: 10, tripId: h.trip.documentId, status: 'FULL' }));
    assert.equal(h.audits.length, 0);
  }
  assert.equal(validateDataEnvelope({ data: { status: 'FULL'.repeat(1000) } }, { allowedFields: ['status'], maxBytes: 1024 }).ok, false);
  assert.ok(ROLE_PERMISSION_MATRIX.Driver.includes('api::trip.trip.availability'));
  assert.ok(!ROLE_PERMISSION_MATRIX.Passenger.includes('api::trip.trip.availability'));
  assert.ok(!ROLE_PERMISSION_MATRIX.LGU.includes('api::trip.trip.availability'));
});

test('stale, missing, future, completed and unsupported reports are UNKNOWN; policy is configurable', () => {
  const trip = { ...fixture(), availability_status: 'AVAILABLE', availability_source: 'DRIVER', availability_reported_at: NOW.toISOString() };
  assert.equal(availabilityForTrip(trip, { now: NOW }).status, 'AVAILABLE');
  const stale = availabilityForTrip(trip, { now: new Date(+NOW + 900000) });
  assert.equal(stale.status, 'UNKNOWN'); assert.equal(stale.stale, true); assert.equal(stale.reportedStatus, 'AVAILABLE');
  for (const changed of [{ availability_reported_at: null }, { availability_reported_at: 'invalid' }, { availability_reported_at: new Date(+NOW + 1000).toISOString() },
    { availability_status: 'bad' }, { availability_source: 'PASSENGER' }, { availability_source: 'SYSTEM_ESTIMATE' }, { trip_status: 'completed' }]) {
    assert.equal(availabilityForTrip({ ...trip, ...changed }, { now: NOW }).status, 'UNKNOWN');
  }
  const original = process.env.MANUAL_AVAILABILITY_MAX_AGE_SECONDS;
  try {
    process.env.MANUAL_AVAILABILITY_MAX_AGE_SECONDS = '60';
    assert.equal(availabilityForTrip(trip, { now: new Date(+NOW + 60000) }).stale, true);
  } finally { if (original === undefined) delete process.env.MANUAL_AVAILABILITY_MAX_AGE_SECONDS; else process.env.MANUAL_AVAILABILITY_MAX_AGE_SECONDS = original; }
});

test('fresh GPS cannot refresh old availability or make an unreported vehicle boardable', () => {
  const trip = { ...fixture(), availability_status: 'AVAILABLE', availability_source: 'DRIVER', availability_reported_at: new Date(+NOW - 900001).toISOString() };
  const record = { trip, vehicle: trip.vehicle, location: { recorded_at: NOW.toISOString(), data_mode: 'REAL' } };
  const result = resolveLiveVehicles({ routeVariantId: 'variant-test' }, { operationalRecords: [record], now: NOW });
  assert.equal(result.activeVehicleCount, 1);
  assert.equal(result.boardableVehicleCount, 0);
  assert.equal(result.vehicles[0].occupancy, 'UNKNOWN');
  assert.equal(result.vehicles[0].availability.stale, true);
  delete trip.availability_reported_at;
  assert.equal(resolveLiveVehicles({ routeVariantId: 'variant-test' }, { operationalRecords: [record], now: NOW }).boardableVehicleCount, 0);
});

test('simulation provenance remains simulated and is excluded from real journey availability', async () => {
  const h = harness('SIMULATED');
  const saved = await reportAvailability(h.strapi, { userId: 10, tripId: h.trip.documentId, status: 'FULL' });
  assert.equal(saved.availability.source, 'SIMULATION');
  assert.equal(h.audits[0].data_mode, 'SIMULATED');
  const record = { trip: h.trip, vehicle: h.trip.vehicle, location: { recorded_at: new Date().toISOString(), data_mode: 'SIMULATED' } };
  assert.equal(resolveLiveVehicles({ routeVariantId: 'variant-test' }, { operationalRecords: [record] }).assignedVehicleCount, 0);
  assert.equal(availabilityForTrip(h.trip, { dataMode: 'REAL' }).status, 'UNKNOWN');
});

test('existing passenger reports retain review and provenance without writing Driver availability', () => {
  const source = fs.readFileSync(require.resolve('../src/api/passenger-report/controllers/passenger-report'), 'utf8');
  assert.doesNotMatch(source, /availability_status|vehicle-availability-report|occupancy_level/);
  const { REPORT_CATEGORIES } = require('../src/services/passenger-report/report-policy');
  assert.ok(REPORT_CATEGORIES.includes('VEHICLE_FULL'));
});

test('real Passenger/LGU feed returns effective availability and excludes simulated or mixed trips', async () => {
  const trips = STATUSES.map((status, index) => ({ ...fixture(), documentId: `trip-feed-${index}`, availability_status: status,
    availability_source: 'DRIVER', availability_reported_at: new Date().toISOString() }));
  const stale = { ...fixture(), documentId: 'trip-feed-stale', availability_status: 'FULL', availability_source: 'DRIVER', availability_reported_at: new Date(Date.now() - 1000000).toISOString() };
  trips.push(stale, { ...fixture('SIMULATED'), documentId: 'trip-feed-simulation' },
    { ...fixture(), documentId: 'trip-feed-mixed', vehicle: { ...fixture().vehicle, data_mode: 'SIMULATED' } });
  const strapi = { documents(key) {
    if (key === uid) return { findMany: async () => trips };
    if (key === 'api::vehicle-location.vehicle-location') return { findFirst: async ({ filters }) => {
      const trip = trips.find(t => t.documentId === filters.trip.documentId);
      return { data_mode: trip.data_mode, latitude: 15, longitude: 120, recorded_at: new Date().toISOString() };
    } };
    throw Error(`Unexpected ${key}`);
  } };
  const original = global.strapi;
  try {
    global.strapi = strapi;
    const endpoint = require('../src/api/live-vehicle/controllers/live-vehicle');
    for (const role of ['Passenger', 'LGU']) {
      const ctx = { state: { user: { id: 100, role: { name: role } } }, query: {}, badRequest() { assert.fail('Valid query rejected'); } };
      await endpoint.list(ctx);
      assert.equal(ctx.body.data.length, 5);
      assert.deepEqual(ctx.body.data.slice(0, 4).map(v => v.availability.status), STATUSES);
      assert.ok(ctx.body.data.every(v => v.data_mode === 'REAL'));
      assert.equal(ctx.body.data[4].availability.status, 'UNKNOWN');
      assert.equal(ctx.body.data[4].occupancy_level, null);
    }
  } finally { global.strapi = original; }
});

test('GPS reporting preserves availability; confirmed end serializes against reporting and retains history', async () => {
  const h = harness();
  h.trip.route_variant.id = 4;
  h.trip.vehicle.active_route_variant.id = 4;
  await reportAvailability(h.strapi, { userId: 10, tripId: h.trip.documentId, status: 'LIMITED' });
  const reportedAt = h.trip.availability_reported_at;
  const documents = h.strapi.documents.bind(h.strapi), gps = [];
  h.strapi.documents = key => key === 'api::vehicle-location.vehicle-location' ? { async create({ data }) { gps.push(data); return { ...data, documentId: 'gps-fixture' }; } }
    : key === 'api::vehicle.vehicle' ? { async update({ data }) { Object.assign(h.trip.vehicle, data); return h.trip.vehicle; } } : documents(key);
  const gpsCtx = context({ body: { data: { latitude: 15, longitude: 120, recorded_at: new Date().toISOString() } } });
  await controller(h.strapi, '../src/api/vehicle-location/controllers/vehicle-location').create(gpsCtx);
  assert.equal(gpsCtx.status, 201);
  assert.equal(gps[0].trip, 1); assert.equal(gps[0].vehicle, 2);
  assert.equal(h.trip.availability_reported_at, reportedAt);
  const ending = controller(h.strapi);
  ending.sanitizeOutput = async value => value;
  ending.transformResponse = value => value;
  await ending.update(context({ body: { data: { trip_status: 'completed' } } }));
  assert.equal(h.trip.trip_status, 'completed');
  assert.equal(h.trip.vehicle.active_route_variant, null);
  assert.equal(h.trip.availability_status, 'LIMITED');
  assert.equal(h.audits.length, 1);
  assert.equal(availabilityForTrip(h.trip).status, 'UNKNOWN');
  await assert.rejects(reportAvailability(h.strapi, { userId: 10, tripId: h.trip.documentId, status: 'FULL' }), /INACTIVE_TRIP/);
  assert.equal(h.audits.length, 1);
});
