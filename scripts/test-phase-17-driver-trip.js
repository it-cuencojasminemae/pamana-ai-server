'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const policy = require('../src/services/driver-trip/driver-trip-policy');
const customRoutes = require('../src/api/trip/routes/01-driver-trip');

const NOW = new Date('2026-09-26T01:00:00.000Z');
const trust = {
  planning_enabled: true,
  verification_status: 'FIELD_VERIFIED',
  data_mode: 'REAL',
  verified_at: '2026-09-01T00:00:00.000Z',
  source_name: 'Synthetic unit evidence',
  source_reference: 'phase-17-unit-fixture',
};
const route = { id: 10, documentId: 'route-real', route_status: 'active', ...trust };
const vehicle = {
  id: 20, documentId: 'vehicle-real', vehicle_status: 'available', data_mode: 'REAL',
  capacity: 16, route,
};
const driver = { id: 30, documentId: 'driver-real', driver_status: 'active', data_mode: 'REAL', vehicle };
const outbound = {
  id: 40, documentId: 'variant-out', direction: 'OUTBOUND', operating_status: 'ACTIVE',
  effective_from: '2026-01-01', effective_to: '2026-12-31', route, ...trust,
};
const inbound = { ...outbound, id: 41, documentId: 'variant-in', direction: 'INBOUND' };

{
  const result = policy.startTripData({ driver, vehicle, route, variant: outbound, now: NOW });
  assert.equal(result.valid, true);
  assert.deepEqual(result.data, {
    route: 10, route_variant: 40, direction: 'outbound', driver: 30, vehicle: 20,
    trip_status: 'active', started_at: NOW.toISOString(), data_mode: 'REAL', is_simulated: false,
  });
  const returnTrip = policy.startTripData({ driver, vehicle, route, variant: inbound, now: NOW });
  assert.equal(returnTrip.data.direction, 'inbound');
  assert.equal(returnTrip.data.route_variant, 41);
  assert.notEqual(returnTrip.data.route_variant, result.data.route_variant);
  console.log('ok - start data preserves the exact selected directional RouteVariant');
}

{
  const otherRoute = { ...route, id: 11, documentId: 'other-route' };
  const mismatch = policy.driverVariantEligibility({
    driver, vehicle, route: otherRoute, variant: { ...outbound, route: otherRoute }, now: NOW,
  });
  assert.equal(mismatch.eligible, false);
  assert.ok(mismatch.reasons.includes('ROUTE_NOT_ASSIGNED_TO_VEHICLE'));
  assert.equal(policy.driverVariantEligibility({ driver, vehicle, route, variant: { ...outbound, operating_status: 'SUSPENDED' }, now: NOW }).eligible, false);
  assert.equal(policy.driverVariantEligibility({ driver, vehicle, route, variant: { ...outbound, direction: 'BIDIRECTIONAL_PATTERN' }, now: NOW }).eligible, false);
  assert.equal(policy.driverVariantEligibility({ driver, vehicle, route, variant: { ...outbound, planning_enabled: false }, now: NOW }).eligible, false);
  console.log('ok - assignment, active status, supported direction and planning gates reject ineligible selection');
}

{
  const simulatedTrust = {
    ...trust, data_mode: 'SIMULATED', verification_status: 'SIMULATED_DEMO',
  };
  const simulatedRoute = { ...route, ...simulatedTrust };
  const simulatedVehicle = { ...vehicle, data_mode: 'SIMULATED', route: simulatedRoute };
  const simulatedDriver = { ...driver, data_mode: 'SIMULATED', vehicle: simulatedVehicle };
  const simulatedVariant = { ...outbound, ...simulatedTrust, route: simulatedRoute };
  const simulation = policy.startTripData({
    driver: simulatedDriver, vehicle: simulatedVehicle, route: simulatedRoute, variant: simulatedVariant, now: NOW,
  });
  assert.equal(simulation.valid, true);
  assert.equal(simulation.data.data_mode, 'SIMULATED');
  assert.equal(simulation.data.is_simulated, true);
  const mixed = policy.driverVariantEligibility({ driver, vehicle: simulatedVehicle, route: simulatedRoute, variant: simulatedVariant, now: NOW });
  assert.equal(mixed.eligible, false);
  assert.ok(mixed.reasons.includes('DATA_MODE_MISMATCH'));
  console.log('ok - REAL and SIMULATED trip facts remain explicit and cannot be mixed');
}

