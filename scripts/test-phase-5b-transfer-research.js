'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { manifest, validateManifest, rowData } = require('./seed-phase5b-transfer-research');
const { planningEligibilityFor } = require('../src/services/transport-data/planning-eligibility');

validateManifest();
for (const [collection, table, api] of [
  ['nodes', 'transport_nodes', 'transport-node'],
  ['routes', 'routes', 'route'],
  ['variants', 'route_variants', 'route-variant'],
]) {
  const schema = require(`../src/api/${api}/content-types/${api}/schema.json`);
  for (const record of manifest[collection]) {
    const data = rowData(record, table);
    for (const key of Object.keys(data)) assert.ok(schema.attributes[key], `Unknown attribute ${api}.${key}`);
    assert.equal(planningEligibilityFor(data).eligible, false);
    assert.equal(planningEligibilityFor({ ...data, planning_enabled: true }).eligible, false);
    assert.doesNotMatch(JSON.stringify(data), /San Luis/i);
  }
}
const [psu, bayan] = manifest.nodes;
assert.equal(psu.node_code, 'RCH-PSU-MEXICO-FRONT');
assert.equal(psu.node_type, 'DESIGNATED_STOP');
assert.equal(bayan.node_code, 'RCH-MEXICO-BAYAN-STA-MONICA-TRANSFER');
assert.equal(bayan.node_type, 'TRANSFER_POINT');
const [outbound, inbound] = manifest.variants;
assert.equal(outbound.variant_code, 'RCH-SJ-SMROB-OUT');
assert.equal(inbound.variant_code, 'RCH-SJ-SMROB-IN');
assert.equal(outbound.direction, 'OUTBOUND');
assert.equal(inbound.direction, 'INBOUND');
assert.equal(outbound.start_node_code, psu.node_code);
assert.equal(inbound.end_node_code, psu.node_code);
assert.equal(outbound.end_node_code, 'RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF');
assert.equal(inbound.start_node_code, 'RCH-ROB-STARMILLS-ARAYAT-GATE-LOAD');
assert.notEqual(outbound.end_node_code, inbound.start_node_code);
assert.equal(outbound.signboard_text, 'SM/Rob');
assert.equal(inbound.signboard_text, null);
assert.equal(manifest.routes[0].route_code, 'RCH-ARAYAT-SF-VIA-STAANA-MEXICO');
assert.equal(manifest.journey_candidates.length, 2);
assert.equal(manifest.journey_candidates[1].legs.length, 2);
assert.equal(manifest.journey_candidates[1].transfer_node_code, bayan.node_code);
assert.ok(manifest.journey_candidates.every((candidate) => candidate.planning_enabled === false));
assert.equal(manifest.reported_outbound_locality_sequence.sequence.length, 9);
assert.equal(manifest.road_reference.geometry_source, 'UNKNOWN');
assert.equal(manifest.road_reference.geometry, null);
assert.equal(manifest.fare_policy.student_discount_percent, 20);
assert.equal(manifest.fare_policy.legal_basis, 'RA 11314');
assert.match(manifest.fare_policy.storage, /policy only/);
assert.equal(manifest.fare_policy.regular_fares, null);
assert.equal(manifest.reported_operations.reported_dispatch_type, 'LEAVE_WHEN_FULL');
assert.equal(manifest.reported_operations.reported_service_end, 'approximately 16:30');
for (const key of ['headway_min_minutes', 'headway_max_minutes', 'last_trip_time']) {
  assert.equal(manifest.reported_operations[key], null);
}
const doc = fs.readFileSync(path.join(__dirname, '../documentation/phase-5b-san-juan-route-refinement.md'), 'utf8');
assert.match(doc, /CONFLICTING \/ MULTIPLE SERVICE PATTERNS/);
assert.match(doc, /NOT PHYSICAL FIELD VERIFICATION/);
assert.match(doc, /not universally available/);
const checklist = fs.readFileSync(path.join(__dirname, '../documentation/phase-5-san-juan-field-verification-checklist.md'), 'utf8');
for (const item of ['PSU Mexico campus-front boarding area', 'PSU campus-front return drop-off', 'Mexico Bayan / Sta. Monica transfer area', 'Leave-when-full behavior', 'Service usually unavailable after ~4:30 PM']) {
  assert.ok(checklist.includes(`[~] ${item}`));
}
console.log('ok - Phase 5B manifest, asymmetric endpoints, evidence limits, policy-only fare/dispatch notes and closed planning gate');
