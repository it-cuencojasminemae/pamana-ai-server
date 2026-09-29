'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  canAccessWorkbench, finiteCoordinatePair, validTransitGeometry,
  validateFareRule, validateServicePattern, validateWorkbenchRecord,
} = require('../src/services/transport-data/workbench');

const read = (file) => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
const admin = { role: { name: 'Administrator' } };
const lgu = { role: { name: 'LGU' } };
const passenger = { role: { name: 'Passenger' } };
const driver = { role: { name: 'Driver' } };
const evidence = {
  data_mode: 'REAL', verification_status: 'FIELD_VERIFIED', planning_enabled: true,
  verified_at: '2026-09-28T00:00:00.000Z', source_name: 'Field survey team',
  source_reference: 'FIELD-LOG-21',
};

assert.equal(canAccessWorkbench(admin), true);
assert.equal(canAccessWorkbench(lgu), true);
assert.equal(canAccessWorkbench(passenger), false);
assert.equal(canAccessWorkbench(driver), false);
assert.equal(canAccessWorkbench(null), false);

assert.deepEqual(finiteCoordinatePair({ latitude: '', longitude: '' }), { valid: true, present: false });
assert.equal(finiteCoordinatePair({ latitude: 15.12, longitude: 120.69 }).valid, true);
assert.equal(finiteCoordinatePair({ latitude: 0, longitude: 0 }).reason, 'NULL_ISLAND_REJECTED');
assert.equal(finiteCoordinatePair({ latitude: 'not-a-number', longitude: 120.69 }).reason, 'COORDINATES_INVALID');
assert.equal(finiteCoordinatePair({ latitude: 15.12, longitude: '' }).reason, 'COORDINATE_PAIR_REQUIRED');

const node = { ...evidence, name: 'Verified pickup', node_code: 'NODE-21', node_type: 'ROADSIDE_PICKUP', latitude: 15.12, longitude: 120.69 };
assert.deepEqual(validateWorkbenchRecord('transport-nodes', node, {
  user: admin, confirmations: { coordinate: true }, existing: {},
}).errors, []);
assert.ok(validateWorkbenchRecord('transport-nodes', node, { user: admin }).errors.includes('COORDINATE_CONFIRMATION_REQUIRED'));
assert.ok(validateWorkbenchRecord('transport-nodes', { ...node, latitude: 0, longitude: 0 }, {
  user: admin, confirmations: { coordinate: true },
}).errors.includes('NULL_ISLAND_REJECTED'));
assert.ok(validateWorkbenchRecord('transport-nodes', node, {
  user: lgu, confirmations: { coordinate: true }, existing: { documentId: 'node-existing', planning_enabled: false, verification_status: 'RESEARCH_CANDIDATE' },
}).errors.includes('TRUST_FIELDS_ADMIN_ONLY'));

const researchCandidate = {
  name: 'POI candidate', node_code: 'POI-ONLY', node_type: 'LANDMARK', latitude: 15.1, longitude: 120.7,
  data_mode: 'REAL', verification_status: 'RESEARCH_CANDIDATE', planning_enabled: false,
  source_name: 'Geoapify geographic place', source_reference: 'place-id',
};
assert.ok(validateWorkbenchRecord('transport-nodes', researchCandidate, { user: lgu }).errors
  .includes('COORDINATE_CONFIRMATION_REQUIRED'), 'a Geoapify POI never becomes a transport coordinate without explicit confirmation');
assert.equal(researchCandidate.verification_status, 'RESEARCH_CANDIDATE');
assert.equal(researchCandidate.planning_enabled, false);

const route = { ...evidence, route_name: 'Pilot route', route_code: 'ROUTE-21', transport_mode: 'PUJ_TRADITIONAL', origin: 'A', destination: 'B', route_status: 'active', active: true };
assert.equal(validateWorkbenchRecord('routes', route, { user: admin }).valid, true);
assert.ok(validateWorkbenchRecord('routes', { ...route, active: false }, { user: admin }).errors.includes('PLANNING_ROUTE_NOT_ACTIVE'));

const geometry = { type: 'LineString', coordinates: [[120.69, 15.12], [120.7, 15.13]] };
assert.equal(validTransitGeometry(geometry), true);
assert.equal(validTransitGeometry({ type: 'LineString', coordinates: [[0, 0], [120.7, 15.13]] }), false);
assert.equal(validTransitGeometry({ type: 'Point', coordinates: [120.7, 15.13] }), false);
const eligibleNode = { ...node, documentId: 'node-eligible' };
const variant = {
  ...evidence, variant_code: 'VARIANT-21', display_name: 'Outbound', direction: 'OUTBOUND',
  route: 'route-doc', start_node: 'node-a', end_node: 'node-b', operating_status: 'ACTIVE',
  geometry_source: 'MANUAL_VERIFIED', geometry_geojson: geometry,
};
const stops = [
  { documentId: 'stop-a', sequence: 1, pickup_allowed: true, dropoff_allowed: false, transport_node: eligibleNode },
  { documentId: 'stop-b', sequence: 2, pickup_allowed: false, dropoff_allowed: true, transport_node: eligibleNode },
];
assert.equal(validateWorkbenchRecord('route-variants', variant, {
  user: admin, confirmations: { geometry: true }, siblingStops: stops,
  relations: { route, start_node: eligibleNode, end_node: eligibleNode },
}).valid, true);
assert.ok(validateWorkbenchRecord('route-variants', variant, {
  user: admin, siblingStops: stops, relations: { route, start_node: eligibleNode, end_node: eligibleNode },
}).errors.includes('GEOMETRY_CONFIRMATION_REQUIRED'));
assert.ok(validateWorkbenchRecord('route-variants', { ...variant, geometry_source: 'UNKNOWN' }, {
  user: admin, confirmations: { geometry: true }, siblingStops: stops,
  relations: { route, start_node: eligibleNode, end_node: eligibleNode },
}).errors.includes('VERIFIED_GEOMETRY_SOURCE_REQUIRED'));

