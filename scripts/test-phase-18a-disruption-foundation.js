'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  DISRUPTION_EFFECT,
  conservativeDisruptionDefaults,
  enforceTrustManagementRole,
  validDisruptionGeometry,
  validateDisruption,
} = require('../src/services/disruption/disruption-foundation');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const schema = JSON.parse(read('src/api/disruption/content-types/disruption/schema.json'));
const attributes = schema.attributes;
const verificationStatuses = [
  'AUTHORITATIVE_CURRENT', 'FIELD_VERIFIED', 'CORROBORATED_RESEARCH',
  'HISTORICAL_UNVERIFIED', 'SIMULATED_DEMO', 'RESEARCH_CANDIDATE',
];
const effects = [
  'WARNING_ONLY', 'LIMITED_SERVICE', 'ROUTE_SUSPENDED', 'VARIANT_SUSPENDED',
  'NODE_CLOSED', 'BOARDING_CLOSED', 'ALIGHTING_CLOSED', 'TRANSFER_BLOCKED',
];

assert.deepEqual(attributes.effect.enum, effects);
assert.deepEqual(Object.values(DISRUPTION_EFFECT), effects);
for (const [name, target] of [
  ['affected_route', 'api::route.route'],
  ['affected_route_variant', 'api::route-variant.route-variant'],
  ['affected_transport_node', 'api::transport-node.transport-node'],
]) {
  assert.equal(attributes[name].type, 'relation');
  assert.equal(attributes[name].relation, 'manyToOne');
  assert.equal(attributes[name].target, target);
  assert.equal(attributes[name].required, undefined);
}
assert.equal(attributes.planning_enabled.default, false);
assert.deepEqual(attributes.verification_status.enum, verificationStatuses);
assert.equal(attributes.verification_status.default, 'RESEARCH_CANDIDATE');
assert.equal(attributes.data_mode.default, 'SIMULATED');
assert.equal(attributes.geometry_source.default, 'UNKNOWN');
for (const field of ['starts_at', 'ends_at', 'disruption_status', 'resolved_at', 'resolution_notes']) {
  assert.ok(attributes[field], `${field} must remain structured`);
}
assert.equal(attributes.geometry_geojson.type, 'json');

const base = conservativeDisruptionDefaults({
  type: 'road_closure', title: 'Unit fixture', severity: 'moderate',
  starts_at: '2026-09-27T00:00:00.000Z', disruption_status: 'active',
  effect: 'WARNING_ONLY', source: 'unit-test',
});
assert.equal(base.planning_enabled, false);
assert.equal(base.verification_status, 'RESEARCH_CANDIDATE');
assert.equal(base.data_mode, 'SIMULATED');
assert.equal(base.geometry_source, 'UNKNOWN');
assert.equal(validateDisruption(base, { requireEffect: true }).valid, true);

const targetCases = [
  ['ROUTE_SUSPENDED', 'affected_route', 'route'],
  ['VARIANT_SUSPENDED', 'affected_route_variant', 'variant'],
  ['NODE_CLOSED', 'affected_transport_node', 'node'],
  ['BOARDING_CLOSED', 'affected_transport_node', 'node'],
  ['ALIGHTING_CLOSED', 'affected_transport_node', 'node'],
  ['TRANSFER_BLOCKED', 'affected_transport_node', 'node'],
];
for (const [effect, field, targetKey] of targetCases) {
  const missing = validateDisruption({ ...base, effect }, { requireEffect: true });
  assert.equal(missing.valid, false, `${effect} must require its explicit target`);
  const valid = validateDisruption(
    { ...base, effect, [field]: `${targetKey}-document-id` },
    { requireEffect: true, targetRecords: { [targetKey]: { documentId: `${targetKey}-document-id` } } },
  );
  assert.equal(valid.valid, true, `${effect} accepts an existing explicit target`);
}
assert.equal(validateDisruption({ ...base, effect: 'LIMITED_SERVICE' }).valid, false);
assert.equal(validateDisruption({ ...base, effect: 'LIMITED_SERVICE', affected_route: 'route-id' }, {
  targetRecords: { route: { documentId: 'route-id' } },
}).valid, true);

const mismatched = validateDisruption({
  ...base, effect: 'VARIANT_SUSPENDED', affected_route: 'route-a', affected_route_variant: 'variant-b',
}, { targetRecords: {
  route: { documentId: 'route-a' },
  variant: { documentId: 'variant-b', route: { documentId: 'route-b' } },
} });
assert.ok(mismatched.errors.includes('VARIANT_ROUTE_MISMATCH'));

