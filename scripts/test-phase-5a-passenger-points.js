'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  manifest,
  validateManifest,
  buildNodeData,
} = require('./seed-phase5a-passenger-points');
const {
  planningEligibilityFor,
} = require('../src/services/transport-data/planning-eligibility');

const root = path.join(__dirname, '..');

assert.doesNotThrow(validateManifest);
assert.strictEqual(manifest.transport_nodes.length, 2);

const byCode = Object.fromEntries(
  manifest.transport_nodes.map((node) => [node.internal_code, node])
);
const sm = byCode['RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF'];
const robinsons = byCode['RCH-ROB-STARMILLS-ARAYAT-GATE-LOAD'];

assert.ok(sm, 'SM main-gate research node is missing');
assert.ok(robinsons, 'Robinsons Arayat Gate research node is missing');
assert.strictEqual(sm.display_name, 'SM City Pampanga Main Gate Drop-off Area');
assert.strictEqual(sm.node_type, 'DROP_OFF');
assert.strictEqual(sm.passenger_direction_role, 'OUTBOUND_DROPOFF');
assert.strictEqual(
  robinsons.display_name,
  'Robinsons Starmills – Arayat Gate Return Loading Area'
);
assert.strictEqual(robinsons.node_type, 'LOADING_BAY');
assert.strictEqual(robinsons.passenger_direction_role, 'INBOUND_LOADING');
assert.notStrictEqual(sm.internal_code, robinsons.internal_code);
assert.notStrictEqual(sm.passenger_direction_role, robinsons.passenger_direction_role);

for (const node of [sm, robinsons]) {
  const data = buildNodeData(node);
  assert.strictEqual(node.verification_status, 'CORROBORATED_RESEARCH');
  assert.strictEqual(node.data_mode, 'REAL');
  assert.strictEqual(node.planning_enabled, false);
  assert.strictEqual(node.latitude, null);
  assert.strictEqual(node.longitude, null);
  assert.strictEqual(node.google_place_id, null);
  assert.strictEqual(data.planning_enabled, false);
  assert.strictEqual(data.verification_status, 'CORROBORATED_RESEARCH');
  assert.strictEqual(data.latitude, null);
  assert.strictEqual(data.longitude, null);
  assert.strictEqual(data.google_place_id, null);
  assert.match(data.notes, /NOT PHYSICAL FIELD VERIFICATION/);
  assert.strictEqual(planningEligibilityFor(data).eligible, false);

  const serialized = JSON.stringify(node);
  for (const forbidden of ['fare', 'schedule', 'headway', 'geometry', 'polyline']) {
    assert.ok(!Object.hasOwn(node, forbidden), `${node.internal_code} defines ${forbidden}`);
  }
  assert.doesNotMatch(serialized, /FIELD_VERIFIED/);
}

assert.deepStrictEqual(manifest.operational_facts.fare_rules, []);
assert.deepStrictEqual(manifest.operational_facts.service_patterns, []);
assert.deepStrictEqual(manifest.operational_facts.route_geometry, []);
assert.deepStrictEqual(manifest.operational_facts.route_variant_stops, []);
assert.notStrictEqual(
  manifest.route_variant_endpoint_policy.outbound_endpoint_node_code,
  manifest.route_variant_endpoint_policy.inbound_start_node_code
);

const seeder = fs.readFileSync(
  path.join(root, 'scripts', 'seed-phase5a-passenger-points.js'),
  'utf8'
);
assert.match(seeder, /where node_code = \$1[\s\S]*for update/i);
assert.match(seeder, /await client\.query\('begin'\)/);
assert.match(seeder, /pg_advisory_xact_lock/);
assert.match(seeder, /FIELD_VERIFIED.*AUTHORITATIVE_CURRENT/);
assert.doesNotMatch(seeder, /\b(drop\s+table|truncate\s+table|delete\s+from)\b/i);
assert.doesNotMatch(seeder, /planning_enabled\s*:\s*true/);

const evidenceDoc = fs.readFileSync(
  path.join(root, 'documentation', 'phase-5a-commuter-interview-evidence.md'),
  'utf8'
);
assert.match(evidenceDoc, /REMOTE VISUAL CORROBORATION — NOT PHYSICAL FIELD VERIFICATION/);
assert.match(evidenceDoc, /2026-09-22/);
assert.match(evidenceDoc, /Google Maps Street View/);

const checklist = fs.readFileSync(
  path.join(root, 'documentation', 'phase-5-san-juan-field-verification-checklist.md'),
  'utf8'
);
assert.match(checklist, /\[~\] SM City Pampanga main-gate drop-off area/);
assert.match(checklist, /\[~\] Robinsons Starmills Arayat Gate return-loading area/);
assert.match(checklist, /\[ \] Exact transport GPS point at SM main gate/);
assert.match(checklist, /\[ \] Exact San Juan jeep bay at Arayat Gate/);

console.log('ok - separate SM outbound and Robinsons inbound passenger-point concepts exist');
console.log('ok - both records remain corroborated research with null coordinates');
console.log('ok - no fare, schedule, geometry, or incomplete stop sequence is invented');
console.log('ok - planning eligibility rejects both remote-research nodes');
console.log('ok - evidence documentation and partial checklist state are explicit');