const stop = { documentId: 'stop-a', route_variant: 'variant-doc', transport_node: 'node-doc', sequence: 2, pickup_allowed: true, dropoff_allowed: true, transfer_allowed: false };
assert.ok(validateWorkbenchRecord('route-variant-stops', stop, {
  user: admin, existing: { ...stop, sequence: 1 }, siblingStops: [],
}).errors.includes('STOP_ORDER_CONFIRMATION_REQUIRED'));
assert.ok(validateWorkbenchRecord('route-variant-stops', stop, {
  user: admin, existing: { ...stop, sequence: 1 }, confirmations: { order: true },
  siblingStops: [{ documentId: 'another-stop', sequence: 2 }],
}).errors.includes('DUPLICATE_STOP_SEQUENCE'));

assert.deepEqual(validateFareRule({ fare_type: 'FLAT', currency: 'PHP', regular_base_fare: 30, route: 'route-doc' }), []);
assert.ok(validateFareRule({ fare_type: 'DISTANCE_BASED', currency: 'PHP', route: 'route-doc' }).includes('BASE_DISTANCE_REQUIRED'));
assert.ok(validateFareRule({ fare_type: 'FLAT', currency: 'PHP', regular_base_fare: 0, route: '' }).includes('FARE_SCOPE_REQUIRED'));
assert.deepEqual(validateServicePattern({
  route_variant: 'variant-doc', days_of_week: ['MONDAY'], dispatch_type: 'LEAVE_WHEN_FULL',
}), [], 'leave-when-full does not require a headway');
assert.ok(validateServicePattern({
  route_variant: 'variant-doc', days_of_week: ['MONDAY'], dispatch_type: 'HEADWAY',
  headway_min_minutes: 30, headway_max_minutes: 10,
}).includes('HEADWAY_RANGE_INVALID'));

const controller = read('src/api/transport-workbench/controllers/transport-workbench.js');
const routes = read('src/api/transport-workbench/routes/transport-workbench.js');
const bootstrap = read('src/index.js');
const { ROLE_PERMISSION_MATRIX } = require('../src/services/security/access-control');
const graph = read('src/services/pamana-journey/graph-builder.js');
const controllerModule = require('../src/api/transport-workbench/controllers/transport-workbench');
assert.match(controller, /authenticatedWorkbenchUser/);
assert.match(controller, /ctx\.forbidden/);
assert.match(routes, /transport-workbench\/:entity/);
assert.ok(!ROLE_PERMISSION_MATRIX.Passenger.some((action) => action.includes('transport-workbench')));
assert.ok(!ROLE_PERMISSION_MATRIX.Driver.some((action) => action.includes('transport-workbench')));
assert.ok(ROLE_PERMISSION_MATRIX.LGU.some((action) => action.includes('transport-workbench')));
assert.match(graph, /forward-only ride edges/);
assert.doesNotMatch(controller, /reverse.*stop|auto.*reverse/i);

const pilotFixture = read('scripts/data/pilot-mexico-san-fernando-field-verified.json');
assert.match(pilotFixture, /RCH-PSU-MEXICO-FRONT/);
assert.doesNotMatch(controller, /activate-pilot|seed-|update.*pilot/i);
async function testControllerRoles() {
  const users = { 1: admin, 2: lgu, 3: passenger, 4: driver };
  global.strapi = {
    db: { query: () => ({ findOne: async ({ where }) => users[where.id] || null }) },
    documents: () => ({ findMany: async () => [] }),
  };
  const context = (id) => ({
    state: id ? { user: { id } } : {}, params: { entity: 'transport-nodes' }, query: {},
    forbidden(message) { this.status = 403; this.body = message; },
  });
  for (const id of [1, 2]) {
    const ctx = context(id);
    await controllerModule.list(ctx);
    assert.equal(ctx.status, undefined);
    assert.deepEqual(ctx.body, { data: [] });
  }
  for (const id of [null, 3, 4]) {
    const ctx = context(id);
    await controllerModule.list(ctx);
    assert.equal(ctx.status, 403);
  }
  delete global.strapi;
}

testControllerRoles().then(() => {
  console.log('ok - workbench role access, validation, confirmation, evidence and planning gates are conservative');
  console.log('ok - stop order, fares, service patterns and verified geometry follow Phase 21 rules');
  console.log('ok - Geoapify evidence does not auto-verify, no reverse route is created, and pilot fixtures are untouched');
}).catch((error) => { console.error(error); process.exitCode = 1; });
