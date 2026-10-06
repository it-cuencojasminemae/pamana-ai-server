'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CODES, ENDPOINTS, SETTINGS, routeCandidate, requestParameters, measureGeometry,
  farePreview, assertNoSecrets, REPORT, OUTPUT, multiLegPreview } = require('./generate-batch-a5-candidates');
const { createReviewServer } = require('./serve-batch-a5-review');
const { rawJeepneyFare } = require('../src/services/pamana-journey/fare-policy');
const { roadLine } = require('../src/services/pamana-journey/route-distance');
const report = require('./fixtures/geometry-review').reviewContract();
const geometry = { type: 'LineString', coordinates: [[120.698, 15.128], [120.72, 15.08], [120.699, 15.05]] };
const payload = { type: 'FeatureCollection', properties: { apiKey: 'TEST_SECRET_DO_NOT_EXPORT' }, features: [{
  type: 'Feature', geometry, properties: { distance: 10709, distance_units: 'meters', time: 890.5, legs: [] },
}] };

test('exact database endpoint numbers are retained in artifact metadata and request order', () => {
  assert.deepEqual(report.variants.map(v => v.variant_code), CODES);
  for (const v of report.variants) {
    assert.deepEqual(v.origin_coordinates, ENDPOINTS[v.origin_node_code]);
    assert.deepEqual(v.destination_coordinates, ENDPOINTS[v.destination_node_code]);
    assert.equal(v.request_parameters.waypoints, requestParameters({ stops: [v.origin, v.destination] }).waypoints);
  }
});
test('four requests are independent; return starts at Robinsons and is never reversed outbound', async () => {
  const requests = [], requestIds = [];
  for (const v of report.inputs) {
    const result = await routeCandidate(v, { key: 'TEST_SECRET_DO_NOT_EXPORT', fetchImpl: async url => {
      requests.push(Object.fromEntries(url.searchParams)); return { ok: true, json: async () => structuredClone(payload) };
    } });
    requestIds.push(result.summary.request_id);
    assertNoSecrets(JSON.stringify(result), 'TEST_SECRET_DO_NOT_EXPORT');
    assert.equal(Object.hasOwn(result.geojson, 'properties'), false, 'Provider request properties are discarded');
  }
  assert.equal(requests.length, 4);
  assert.equal(new Set(requestIds).size, 4);
  assert.notEqual(requests[0].waypoints, requests[1].waypoints);
  assert.equal(requests[1].waypoints.split('|')[0], '15.050605637995128,120.69778203294244');
  assert.equal(new Set(report.variants.map(v => v.request_id)).size, 4);
});
test('generated GeoJSON has valid road lines, positive metrics and pending candidate metadata', () => {
  for (const v of report.variants) {
    const geo = JSON.parse(fs.readFileSync(path.join(OUTPUT, v.geojson_filename), 'utf8'));
    assert.equal(geo.type, 'FeatureCollection'); assert.equal(geo.features.length, 1);
    const f = geo.features[0]; assert.equal(f.type, 'Feature');
    const measured = measureGeometry(f.geometry);
    assert.equal(measured.meters, v.geometry_measured_distance_m);
    assert.ok(v.candidate_distance_m > 0 && v.candidate_duration_s > 0);
    assert.equal(v.candidate_distance_km, v.candidate_distance_m / 1000);
    assert.equal(v.measured_minus_provider_distance_m, measured.meters - v.candidate_distance_m);
    assert.equal(f.properties.candidate_only, true); assert.equal(f.properties.provider, 'GEOAPIFY');
    assert.equal(f.properties.review_status, 'PENDING_MANUAL_REVIEW');
    assert.equal(Object.hasOwn(f.properties, 'geometry_source'), false);
    assert.equal(roadLine({ geometry_geojson: geo.features[0], geometry_source: 'UNKNOWN' }), null,
      'Production geometry trust gate rejects unknown provenance');
  }
});
test('independent length sums road segments and never bridges disconnected parts', () => {
  const measured = measureGeometry(geometry);
  assert.ok(measured.meters > 0);
  const split = measureGeometry({ type: 'MultiLineString', coordinates: [geometry.coordinates.slice(0, 2), [[121, 16], [121.01, 16.01]]] });
  assert.ok(split.disconnectedGapMeters > 1000);
  assert.ok(split.meters < split.disconnectedGapMeters);
  assert.throws(() => measureGeometry({ type: 'Point', coordinates: [120, 15] }));
  assert.throws(() => measureGeometry({ type: 'LineString', coordinates: [[120, 15], [120, 15]] }));
  assert.throws(() => measureGeometry({ type: 'LineString', coordinates: [[120, 15], [200, 15]] }));
});
test('candidate fares call Batch A policy and round raw discount to whole pesos', () => {
  for (const v of report.variants.filter(v => !v.variant_code.includes('TRICYCLE'))) {
    assert.deepEqual(v.fare_preview, farePreview(v.candidate_distance_m));
    assert.equal(v.fare_preview.status, 'CANDIDATE_FARE_PREVIEW');
    for (const mode of ['PUJ_TRADITIONAL', 'PUJ_MODERN']) {
      const f = v.fare_preview[mode], raw = rawJeepneyFare(mode, v.candidate_distance_m);
      assert.equal(f.raw_calculation_php, raw); assert.equal(f.regular_php, Math.round(raw));
      assert.equal(f.discounted_php, Math.round(raw * 0.8));
      assert.ok(Number.isInteger(f.regular_php) && Number.isInteger(f.discounted_php));
    }
  }
});
test('fixed tricycle fare is PHP 100 DEMO_ESTIMATE; multi-leg preview has one transfer', () => {
  const tricycle = report.variants[3].fare_preview;
  assert.equal(tricycle.fare_php, 100); assert.equal(tricycle.status, 'DEMO_ESTIMATE');
  assert.equal(tricycle.distance_used_for_fare, false);
  assert.deepEqual(report.multi_leg_journey, multiLegPreview(report.variants[2]));
  assert.equal(report.multi_leg_journey.transfers, 1); assert.equal(report.multi_leg_journey.vehicle_legs, 2);
  assert.equal(report.direct_journey.transfers, 0); assert.equal(report.return_journey.transfers, 0);
  assert.notEqual(report.variants[0].candidate_distance_m, report.variants[1].candidate_distance_m);
});
test('mocked candidate generation leaves pilot planning inputs unchanged', async () => {
  const before = structuredClone(report.inputs);
  for (const v of report.inputs) {
    await routeCandidate(v, { key: 'TEST_SECRET_DO_NOT_EXPORT', fetchImpl: async () => ({ ok: true, json: async () => structuredClone(payload) }) });
    assert.equal(v.geometry_source, 'UNKNOWN'); assert.equal(v.geometry_geojson, null); assert.equal(v.encoded_polyline, null);
    assert.equal(v.planning_enabled, true); assert.equal(v.verification_status, 'FIELD_VERIFIED'); assert.equal(v.data_mode, 'REAL');
    assert.ok(v.route_variant_stops.every(s => s.distance_from_variant_start_m === null));
  }
  assert.deepEqual(report.inputs, before);
});
test('configured key and credential parameters never occur in generated outputs', () => {
  const files = [...fs.readdirSync(OUTPUT).filter(f => /\.(geojson|html|js)$/.test(f)).map(f => path.join(OUTPUT, f))];
  const key = 'TEST_SECRET_DO_NOT_EXPORT';
  for (const file of files) assertNoSecrets(fs.readFileSync(file, 'utf8'), key);
  assert.throws(() => assertNoSecrets('TEST_SECRET_DO_NOT_EXPORT', 'TEST_SECRET_DO_NOT_EXPORT'));
  assert.throws(() => assertNoSecrets('apiKey=secret', 'secret'));
});
test('provider failures with credential-bearing errors never leak URLs', async () => {
  await assert.rejects(routeCandidate(report.inputs[0], { key: 'TEST_SECRET_DO_NOT_EXPORT',
    fetchImpl: async () => { throw new Error('https://example.test?apiKey=TEST_SECRET_DO_NOT_EXPORT'); } }),
  e => !e.message.includes('TEST_SECRET_DO_NOT_EXPORT') && !e.message.includes('https:'));
});
test('review server is read-only, allowlisted, serves injected vendor mocks and denies private files', async () => {
  const temporary = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'pamana-review-test-'));
  for (const file of ['maplibre-gl.mjs', 'maplibre-gl-shared.mjs', 'maplibre-gl-worker.mjs', 'maplibre-gl.css']) fs.writeFileSync(path.join(temporary, file), '/* vendor serving contract mock */');
  const reportFile = path.join(temporary, 'report.json');
  fs.writeFileSync(reportFile, JSON.stringify(report));
  const server = createReviewServer({ vendor: temporary, reportFile }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const file of ['/', '/review.js', '/report.json', '/vendor/maplibre-gl.mjs', '/vendor/maplibre-gl-shared.mjs', '/vendor/maplibre-gl-worker.mjs', '/vendor/maplibre-gl.css']) {
      const r = await fetch(base + file); assert.equal(r.status, 200, file); await r.arrayBuffer();
    }
    for (const file of ['/.env', '/config/database.js', '/src/api/route-variant', '/vendor/../../.env']) assert.equal((await fetch(base + file)).status, 404);
    assert.equal((await fetch(base + '/', { method: 'POST', body: 'apply' })).status, 405);
  } finally {
    await new Promise(resolve => server.close(resolve));
    // Remove only files created by this test; never recursively remove user files.
    for (const file of ['maplibre-gl.mjs', 'maplibre-gl-shared.mjs', 'maplibre-gl-worker.mjs', 'maplibre-gl.css', 'report.json']) fs.unlinkSync(path.join(temporary, file));
    fs.rmdirSync(temporary);
  }
});