const trusted = {
  ...base,
  effect: 'ROUTE_SUSPENDED', affected_route: 'route-a', planning_enabled: true,
  verification_status: 'FIELD_VERIFIED', data_mode: 'REAL',
  verified_at: '2026-09-27T00:05:00.000Z', source_name: 'LGU advisory desk',
  source_reference: 'ADVISORY-18A-UNIT',
};
assert.equal(validateDisruption(trusted, { targetRecords: { route: { documentId: 'route-a' } } }).valid, true);
assert.equal(validateDisruption({ ...trusted, data_mode: 'SIMULATED' }, {
  targetRecords: { route: { documentId: 'route-a' } },
}).valid, false);
assert.equal(validateDisruption({ ...trusted, verification_status: 'CORROBORATED_RESEARCH' }, {
  targetRecords: { route: { documentId: 'route-a' } },
}).valid, false);
assert.equal(validateDisruption({ ...trusted, source_reference: null }, {
  targetRecords: { route: { documentId: 'route-a' } },
}).valid, false);

assert.equal(validDisruptionGeometry({ type: 'Point', coordinates: [120.7, 15.1] }), true);
assert.equal(validDisruptionGeometry({ type: 'LineString', coordinates: [[120.7, 15.1], [120.71, 15.11]] }), true);
assert.equal(validDisruptionGeometry({ type: 'Polygon', coordinates: [[[120.7, 15.1], [120.71, 15.1], [120.71, 15.11], [120.7, 15.1]]] }), true);
assert.equal(validDisruptionGeometry({ type: 'Point', coordinates: [0, 0] }), false);
assert.equal(validDisruptionGeometry({ type: 'GeometryCollection', geometries: [] }), false);
assert.equal(validateDisruption({ ...base, geometry_source: 'FIELD_GPS' }).valid, false);

const resolved = validateDisruption({ ...base, disruption_status: 'resolved' });
assert.ok(resolved.errors.includes('RESOLVED_AT_REQUIRED'));
assert.ok(resolved.errors.includes('RESOLUTION_NOTES_REQUIRED'));
assert.equal(validateDisruption({ ...base, disruption_status: 'resolved' }, {
  requireResolutionDetails: false,
}).valid, true, 'legacy resolved rows remain editable without invented resolution facts');
assert.equal(validateDisruption({
  ...base, disruption_status: 'resolved', resolved_at: '2026-09-27T01:00:00.000Z',
  resolution_notes: 'LGU confirmed the road reopened.',
}).valid, true);

const namesAndCoordinatesOnly = validateDisruption({
  ...base, effect: 'ROUTE_SUSPENDED', route_name: 'Any matching route',
  node_name: 'Nearby stop', signboard: 'Matching signboard',
  description: 'Suspended near the terminal', latitude: 15.1, longitude: 120.7,
});
assert.ok(namesAndCoordinatesOnly.errors.includes('AFFECTED_ROUTE_REQUIRED'));

assert.ok(enforceTrustManagementRole({ planning_enabled: true }).includes('PLANNING_ENABLED_ADMIN_ONLY'));
assert.ok(enforceTrustManagementRole({ verification_status: 'FIELD_VERIFIED' }).includes('VERIFICATION_STATUS_ADMIN_ONLY'));
assert.deepEqual(enforceTrustManagementRole({ planning_enabled: true }, { isAdministrator: true }), []);
assert.deepEqual(enforceTrustManagementRole({
  disruption_status: 'resolved', ends_at: '2026-09-27T01:00:00.000Z',
  resolved_at: '2026-09-27T01:00:00.000Z', resolution_notes: 'Road reopened.',
}, { existing: trusted }), []);
assert.ok(enforceTrustManagementRole({ effect: 'WARNING_ONLY' }, { existing: trusted })
  .includes('PLANNING_ENABLED_DISRUPTION_ADMIN_ONLY'));

const orchestrator = read('src/services/pamana-journey/trip-plan-orchestrator.js');
assert.doesNotMatch(orchestrator, /disruption/i, 'Phase 18A must not integrate disruption filtering');
const bootstrap = read('src/index.js');
assert.match(bootstrap, /whereNull\('planning_enabled'\)\.update\(\{ planning_enabled: false \}\)/);
assert.match(bootstrap, /RESEARCH_CANDIDATE/);
assert.doesNotMatch(bootstrap, /disruptions[\s\S]{0,500}planning_enabled[^\n]*true/i);
const permissionsBlock = bootstrap.slice(bootstrap.indexOf('const REQUIRED_ROLE_PERMISSIONS'), bootstrap.indexOf('/**', bootstrap.indexOf('const REQUIRED_ROLE_PERMISSIONS')));
assert.match(permissionsBlock, /LGU:[\s\S]*disruption\.disruption\.create/);
assert.match(permissionsBlock, /Administrator:[\s\S]*disruption\.disruption\.update/);
assert.doesNotMatch(permissionsBlock.match(/Passenger:[\s\S]*?Driver:/)?.[0] || '', /disruption\.disruption\.(create|update)/);
assert.doesNotMatch(permissionsBlock.match(/Driver:[\s\S]*?LGU:/)?.[0] || '', /disruption\.disruption\.(create|update)/);

console.log('ok - Phase 18A schema adds explicit optional targets and deterministic effects');
console.log('ok - trust, data mode, evidence, time, resolution, and GeoJSON validation are conservative');
console.log('ok - names, text, signboards, and nearby coordinates cannot satisfy target validation');
console.log('ok - journey orchestration remains untouched and non-admin trust elevation is rejected');