{
  assert.deepEqual(policy.validateCoordinates(15.1, 120.7), { valid: true, latitude: 15.1, longitude: 120.7 });
  assert.equal(policy.validateCoordinates(0, 0).valid, false);
  assert.equal(policy.validateCoordinates(91, 120).valid, false);
  assert.equal(policy.validateCoordinates('secret', 120).valid, false);
  assert.equal(policy.validateRecordedAt('invalid', { now: NOW }).valid, false);
  assert.equal(policy.validateRecordedAt('2026-09-26T01:06:00.000Z', { now: NOW }).valid, false);
  assert.equal(policy.validateRecordedAt('2026-09-26T00:59:00.000Z', { now: NOW, tripStartedAt: '2026-09-26T01:00:00.000Z' }).valid, false);
  assert.equal(policy.validateRecordedAt(NOW.toISOString(), { now: NOW, tripStartedAt: NOW.toISOString() }).valid, true);
  console.log('ok - GPS coordinate and timestamp validation rejects null island, invalid ranges and invalid trip times');
}

{
  assert.deepEqual(policy.occupancyForCount(0, 16), { valid: true, count: 0, level: 'empty', normalized: 'AVAILABLE' });
  assert.equal(policy.occupancyForCount(12, 16).normalized, 'NEAR_FULL');
  assert.equal(policy.occupancyForCount(16, 16).normalized, 'FULL');
  assert.equal(policy.occupancyForCount(17, 16).valid, false);
  assert.equal(policy.normalizeOccupancyLevel(null), 'UNKNOWN');
  assert.equal(policy.normalizeOccupancyLevel('moderate'), 'AVAILABLE');
  assert.equal(policy.endTripData('completed', NOW).data.ended_at, NOW.toISOString());
  assert.equal(policy.endTripData('active', NOW).valid, false);
  console.log('ok - occupancy is capacity-bounded and trip ending accepts terminal states only');
}

{
  const routeDefinition = customRoutes.routes.find((item) => item.path === '/driver-trip-options');
  const activeDefinition = customRoutes.routes.find((item) => item.path === '/driver-active-trip');
  assert.equal(routeDefinition.method, 'GET');
  assert.equal(activeDefinition.method, 'GET');
  assert.notEqual(routeDefinition.config.auth, false);
  assert.notEqual(activeDefinition.config.auth, false);
  const files = {
    trip: fs.readFileSync(path.join(__dirname, '..', 'src/api/trip/controllers/trip.js'), 'utf8'),
    location: fs.readFileSync(path.join(__dirname, '..', 'src/api/vehicle-location/controllers/vehicle-location.js'), 'utf8'),
    vehicle: fs.readFileSync(path.join(__dirname, '..', 'src/api/vehicle/controllers/vehicle.js'), 'utf8'),
    permissions: fs.readFileSync(path.join(__dirname, '..', 'src/services/security/access-control.js'), 'utf8'),
  };
  assert.match(files.trip, /vehicleConflict/);
  assert.match(files.trip, /route_variant: variant\.id/);
  assert.match(files.trip, /active_route_variant: variant\.id/);
  assert.match(files.trip, /active_route_variant: null/);
  assert.match(files.location, /driver\.vehicle/);
  assert.match(files.location, /activeTrip\.route_variant/);
  assert.match(files.location, /trip: activeTrip\.id/);
  assert.match(files.vehicle, /trip_status: 'active'/);
  assert.match(files.permissions, /api::trip\.trip\.options/);
  assert.match(files.permissions, /api::trip\.trip\.active/);
  assert.doesNotMatch(Object.values(files).join('\n'), /San Luis|SL-SF|\.reverse\(/i);
  console.log('ok - authenticated options, ownership checks, conflict checks, exact GPS attribution and no reverse/San Luis fallback are wired');
}
