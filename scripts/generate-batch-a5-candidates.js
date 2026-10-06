'use strict';

// Standalone review artifacts only. Never called by a Strapi service or API.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { connect } = require('./seed-phase5b-transfer-research');
const { digest, counts, loadVariant } = require('./activate-pilot-field-verified');
const { rawJeepneyFare, DISCOUNT_PERCENT, DEMO_TRICYCLE, JEEPNEY_POLICIES } = require('../src/services/pamana-journey/fare-policy');

const OUTPUT = path.join(__dirname, '../documentation/batch-a5-candidates');
const REPORT = path.join(__dirname, '../documentation/batch-a5-candidate-geometry-review.json');
const ENDPOINTS = Object.freeze({
  'RCH-PSU-MEXICO-FRONT': [120.69826461388278, 15.128026422211173],
  'RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF': [120.69885494898818, 15.05158520927461],
  'RCH-ROB-STARMILLS-ARAYAT-GATE-LOAD': [120.69778203294244, 15.050605637995128],
  'RCH-MEXICO-BAYAN-STA-MONICA-TRANSFER': [120.72025022065026, 15.064333794084051],
});
const CODES = Object.freeze(['RCH-SJ-SMROB-OUT', 'RCH-SJ-SMROB-IN',
  'PILOT-ARAYAT-SF-MEXICO-BAYAN-SM-OUT', 'PILOT-PSU-MEXICO-BAYAN-TRICYCLE-OUT']);
const SETTINGS = Object.freeze({ mode: 'drive', type: 'balanced', units: 'metric',
  traffic: 'free_flow', format: 'geojson', details: 'route_details' });

