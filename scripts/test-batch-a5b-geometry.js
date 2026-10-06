'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { manifest, loadCandidateArtifacts, planVariant, assertAllowedChanges } = require('./apply-batch-a5b-approved-geometry');
const { rawJeepneyFare } = require('../src/services/pamana-journey/fare-policy');
const { beforeApplicationVariants, DISTANCES } = require('./fixtures/approved-pilot-geometry');
const candidates = loadCandidateArtifacts();
const variants = beforeApplicationVariants();

test('approved files are hash-pinned and independent, with exact frozen endpoints and valid road geometry', () => {
  assert.equal(candidates.length, 4); assert.equal(new Set(candidates.map(c => c.definition.request_id)).size, 4);
  assert.notDeepEqual(candidates[1].geometry, candidates[0].geometry);
  assert.notDeepEqual(candidates[1].geometry.coordinates[0], [...candidates[0].geometry.coordinates[0]].reverse());
  candidates.forEach((c, i) => {
    assert.equal(c.definition.variant_id, variants[i].id);
    assert.deepEqual(c.definition.origin_coordinates, [Number(variants[i].route_variant_stops[0].transport_node.longitude), Number(variants[i].route_variant_stops[0].transport_node.latitude)]);
  });
});
test('candidate checksum mismatch refuses all application before a DB connection', () => {
  const original = manifest.approved[0].sha256;
  try { manifest.approved[0].sha256 = '0'.repeat(64); assert.throws(loadCandidateArtifacts, /Approved artifact changed/); }
  finally { manifest.approved[0].sha256 = original; }
});
test('cumulative stops use production road projection relative to first stop, rounded for integer schema', () => {
  const expected = candidates.map(c => DISTANCES[c.definition.variant_code]);
  variants.forEach((v, i) => {
    const p = planVariant(v, candidates[i]);
    assert.deepEqual(p.stops.map(s => s.after), [0, expected[i]]);
    assert.equal(p.stored_road_distance_m, Math.round(p.unrounded_road_distance_m));
    assert.notEqual(p.stored_road_distance_m, candidates[i].definition.provider_reported_distance_m);
    assert.equal(p.after_geometry_source, 'MANUAL_VERIFIED');
    assert.equal(p.verification_status, 'FIELD_VERIFIED'); assert.equal(p.data_mode, 'REAL'); assert.equal(p.planning_enabled, true);
    assert.ok(p.notes.startsWith(v.notes)); assert.match(p.notes, /Provider: Geoapify/); assert.match(p.notes, /approval date: 2026-10-05/);
  });
});
test('geometry or endpoint mismatch, unknown mode, ambiguous stops and existing distance are refused', () => {
  for (const mutate of [
    v => { v.geometry_geojson = { type: 'LineString', coordinates: [[120, 15], [121, 16]] }; },
    v => { v.route_variant_stops[0].transport_node.node_code = 'UNAPPROVED'; },
    v => { v.route.transport_mode = 'PUJ_MODERN'; },
    v => { v.route_variant_stops.push(structuredClone(v.route_variant_stops[0])); },
    v => { v.route_variant_stops[0].distance_from_variant_start_m = 99; },
    v => { v.planning_enabled = false; },
  ]) { const v = structuredClone(variants[0]); mutate(v); assert.throws(() => planVariant(v, candidates[0])); }
});
test('reapplying exact approved geometry, provenance and distances is a no-op; drift is refused', () => {
  variants.forEach((v, i) => {
    const p = planVariant(v, candidates[i]), applied = structuredClone(v);
    applied.geometry_geojson = structuredClone(p.geometry); applied.geometry_source = 'MANUAL_VERIFIED'; applied.notes = p.notes;
    applied.route_variant_stops.forEach((s, j) => { s.distance_from_variant_start_m = p.stops[j].after; });
    assert.equal(planVariant(applied, candidates[i]).action, 'UNCHANGED');
    applied.route_variant_stops[1].distance_from_variant_start_m += 1;
    assert.throws(() => planVariant(applied, candidates[i]), /Stored cumulative distance differs/);
  });
});
test('expected system fare calculations follow geometry-derived integer distances without a fare override', () => {
  const expected = [[27, 22], [28, 23], [14, 11]];
  variants.slice(0, 3).forEach((v, i) => {
    const p = planVariant(v, candidates[i]), raw = rawJeepneyFare(v.route.transport_mode, p.stored_road_distance_m);
    assert.deepEqual([Math.round(raw), Math.round(raw * 0.8)], expected[i]);
  });
});
test('global receipt guard detects any unrelated row, inserted record or sequence change', () => {
  const before = { state: { routes: [{ key: '1', hash: 'old' }] }, sequences: [{ last_value: 1 }] };
  assert.deepEqual(assertAllowedChanges(before, structuredClone(before), [], false), []);
  const changed = structuredClone(before); changed.state.routes[0].hash = 'new'; assert.throws(() => assertAllowedChanges(before, changed, [], true));
  const inserted = structuredClone(before); inserted.state.routes.push({ key: '2', hash: 'new' }); assert.throws(() => assertAllowedChanges(before, inserted, [], true));
  const seq = structuredClone(before); seq.sequences[0].last_value++; assert.throws(() => assertAllowedChanges(before, seq, [], true));
});
