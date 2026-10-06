'use strict';
// Explicit approved expectations; never accept the live database as baseline.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EXPECTED_DIGEST, DISTANCES } = require('../fixtures/approved-pilot-geometry');
function expectedGeometry(code) {
  const manifest = require('../data/batch-a5b-approved-geometry.json');
  const approved = manifest.approved.find(v => v.variant_code === code);
  assert.ok(approved, 'Unexpected pilot variant');
  const bytes = fs.readFileSync(path.join(__dirname, '../../documentation/batch-a5-candidates', approved.filename));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), approved.sha256);
  return JSON.parse(bytes).features[0].geometry;
}
function assertPilotGeometry(record) {
  assert.deepEqual(record.geometry_geojson, expectedGeometry(record.variant_code));
  if (Object.hasOwn(record, 'geometry_source')) assert.equal(record.geometry_source, 'MANUAL_VERIFIED');
  if (Object.hasOwn(record, 'encoded_polyline')) assert.equal(record.encoded_polyline, null);
  if (record.route_variant_stops) {
    assert.deepEqual(record.route_variant_stops.map(s => s.distance_from_variant_start_m), [0, DISTANCES[record.variant_code]]);
  }
}
module.exports = { EXPECTED_DIGEST, expectedGeometry, assertPilotGeometry };
