'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const routes = require('../src/api/pamana-demo/routes/pamana-demo');
const { createLiveVehiclesHandler } = require('../src/api/pamana-demo/controllers/pamana-demo');
const { isDemoModeEnabled } = require('../src/services/pamana-demo/demo-config');
const { distanceMeters, interpolateLineString } = require('../src/services/pamana-demo/position-interpolator');
const { loadScenario, validateScenario } = require('../src/services/pamana-demo/scenario-loader');
const { simulateScenarioSnapshot, toOperationalRecords, vehicleTimeline } = require('../src/services/pamana-demo/vehicle-simulator');
const { availabilityForLeg } = require('../src/services/pamana-journey/availability-engine');

const NOW = new Date('2026-09-26T00:00:00.000Z');
const snapshot = (seconds, scenarioId) => simulateScenarioSnapshot({ elapsedSeconds: seconds, scenarioId, now: NOW });

assert.equal(isDemoModeEnabled({}), false);
assert.equal(isDemoModeEnabled({ PAMANA_DEMO_MODE_ENABLED: 'false' }), false);
assert.equal(isDemoModeEnabled({ PAMANA_DEMO_MODE_ENABLED: 'TRUE' }), true);
console.log('ok - simulation is disabled by default and requires the server-owned gate');

{
  const first = snapshot(15);
  const second = snapshot(15);
  assert.deepEqual(first, second);
  assert.equal(first.dataMode, 'SIMULATED');
  assert.equal(first.simulation, true);
  assert.equal(first.scenario.notice, 'SIMULATED DEMO / NOT REAL TRANSPORT DATA');
  assert.equal(first.vehicles.length, 3);
  assert.deepEqual(first.vehicles.map((vehicle) => vehicle.occupancy), ['AVAILABLE', 'NEAR_FULL', 'FULL']);
  assert.ok(first.vehicles.every((vehicle) => vehicle.dataMode === 'SIMULATED' && vehicle.simulation === true));
  assert.ok(first.vehicles.every((vehicle) => Number.isFinite(vehicle.lat) && Number.isFinite(vehicle.lng)));
  assert.deepEqual(Object.keys(first.vehicles[0]).sort(), [
    'dataFreshness', 'dataMode', 'id', 'label', 'lat', 'lng', 'observedAt', 'occupancy',
    'progress', 'routeVariantId', 'simulation', 'transportMode', 'tripState',
  ]);
  console.log('ok - fixed time produces deterministic, provider-neutral, classified multi-vehicle snapshots');
}

{
  const scenario = loadScenario();
  const start = interpolateLineString(scenario.routeGeometry.coordinates, 0);
  const middle = interpolateLineString(scenario.routeGeometry.coordinates, 0.5);
  const end = interpolateLineString(scenario.routeGeometry.coordinates, 1);
  assert.deepEqual(start, scenario.routeGeometry.coordinates[0]);
  assert.deepEqual(end, scenario.routeGeometry.coordinates.at(-1));
  assert.ok(distanceMeters(start, middle) > 0);
  assert.ok(distanceMeters(middle, end) > 0);
  assert.notDeepEqual(middle, scenario.routeGeometry.coordinates[1], 'distance midpoint must not assume equal coordinate segments');
  assert.deepEqual(snapshot(0).vehicles[0].lat, snapshot(60).vehicles[0].lat);
  assert.deepEqual(snapshot(0).vehicles[0].lng, snapshot(60).vehicles[0].lng);
  assert.equal(snapshot(19.999).vehicles[0].occupancy, 'AVAILABLE');
  assert.equal(snapshot(20).vehicles[0].occupancy, 'NEAR_FULL');
  assert.equal(snapshot(40).vehicles[0].occupancy, 'FULL');
  assert.equal(vehicleTimeline({ startOffsetSeconds: 10 }, { durationSeconds: 60, loop: false }, 5).tripState, 'NOT_STARTED');
  assert.equal(vehicleTimeline({ startOffsetSeconds: 10 }, { durationSeconds: 60, loop: false }, 20).tripState, 'ACTIVE');
  assert.equal(vehicleTimeline({ startOffsetSeconds: 10 }, { durationSeconds: 60, loop: false }, 70).tripState, 'COMPLETED');
  console.log('ok - LineString interpolation is distance-aware; looping and occupancy boundaries are deterministic');
}

