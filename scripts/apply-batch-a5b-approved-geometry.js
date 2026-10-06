'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const manifest = require('./data/batch-a5b-approved-geometry.json');
const { connect } = require('./seed-phase5b-transfer-research');
const { counts, digest, loadVariant } = require('./activate-pilot-field-verified');
const { geometryStopOffsets, roadLine } = require('../src/services/pamana-journey/route-distance');
const { OUTPUT, REPORT, measureGeometry, assertNoSecrets } = require('./generate-batch-a5-candidates');
const RECEIPT = path.join(__dirname, '../documentation/batch-a5b-application-receipt.json');
const BACKUP = path.join(__dirname, '../documentation/batch-a5b-before-application.json');
const HASH = value => crypto.createHash('sha256').update(value).digest('hex');
const quote = name => '"' + name.replaceAll('"', '""') + '"';

// Artifact verification alone never authorizes database application. The CLI
// still requires loadApprovedCandidates and the unchanged original review hash.
function loadCandidateArtifacts({ key = process.env.GEOAPIFY_SERVER_API_KEY?.trim() } = {}) {
  assert.equal(manifest.phase, 'BATCH_A.5B');
  assert.equal(manifest.approved.length, 4);
  return manifest.approved.map(definition => {
    assert.equal(path.basename(definition.filename), definition.filename);
    const bytes = fs.readFileSync(path.join(OUTPUT, definition.filename));
    assert.equal(HASH(bytes), definition.sha256, `Approved artifact changed: ${definition.variant_code}`);
    assertNoSecrets(bytes.toString(), key);
    const json = JSON.parse(bytes);
    assert.equal(json.type, 'FeatureCollection'); assert.equal(json.features.length, 1);
    const feature = json.features[0], props = feature.properties;
    assert.equal(feature.type, 'Feature');
    assert.equal(props.variant_code, definition.variant_code);
    assert.equal(props.candidate_only, true); assert.equal(props.provider, 'GEOAPIFY');
    assert.equal(props.review_status, 'PENDING_MANUAL_REVIEW'); // Keep the original A.5A artifact intact.
    assert.equal(props.request_id, definition.request_id); assert.equal(props.generated_at, manifest.review_generated_at);
    assert.equal(props.origin_node_code, definition.origin_node_code); assert.equal(props.destination_node_code, definition.destination_node_code);
    assert.deepEqual(props.origin_coordinates, definition.origin_coordinates); assert.deepEqual(props.destination_coordinates, definition.destination_coordinates);
    assert.equal(HASH(JSON.stringify(feature.geometry)), definition.geometry_sha256);
    const measured = measureGeometry(feature.geometry);
    assert.equal(measured.meters, definition.geometry_measured_distance_m); assert.ok(measured.disconnectedGapMeters <= 0.1);
    assert.ok(roadLine({ geometry_source: 'MANUAL_VERIFIED', geometry_geojson: feature.geometry }));
    return { definition, geometry: feature.geometry, measured, properties: props };
  });
}

function loadApprovedCandidates() {
  const reportBytes = fs.readFileSync(REPORT);
  assert.equal(HASH(reportBytes), manifest.review_report_sha256, 'A.5A review report changed since approval freeze');
  const report = JSON.parse(reportBytes);
  const key = process.env.GEOAPIFY_SERVER_API_KEY?.trim();
  assert.ok(key, 'Configured server key required for integrity/leak scan; no network calls are made');
  assertNoSecrets(reportBytes.toString(), key);
  return loadCandidateArtifacts({ key }).map(candidate => {
    const summary = report.variants.find(v => v.variant_code === candidate.definition.variant_code);
    assert.ok(summary);
    for (const [name, value] of Object.entries(candidate.properties)) assert.deepEqual(value, summary[name]);
    return candidate;
  });
}