function segmentLength(a, b) {
  const rad = n => n * Math.PI / 180;
  const h = Math.sin(rad(b[1] - a[1]) / 2) ** 2
    + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(rad(b[0] - a[0]) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
function geometryLines(geometry) {
  assert.ok(['LineString', 'MultiLineString'].includes(geometry?.type), 'Unsupported candidate geometry');
  const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
  assert.ok(Array.isArray(lines) && lines.length > 0, 'Empty candidate geometry');
  for (const line of lines) {
    assert.ok(Array.isArray(line) && line.length >= 2, 'Invalid road line');
    for (const p of line) assert.ok(Array.isArray(p) && p.length === 2
      && Number.isFinite(p[0]) && Math.abs(p[0]) <= 180
      && Number.isFinite(p[1]) && Math.abs(p[1]) <= 90, 'Invalid road coordinate');
  }
  return lines;
}
function measureGeometry(geometry) {
  const lines = geometryLines(geometry);
  let meters = 0;
  let disconnectedGapMeters = 0;
  lines.forEach((line, part) => {
    for (let i = 1; i < line.length; i++) meters += segmentLength(line[i - 1], line[i]);
    if (part) disconnectedGapMeters += segmentLength(lines[part - 1].at(-1), line[0]);
  });
  assert.ok(meters > 0, 'Candidate distance must be positive');
  return { meters, disconnectedGapMeters, first: lines[0][0], last: lines.at(-1).at(-1) };
}
function farePreview(distanceMeters) {
  return { status: 'CANDIDATE_FARE_PREVIEW', distance_basis: 'PROVIDER_REPORTED_CANDIDATE_ROAD_DISTANCE',
    distance_m: distanceMeters, ...Object.fromEntries(Object.keys(JEEPNEY_POLICIES).map(mode => {
      const raw = rawJeepneyFare(mode, distanceMeters);
      return [mode, { raw_calculation_php: raw, regular_php: Math.round(raw),
        discounted_raw_php: raw * (1 - DISCOUNT_PERCENT / 100),
        discounted_php: Math.round(raw * (1 - DISCOUNT_PERCENT / 100)), discount_percent: DISCOUNT_PERCENT }];
    })) };
}
function assertNoSecrets(text, key) {
  assert.ok(!key || !text.includes(key), 'Secret detected in review output');
  assert.ok(!/apiKey\s*[=:]/i.test(text), 'Credential parameter detected in review output');
}
function safeText(value, key) {
  if (typeof value !== 'string') return null;
  const text = value.slice(0, 1000);
  assertNoSecrets(text, key);
  return text;
}
function requestParameters(variant) {
  const [origin, destination] = [variant.stops[0], variant.stops.at(-1)];
  return { ...SETTINGS, waypoints: [origin, destination].map(n => `${n.latitude},${n.longitude}`).join('|') };
}
async function routeCandidate(variant, { key, fetchImpl = fetch, generatedAt = new Date().toISOString() }) {
  assert.ok(key?.trim(), 'Geoapify server key is not configured');
  const params = requestParameters(variant);
  const url = new URL('https://api.geoapify.com/v1/routing');
  url.search = new URLSearchParams({ ...params, apiKey: key }).toString();
  let response;
  try { response = await fetchImpl(url, { signal: AbortSignal.timeout(45000), redirect: 'error' }); }
  catch { throw new Error(`Geoapify network request failed for ${variant.variant_code}; URL and provider body withheld`); }
  assert.ok(response.ok, `Geoapify HTTP ${response.status} for ${variant.variant_code}; provider body withheld`);
  let payload;
  try { payload = await response.json(); } catch { throw new Error('Invalid Geoapify JSON; provider body withheld'); }
  assert.equal(payload?.type, 'FeatureCollection');
  const feature = payload.features?.[0];
  assert.equal(feature?.type, 'Feature');
  const p = feature.properties;
  assert.equal(String(p?.distance_units).toLowerCase(), 'meters', 'Provider distance must be metres');
  assert.ok(Number.isFinite(p.distance) && p.distance > 0, 'Invalid provider distance');
  assert.ok(Number.isFinite(p.time) && p.time > 0, 'Invalid provider duration');
  const measured = measureGeometry(feature.geometry);
  const origin = variant.stops[0];
  const destination = variant.stops.at(-1);
  const originCoordinates = [origin.longitude, origin.latitude];
  const destinationCoordinates = [destination.longitude, destination.latitude];
  const originGap = segmentLength(originCoordinates, measured.first);
  const destinationGap = segmentLength(destinationCoordinates, measured.last);
  const steps = (p.legs || []).flatMap((leg, legIndex) => (leg.steps || []).map(step => ({
    leg_index: legIndex, name: safeText(step.name, key), road_class: safeText(step.road_class, key),
    surface: safeText(step.surface, key), traversability: safeText(step.traversability, key),
    instruction: safeText(step.instruction?.text, key),
    distance_m: Number.isFinite(step.distance) ? step.distance : null,
    from_index: Number.isInteger(step.from_index) ? step.from_index : null,
    to_index: Number.isInteger(step.to_index) ? step.to_index : null,
    toll: step.toll === true, ferry: step.ferry === true,
  })));
  const tricycle = variant.variant_code === DEMO_TRICYCLE.variantCode;
  const warnings = [`Endpoint-only passenger-car route; actual ${tricycle ? 'tricycle' : 'jeepney'} corridor is unconfirmed.`,
    `Balanced driving route is not evidence of the actual ${tricycle ? 'tricycle' : 'fixed jeepney'} path.`,
    'Duration is free-flow driving time; excludes waiting, loading and transit stops.',
    'No intermediate waypoint coordinates supplied or invented.'];
  if (originGap > 1 || destinationGap > 1) warnings.push(`Road snapping differs from exact nodes: origin ${originGap.toFixed(2)} m; destination ${destinationGap.toFixed(2)} m. Gaps are not added to fare distance.`);
  if (measured.disconnectedGapMeters > 0.1) warnings.push('Disconnected geometry parts; gaps are excluded from measured distance. Review continuity.');
  const suspect = [...new Set(steps.filter(s => ['motorway', 'service_other', 'residential', 'unclassified'].includes(s.road_class))
    .map(s => `${s.road_class}: ${s.name || 'unnamed'}`))];
  if (suspect.length) warnings.push(`Inspect possibly unsuitable road classes/access: ${suspect.join('; ')}. This is a review flag, not a claim that these roads are forbidden.`);
  if (p.toll || steps.some(s => s.toll)) warnings.push('Provider reports toll-road use; verify jeepney suitability.');
  if (p.ferry || steps.some(s => s.ferry)) warnings.push('Provider reports ferry use; verify suitability.');
  const properties = { variant_code: variant.variant_code, candidate_only: true, provider: 'GEOAPIFY',
    routing_mode: SETTINGS.mode, routing_type: SETTINGS.type, traffic_model: SETTINGS.traffic,
    generated_at: generatedAt, request_id: crypto.randomUUID(), direction: variant.direction,
    origin_node_code: origin.node_code, destination_node_code: destination.node_code,
    origin_coordinates: originCoordinates, destination_coordinates: destinationCoordinates,
    provider_reported_distance_m: p.distance, provider_reported_duration_s: p.time,
    geometry_measured_distance_m: measured.meters,
    measured_minus_provider_distance_m: measured.meters - p.distance,
    measured_difference_percent: (measured.meters - p.distance) / p.distance * 100,
    origin_road_snap_gap_m: originGap, destination_road_snap_gap_m: destinationGap,
    disconnected_geometry_gap_m: measured.disconnectedGapMeters,
    review_status: 'PENDING_MANUAL_REVIEW', warnings };
  // Do not copy provider collection/request properties: they may echo credentials.
  const geojson = { type: 'FeatureCollection', features: [{ type: 'Feature',
    geometry: structuredClone(feature.geometry), properties }] };
  const summary = { ...properties, origin, destination, candidate_distance_m: p.distance,
    candidate_distance_km: p.distance / 1000, candidate_duration_s: p.time,
    geojson_filename: `${variant.variant_code}.candidate.geojson`, request_parameters: params,
    fare_preview: tricycle ? { status: 'DEMO_ESTIMATE', fare_php: DEMO_TRICYCLE.fare,
      distance_used_for_fare: false } : farePreview(p.distance), road_steps: steps };
  assertNoSecrets(JSON.stringify({ geojson, summary }), key);
  return { geojson, summary };
}

async function fullDatabaseDigest(client) {
  const tables = (await client.query(`select tablename from pg_tables where schemaname = current_schema() order by tablename`)).rows;
  const state = [];
  for (const { tablename } of tables) {
    const table = '"' + tablename.replaceAll('"', '""') + '"';
    const rows = (await client.query(`select md5(to_jsonb(t)::text) as hash from ${table} t order by hash`)).rows;
    state.push({ table: tablename, rows });
  }
  const sequences = (await client.query(`select sequencename, last_value from pg_sequences where schemaname = current_schema() order by sequencename`)).rows;
  return { hash: crypto.createHash('sha256').update(JSON.stringify({ state, sequences })).digest('hex'),
    tables: state.map(t => ({ table: t.table, row_count: t.rows.length })), sequence_count: sequences.length };
}
async function databaseAudit() {
  const client = await connect();
  try {
    await client.query('begin isolation level repeatable read read only');
    const variants = [];
    for (const code of CODES) {
      const v = await loadVariant(client, code);
      assert.equal(v.geometry_geojson, null);
      assert.equal(v.encoded_polyline, null);
      assert.equal(v.geometry_source, 'UNKNOWN');
      assert.equal(v.planning_enabled, true);
      assert.equal(v.verification_status, 'FIELD_VERIFIED');
      assert.equal(v.data_mode, 'REAL');
      assert.equal(v.route_variant_stops.length, 2);
      const stops = v.route_variant_stops.map(s => {
        assert.equal(s.distance_from_variant_start_m, null);
        const n = s.transport_node;
        assert.deepEqual([Number(n.longitude), Number(n.latitude)], ENDPOINTS[n.node_code], 'Exact DB endpoints changed');
        return { node_code: n.node_code, name: n.name, latitude: Number(n.latitude), longitude: Number(n.longitude),
          planning_enabled: n.planning_enabled, verification_status: n.verification_status, data_mode: n.data_mode,
          sequence: s.sequence, distance_from_variant_start_m: s.distance_from_variant_start_m };
      });
      variants.push({ variant_code: v.variant_code, direction: v.direction, geometry_geojson: v.geometry_geojson,
        encoded_polyline: v.encoded_polyline, geometry_source: v.geometry_source, planning_enabled: v.planning_enabled,
        verification_status: v.verification_status, data_mode: v.data_mode, stops });
    }
    const result = { captured_at: new Date().toISOString(), digest: await digest(client),
      counts: await counts(client), full_database: await fullDatabaseDigest(client), variants };
    await client.query('rollback');
    return result;
  } finally { await client.end(); }
}
function multiLegPreview(jeep) {
  return { status: 'CANDIDATE_FARE_PREVIEW', vehicle_legs: 2, transfers: 1,
    leg_1: { mode: 'TRICYCLE', fare_php: DEMO_TRICYCLE.fare, source: 'DEMO_ESTIMATE' },
    leg_2: jeep.fare_preview,
    totals_php: Object.fromEntries(Object.keys(JEEPNEY_POLICIES).map(mode => [mode, {
      regular: DEMO_TRICYCLE.fare + jeep.fare_preview[mode].regular_php,
      discounted: DEMO_TRICYCLE.fare + jeep.fare_preview[mode].discounted_php,
    }])) };
}
async function main() {
  const key = process.env.GEOAPIFY_SERVER_API_KEY?.trim();
  assert.ok(key, 'Geoapify server key is not configured');
  const before = await databaseAudit();
  const generatedAt = new Date().toISOString();
  const results = [];
  // Four independent requests, including independently routed inbound.
  for (const variant of before.variants) {
    results.push(await routeCandidate(variant, { key, generatedAt }));
    console.log(`Generated candidate: ${variant.variant_code}`);
  }
  const after = await databaseAudit();
  assert.equal(after.digest, before.digest, 'Transport database digest changed');
  assert.deepEqual(after.full_database, before.full_database, 'Database contents or sequences changed');
  assert.deepEqual(after.variants, before.variants, 'Pilot fields changed');
  assert.deepEqual(after.counts, before.counts);
  const summaries = results.map(r => r.summary);
  const report = { phase: 'BATCH_A.5A', candidate_only: true, generated_at: generatedAt,
    review_status: 'PENDING_MANUAL_REVIEW', fare_policy: { policies: JEEPNEY_POLICIES,
      discount_percent: DISCOUNT_PERCENT, rounding: 'Math.round(raw) and Math.round(raw * 0.8)' },
    distance_basis: 'Geoapify metric route distance; independently measured road segments reported for comparison. Neither is approved for fares.',
    provider_documentation: 'https://apidocs.geoapify.com/docs/routing/', variants: summaries,
    direct_journey: { variant_code: CODES[0], vehicle_legs: 1, transfers: 0, fare_preview: summaries[0].fare_preview },
    return_journey: { variant_code: CODES[1], vehicle_legs: 1, transfers: 0, fare_preview: summaries[1].fare_preview },
    multi_leg_journey: multiLegPreview(summaries[2]), database_before: before, database_after: after,
    database_unchanged: true,
    corridor_guidance: { source: 'documentation/phase-5b-san-juan-route-refinement.md, Waypoints are not verified passenger stops',
      locality_sequence: ['PSU / San Juan', 'Santa Cruz', 'Laput', 'Balas', 'San Carlos', 'Mexico Bayan', 'Sto. Cristo', 'Lagundi', 'SM/Rob'],
      coordinates: null, applied_to_routing: false, note: 'Locality names only; precise waypoints need evidence and manual review. Do not invent coordinates.' } };
  assertNoSecrets(JSON.stringify(report), key);
  fs.mkdirSync(OUTPUT, { recursive: true });
  for (const result of results) fs.writeFileSync(path.join(OUTPUT, result.summary.geojson_filename), JSON.stringify(result.geojson, null, 2) + '\n');
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n');
  console.log('Four standalone candidates saved. Database contents, sequences and pilot fields unchanged. Manual review pending.');
}
if (require.main === module) main().catch(error => {
  // Even fetch/library error messages must not leak a credential-bearing URL.
  console.error('Candidate generation failed. No database writes were performed. Check configuration, provider connectivity or audit assertions; credentials and provider bodies withheld.');
  const message = String(error.message || 'Unknown failure');
  const key = process.env.GEOAPIFY_SERVER_API_KEY?.trim();
  if ((!key || !message.includes(key)) && !/https?:|apiKey/i.test(message)) console.error(message);
  process.exitCode = 1;
});
module.exports = { CODES, ENDPOINTS, OUTPUT, REPORT, SETTINGS, segmentLength, measureGeometry,
  farePreview, assertNoSecrets, requestParameters, routeCandidate, databaseAudit, multiLegPreview };