{
  const stale = snapshot(15, 'synthetic-stale-diagnostic');
  assert.equal(stale.staleVehicleCount, 1);
  assert.equal(stale.freshActiveVehicleCount, 0);
  assert.equal(stale.vehicles[0].dataFreshness.status, 'STALE');
  assert.equal(stale.vehicles[0].dataFreshness.ageSeconds, 90);
  console.log('ok - stale diagnostic snapshots reuse the Phase 13 freshness policy');
}

{
  const demo = snapshot(15);
  const records = toOperationalRecords(demo);
  const leg = { type: 'TRANSIT', routeVariantId: demo.vehicles[0].routeVariantId };
  const production = availabilityForLeg(leg, { operationalRecords: records, now: NOW });
  const explicitDemo = availabilityForLeg(leg, { operationalRecords: records, now: NOW, allowSimulated: true });
  assert.equal(production.status, 'UNKNOWN');
  assert.equal(production.activeVehicleCount, 0);
  assert.equal(explicitDemo.status, 'LIVE_ACTIVE');
  assert.equal(explicitDemo.activeVehicleCount, 1);
  assert.equal(explicitDemo.boardableVehicleCount, 1);
  console.log('ok - Phase 13 production excludes simulation while an explicit internal demo path can accept it');
}

async function testEndpoint() {
  const route = routes.routes.find((item) => item.path === '/pamana-demo/live-vehicles');
  assert.equal(route.method, 'GET');
  assert.notEqual(route.config.auth, false);

  let unauthorized = false;
  await createLiveVehiclesHandler({ enabled: () => true })({
    state: {}, query: {}, unauthorized() { unauthorized = true; this.status = 401; },
  });
  assert.equal(unauthorized, true);

  const disabled = { state: { user: { id: 1 } }, query: {} };
  await createLiveVehiclesHandler({ enabled: () => false })(disabled);
  assert.equal(disabled.status, 403);
  assert.equal(disabled.body.status, 'SIMULATION_DISABLED');
  assert.deepEqual(disabled.body.vehicles, []);

  const enabled = { state: { user: { id: 1 } }, query: { elapsedSeconds: '15' } };
  await createLiveVehiclesHandler({ enabled: () => true, now: () => NOW })(enabled);
  assert.equal(enabled.status, 200);
  assert.equal(enabled.body.status, 'SIMULATION_READY');
  assert.equal(enabled.body.vehicles.length, 3);

  const invalid = { state: { user: { id: 1 } }, query: { scenario: 'not-allowed' } };
  await createLiveVehiclesHandler({ enabled: () => true, now: () => NOW })(invalid);
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.status, 'INVALID_SCENARIO');
  assert.doesNotMatch(JSON.stringify(invalid.body), /stack|env|key/i);
  console.log('ok - dedicated endpoint is authenticated, gated, allowlisted, and returns controlled errors');
}

{
  assert.throws(() => validateScenario({ dataMode: 'SIMULATED', routeGeometry: { type: 'LineString', coordinates: [] }, vehicles: [], durationSeconds: 60 }), /INVALID_SIMULATION_SCENARIO/);
  const source = [
    'src/services/pamana-demo/vehicle-simulator.js',
    'src/services/pamana-demo/scenarios/synthetic-direct.js',
    'src/api/pamana-demo/controllers/pamana-demo.js',
  ].map((file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).join('\n');
  assert.doesNotMatch(source, /strapi\.documents|\.query\(|insert|create\(|update\(|delete\(/i);
  assert.doesNotMatch(source, /OpenAI|Gemini|predict|Geoapify|San Juan|SM City|Pampanga State/i);
  assert.ok(loadScenario().routeGeometry.coordinates.every(([lng]) => lng > 139), 'fixture must stay offshore and unrelated to Pampanga');
  const liveController = fs.readFileSync(path.join(__dirname, '..', 'src/api/live-vehicle/controllers/live-vehicle.js'), 'utf8');
  assert.doesNotMatch(liveController, /pamana-demo|PAMANA_DEMO_MODE_ENABLED/);
  console.log('ok - fixture validation, zero persistence/AI/routing dependencies, offshore geometry, and normal endpoint isolation hold');
}

testEndpoint().catch((error) => {
  console.error(`FAIL: ${error.stack || error.message}`);
  process.exitCode = 1;
});