function planVariant(variant, candidate) {
  const d = candidate.definition;
  assert.equal(variant.id, d.variant_id); assert.equal(variant.variant_code, d.variant_code);
  assert.equal(variant.route.route_code, d.route_code); assert.equal(variant.route.transport_mode, d.transport_mode);
  assert.equal(variant.verification_status, 'FIELD_VERIFIED'); assert.equal(variant.data_mode, 'REAL');
  assert.equal(variant.planning_enabled, true, 'Unexpected planning state; preserve it and stop for reconciliation');
  assert.equal(variant.route_variant_stops.length, 2, 'Unexpected intermediate stops need separate geometry review');
  const stops = variant.route_variant_stops;
  assert.deepEqual(stops.map(s => s.id), d.stop_ids); assert.deepEqual(stops.map(s => s.sequence), [1, 2]);
  assert.deepEqual(stops.map(s => s.transport_node.node_code), [d.origin_node_code, d.destination_node_code]);
  for (const [i, stop] of stops.entries()) {
    const n = stop.transport_node;
    assert.deepEqual([Number(n.longitude), Number(n.latitude)], i === 0 ? d.origin_coordinates : d.destination_coordinates);
  }
  const offsets = geometryStopOffsets({ geometry_source: 'MANUAL_VERIFIED', geometry_geojson: candidate.geometry },
    stops.map(s => ({ node: { lat: Number(s.transport_node.latitude), lng: Number(s.transport_node.longitude) } })));
  assert.equal(offsets.length, stops.length); assert.ok(offsets.every(Number.isFinite), 'Ambiguous or distant stop projection');
  const distances = offsets.map(offset => Math.round(offset - offsets[0]));
  assert.equal(distances[0], 0);
  assert.ok(distances.every((n, i) => Number.isSafeInteger(n) && n >= 0 && n <= 2147483647 && (!i || n > distances[i - 1])));
  const rawDistance = offsets.at(-1) - offsets[0];
  const provenance = `[BATCH-A.5B APPROVED GEOMETRY]\nProvider: Geoapify; source stage: Batch A.5A candidate; manually reviewed and approved by the user; approval date: ${manifest.approval_date}.\nCandidate: documentation/batch-a5-candidates/${d.filename}; SHA-256: ${d.sha256}; independent request: ${d.request_id}.\nGeometry provenance: MANUAL_VERIFIED after review; transportation/service verification is unchanged.\nCumulative distance: existing route-distance.geometryStopOffsets, relative to first ordered stop, rounded to integer metres for the existing column; unrounded endpoint segment: ${rawDistance} m; provider reported: ${d.provider_reported_distance_m} m.`;
  let action;
  if (variant.geometry_geojson === null) {
    assert.equal(variant.geometry_source, 'UNKNOWN'); assert.equal(variant.encoded_polyline, null);
    assert.ok(stops.every(s => s.distance_from_variant_start_m === null), 'Unexpected prior cumulative distance');
    assert.ok(!String(variant.notes || '').includes('[BATCH-A.5B APPROVED GEOMETRY]'), 'Unexpected prior approval provenance');
    action = 'APPLY_APPROVED_GEOMETRY';
  } else {
    assert.deepEqual(variant.geometry_geojson, candidate.geometry, 'Target already contains different geometry');
    assert.equal(variant.geometry_source, 'MANUAL_VERIFIED'); assert.equal(variant.encoded_polyline, null);
    assert.deepEqual(stops.map(s => Number(s.distance_from_variant_start_m)), distances, 'Stored cumulative distance differs from approved calculation');
    assert.ok(stops.every(s => s.distance_from_variant_start_m !== null));
    assert.ok(String(variant.notes || '').includes(provenance), 'Existing geometry approval provenance differs');
    action = 'UNCHANGED';
  }
  const notes = action === 'UNCHANGED' ? variant.notes : `${variant.notes || ''}${variant.notes ? '\n\n' : ''}${provenance}`;
  assertNoSecrets(notes, process.env.GEOAPIFY_SERVER_API_KEY);
  return { variant_code: d.variant_code, variant_id: variant.id, action, geometry: candidate.geometry, notes,
    origin_geometry_offset_m: offsets[0], destination_geometry_offset_m: offsets.at(-1), unrounded_road_distance_m: rawDistance,
    stored_road_distance_m: distances.at(-1), geometry_measured_distance_m: candidate.measured.meters,
    provider_reported_distance_m: d.provider_reported_distance_m,
    stored_minus_provider_m: distances.at(-1) - d.provider_reported_distance_m,
    stops: stops.map((s, i) => ({ id: s.id, sequence: s.sequence, before: s.distance_from_variant_start_m, after: distances[i] })),
    before_geometry_source: variant.geometry_source, after_geometry_source: 'MANUAL_VERIFIED',
    planning_enabled: variant.planning_enabled, verification_status: variant.verification_status, data_mode: variant.data_mode,
    transport_mode: variant.route.transport_mode, candidate_sha256: d.sha256 };
}

