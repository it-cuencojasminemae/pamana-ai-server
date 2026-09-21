'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');
const schema = (api) => JSON.parse(
  read('src', 'api', api, 'content-types', api, 'schema.json')
);

const verificationStatuses = [
  'AUTHORITATIVE_CURRENT',
  'FIELD_VERIFIED',
  'CORROBORATED_RESEARCH',
  'HISTORICAL_UNVERIFIED',
  'SIMULATED_DEMO',
  'RESEARCH_CANDIDATE',
];

const route = schema('route');
const routeStop = schema('route-stop');
const vehicle = schema('vehicle');
const trip = schema('trip');
const driver = schema('driver');
const routeVariant = schema('route-variant');
const transportNode = schema('transport-node');
const routeVariantStop = schema('route-variant-stop');
const fareRule = schema('fare-rule');
const servicePattern = schema('service-pattern');

for (const field of ['origin', 'destination', 'base_fare', 'estimated_travel_time', 'route_stops']) {
  assert.ok(route.attributes[field], `Route compatibility field ${field} was removed`);
}
assert.ok(route.attributes.route_variants);
assert.ok(route.attributes.transport_mode);
assert.strictEqual(route.attributes.active.default, false);

for (const [name, value] of Object.entries({
  routeVariant,
  transportNode,
  fareRule,
  servicePattern,
})) {
  assert.strictEqual(value.attributes.planning_enabled.default, false, `${name} planning default`);
  assert.strictEqual(
    value.attributes.verification_status.default,
    'RESEARCH_CANDIDATE',
    `${name} weak verification default`
  );
  assert.deepStrictEqual(value.attributes.verification_status.enum, verificationStatuses);
  assert.deepStrictEqual(value.attributes.data_mode.enum, ['REAL', 'SIMULATED']);
}

assert.strictEqual(routeVariant.collectionName, 'route_variants');
assert.strictEqual(routeVariant.attributes.variant_code.unique, true);
assert.deepStrictEqual(routeVariant.attributes.direction.enum, [
  'OUTBOUND',
  'INBOUND',
  'LOOP',
  'BIDIRECTIONAL_PATTERN',
]);
assert.strictEqual(routeVariant.attributes.operating_status.default, 'UNKNOWN');
assert.strictEqual(routeVariant.attributes.geometry_source.default, 'UNKNOWN');
assert.strictEqual(routeVariant.attributes.encoded_polyline.required, undefined);
assert.strictEqual(routeVariant.attributes.geometry_geojson.required, undefined);

assert.strictEqual(transportNode.collectionName, 'transport_nodes');
assert.strictEqual(transportNode.attributes.node_code.unique, true);
assert.strictEqual(transportNode.attributes.latitude.required, undefined);
assert.strictEqual(transportNode.attributes.longitude.required, undefined);
assert.strictEqual(transportNode.attributes.latitude.default, undefined);
assert.strictEqual(transportNode.attributes.longitude.default, undefined);
assert.strictEqual(transportNode.attributes.covered_waiting_area.required, undefined);
assert.strictEqual(transportNode.attributes.wheelchair_accessible.required, undefined);

assert.strictEqual(routeVariantStop.collectionName, 'route_variant_stops');
for (const field of [
  'route_variant',
  'transport_node',
  'sequence',
  'pickup_allowed',
  'dropoff_allowed',
  'transfer_allowed',
  'is_timepoint',
  'instruction_template',
  'distance_from_variant_start_m',
]) {
  assert.ok(routeVariantStop.attributes[field], `RouteVariantStop is missing ${field}`);
}

for (const field of [
  'regular_base_fare',
  'base_distance_km',
  'per_km_after_base',
  'minimum_fare',
  'rounding_rule',
  'student_discount_percent',
  'senior_discount_percent',
  'pwd_discount_percent',
]) {
  assert.strictEqual(fareRule.attributes[field].required, undefined, `${field} must be nullable`);
}
assert.strictEqual(fareRule.attributes.currency.default, 'PHP');

for (const field of [
  'first_trip_time',
  'last_trip_time',
  'headway_min_minutes',
  'headway_max_minutes',
]) {
  assert.strictEqual(servicePattern.attributes[field].required, undefined, `${field} must be nullable`);
}
assert.strictEqual(servicePattern.attributes.dispatch_type.default, 'UNKNOWN');
assert.notStrictEqual(servicePattern.attributes.headway_min_minutes.default, 15);
assert.notStrictEqual(servicePattern.attributes.headway_max_minutes.default, 15);

for (const [contentType, field] of [
  [routeStop, 'covered_waiting_area'],
  [routeStop, 'accessible_toilet_nearby'],
  [vehicle, 'wheelchair_accessible'],
  [vehicle, 'low_floor'],
]) {
  assert.strictEqual(contentType.attributes[field].required, undefined, `${field} must allow null`);
  assert.strictEqual(contentType.attributes[field].default, undefined, `${field} must default to unknown`);
}

assert.ok(trip.attributes.route_variant);
assert.strictEqual(trip.attributes.route_variant.required, undefined);
assert.strictEqual(trip.attributes.direction.required, undefined);
assert.ok(trip.attributes.data_mode);
assert.ok(vehicle.attributes.active_route_variant);
assert.strictEqual(vehicle.attributes.active_route_variant.required, undefined);
assert.ok(vehicle.attributes.data_mode);
assert.strictEqual(driver.attributes.route_variant, undefined, 'Driver must remain unchanged');

const backfill = read('scripts', 'backfill-revised-transport-data.js');
assert.match(backfill, /await client\.query\('begin'\)/);
assert.match(backfill, /await client\.query\('commit'\)/);
assert.match(backfill, /where planning_enabled is null/);
assert.match(backfill, /where active is null/);
assert.match(backfill, /set active = \(route_status = 'active'\)/);
assert.match(backfill, /Legacy row counts changed/);
assert.doesNotMatch(backfill, /\b(insert into|delete from|truncate|drop table|drop column)\b/i);
assert.doesNotMatch(backfill, /planning_enabled\s*=\s*true/i);
assert.doesNotMatch(backfill, /San Juan/i);

const bootstrap = read('src', 'index.js');
assert.match(bootstrap, /TRANSPORT_KNOWLEDGE_READ_ACTIONS/);
assert.match(bootstrap, /TRANSPORT_KNOWLEDGE_ADMIN_ACTIONS/);
assert.doesNotMatch(bootstrap, /Public\s*:/);

console.log('ok - legacy Route, RouteStop, Vehicle, Trip, and Driver schemas remain compatible');
console.log('ok - directional transport knowledge content types and relations exist');
console.log('ok - planning and verification defaults are conservative');
console.log('ok - coordinates, fares, service times, and accessibility may be null');
console.log('ok - the explicit backfill is transactional, additive, and idempotent');
console.log('ok - no compatibility record can be promoted or renamed to San Juan');