async function databaseSnapshot(client) {
  const tables = (await client.query(`select tablename from pg_tables where schemaname=current_schema() order by tablename`)).rows;
  const state = {};
  for (const { tablename } of tables) {
    const hasId = (await client.query(`select 1 from information_schema.columns where table_schema=current_schema() and table_name=$1 and column_name='id'`, [tablename])).rowCount > 0;
    state[tablename] = (await client.query(`select ${hasId ? 'id::text' : 'md5(to_jsonb(t)::text)'} as key,
      md5(to_jsonb(t)::text) as hash from ${quote(tablename)} t order by key, hash`)).rows;
  }
  const sequences = (await client.query(`select sequencename,last_value from pg_sequences where schemaname=current_schema() order by sequencename`)).rows;
  return { hash: HASH(JSON.stringify({ state, sequences })), state, sequences };
}
function assertAllowedChanges(before, after, plans, applied) {
  assert.deepEqual(Object.keys(after.state), Object.keys(before.state), 'Schema/table list changed');
  assert.deepEqual(after.sequences, before.sequences, 'Sequences changed during application');
  const allowed = {
    route_variants: new Set(plans.filter(p => applied && p.action !== 'UNCHANGED').map(p => String(p.variant_id))),
    route_variant_stops: new Set(plans.filter(p => applied && p.action !== 'UNCHANGED').flatMap(p => p.stops.map(s => String(s.id)))),
  };
  const changed = [];
  for (const [table, rows] of Object.entries(before.state)) {
    const next = after.state[table]; assert.deepEqual(next.map(r => r.key), rows.map(r => r.key), `Rows inserted/deleted in ${table}`);
    rows.forEach((row, i) => { if (row.hash !== next[i].hash) {
      assert.ok(allowed[table]?.has(row.key), `Unapproved row changed: ${table}/${row.key}`);
      changed.push({ table, id: Number(row.key), before_hash: row.hash, after_hash: next[i].hash });
    } });
  }
  assert.equal(changed.length, Object.values(allowed).reduce((n, set) => n + set.size, 0));
  return changed;
}
async function protectedHashes(client) {
  const variants = (await client.query(`select id, md5((to_jsonb(t)-array['geometry_geojson','geometry_source','notes','updated_at'])::text) hash from route_variants t order by id`)).rows;
  const stops = (await client.query(`select id, md5((to_jsonb(t)-array['distance_from_variant_start_m','updated_at'])::text) hash from route_variant_stops t order by id`)).rows;
  return { variants, stops };
}
async function loadTargets(client, candidates, lock = false) {
  const variants = [];
  for (const { definition: d } of candidates) {
    const rows = (await client.query(`select id from route_variants where variant_code=$1${lock ? ' for update' : ''}`, [d.variant_code])).rows;
    assert.deepEqual(rows, [{ id: d.variant_id }], 'Missing or ambiguous variant');
    const links = (await client.query(`select r.route_code from route_variants_route_lnk l join routes r on r.id=l.route_id where l.route_variant_id=$1`, [d.variant_id])).rows;
    assert.deepEqual(links, [{ route_code: d.route_code }], 'Ambiguous parent route');
    for (const [table, code] of [['route_variants_start_node_lnk', d.origin_node_code], ['route_variants_end_node_lnk', d.destination_node_code]]) {
      const endpoints = (await client.query(`select n.node_code from ${table} l join transport_nodes n on n.id=l.transport_node_id where l.route_variant_id=$1`, [d.variant_id])).rows;
      assert.deepEqual(endpoints, [{ node_code: code }], 'Ambiguous endpoint relation');
    }
    const v = await loadVariant(client, d.variant_code);
    assert.equal(v.route_variant_stops.length, 2);
    for (const s of v.route_variant_stops) {
      const rels = (await client.query(`select (select count(*)::int from route_variant_stops_route_variant_lnk where route_variant_stop_id=$1) variants,
        (select count(*)::int from route_variant_stops_transport_node_lnk where route_variant_stop_id=$1) nodes`, [s.id])).rows[0];
      assert.deepEqual(rels, { variants: 1, nodes: 1 }, 'Ambiguous stop relations');
    }
    variants.push(v);
  }
  return variants;
}
async function application(client, candidates, { apply = false, beforeApply } = {}) {
  // Caller owns the transaction. All validation and writes are atomic.
  const before = { counts: await counts(client), digest: await digest(client), snapshot: await databaseSnapshot(client),
    variants: await loadTargets(client, candidates, apply) };
  const plans = before.variants.map((v, i) => planVariant(v, candidates[i]));
  const protectedBefore = await protectedHashes(client);
  if (beforeApply) beforeApply(before, plans);
  if (apply) for (const p of plans.filter(p => p.action !== 'UNCHANGED')) {
    assert.equal((await client.query(`update route_variants set geometry_geojson=$1::jsonb, geometry_source='MANUAL_VERIFIED', notes=$2, updated_at=now() where id=$3`,
      [JSON.stringify(p.geometry), p.notes, p.variant_id])).rowCount, 1);
    for (const stop of p.stops) assert.equal((await client.query(`update route_variant_stops set distance_from_variant_start_m=$1, updated_at=now() where id=$2`, [stop.after, stop.id])).rowCount, 1);
  }
  const after = { counts: await counts(client), digest: await digest(client), snapshot: await databaseSnapshot(client),
    variants: await loadTargets(client, candidates) };
  assert.deepEqual(after.counts, before.counts, 'Counts changed');
  assert.deepEqual(await protectedHashes(client), protectedBefore, 'Unrelated target fields changed');
  const changed = assertAllowedChanges(before.snapshot, after.snapshot, plans, apply);
  if (apply) after.variants.forEach((v, i) => assert.equal(planVariant(v, candidates[i]).action, 'UNCHANGED'));
  return { phase: 'BATCH_A.5B', applied: apply, approval_date: manifest.approval_date, generated_at: new Date().toISOString(),
    approval_manifest: 'scripts/data/batch-a5b-approved-geometry.json', before, after, plans, rows_changed: changed };
}
async function main() {
  const candidates = loadApprovedCandidates();
  const apply = process.argv.includes('--apply');
  const client = await connect();
  try {
    await client.query(apply ? 'begin isolation level serializable' : 'begin isolation level repeatable read read only');
    if (apply) {
      await client.query("set local lock_timeout='5s'"); await client.query("set local statement_timeout='30s'");
      await client.query("select pg_advisory_xact_lock(hashtext('pamana-batch-a5b-approved-geometry'))");
      await client.query(`lock table route_variants,route_variant_stops,route_variants_route_lnk,route_variants_start_node_lnk,
        route_variants_end_node_lnk,route_variant_stops_route_variant_lnk,route_variant_stops_transport_node_lnk in share row exclusive mode`);
    }
    const receipt = await application(client, candidates, { apply, beforeApply(before, plans) {
      if (apply && plans.some(p => p.action !== 'UNCHANGED')) {
        assert.ok(!fs.existsSync(BACKUP), 'Existing before-application backup will not be overwritten');
        const backup = { phase: 'BATCH_A.5B', captured_at: new Date().toISOString(), approval_date: manifest.approval_date, ...before };
        assertNoSecrets(JSON.stringify(backup), process.env.GEOAPIFY_SERVER_API_KEY);
        fs.writeFileSync(BACKUP, JSON.stringify(backup, null, 2) + '\n', { flag: 'wx' });
      }
    } });
    await client.query(apply ? 'commit' : 'rollback');
    assertNoSecrets(JSON.stringify(receipt), process.env.GEOAPIFY_SERVER_API_KEY);
    const file = apply ? (receipt.rows_changed.length ? RECEIPT : RECEIPT.replace('.json', '-reapply.json')) : RECEIPT.replace('.json', '-dry-run.json');
    fs.writeFileSync(file, JSON.stringify(receipt, null, 2) + '\n');
    console.log(JSON.stringify({ applied: apply, before_digest: receipt.before.digest, after_digest: receipt.after.digest,
      rows_changed: receipt.rows_changed.map(r => `${r.table}/${r.id}`), plans: receipt.plans.map(p => ({ variant: p.variant_code, action: p.action,
        geometry_source: p.after_geometry_source, distance_m: p.stored_road_distance_m, stops: p.stops })) }, null, 2));
  } catch (error) { await client.query('rollback'); throw error; }
  finally { await client.end(); }
}
if (require.main === module) main().catch(error => {
  const message = String(error.message || error.name), key = process.env.GEOAPIFY_SERVER_API_KEY;
  console.error(key && message.includes(key) ? 'Application failed; secret-containing details withheld' : message);
  process.exitCode = 1;
});
module.exports = { manifest, RECEIPT, BACKUP, loadCandidateArtifacts, loadApprovedCandidates, planVariant, databaseSnapshot, assertAllowedChanges, loadTargets, application };
