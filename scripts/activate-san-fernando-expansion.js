'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { connect } = require('./seed-phase5b-transfer-research');
const { validateReviewedManifest } = require('../src/services/pamana-journey/pilot-expansion');
const { geometryStopOffsets } = require('../src/services/pamana-journey/route-distance');
const { planningEligibilityFor } = require('../src/services/transport-data/planning-eligibility');
const FILE = path.join(__dirname, 'data/san-fernando-expansion.json');
const RECEIPT = path.join(__dirname, '../documentation/san-fernando-activation-receipt.json');
const TABLES = ['transport_nodes', 'routes', 'route_variants', 'route_variant_stops', 'fare_rules', 'service_patterns', 'route_variants_route_lnk', 'route_variants_start_node_lnk', 'route_variants_end_node_lnk', 'route_variant_stops_route_variant_lnk', 'route_variant_stops_transport_node_lnk'];
const CODE = { transport_nodes: 'node_code', routes: 'route_code', route_variants: 'variant_code' };
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
async function transportDigest(client) {
  const snapshot = {};
  for (const table of TABLES) snapshot[table] = (await client.query(`select id,md5(to_jsonb(t)::text) hash from ${table} t order by id`)).rows;
  return hash(JSON.stringify(snapshot));
}

function reportManifest(data) {
  return { status: validateReviewedManifest(data).length ? 'VERIFICATION_REQUIRED' : 'READY_FOR_DRY_RUN', errors: validateReviewedManifest(data),
    variants: data.variants.map(v => v.variant_code), nodeCount: data.nodes.length, observedAt: data.testimony.observedAt };
}
async function find(client, table, code) {
  assert.ok(CODE[table]);
  const rows = (await client.query(`select * from ${table} where ${CODE[table]} = $1`, [code])).rows;
  assert.ok(rows.length <= 1, `Duplicate ${table} code`);
  return rows[0];
}
function evidence(review, id) {
  return { verification_status: 'FIELD_VERIFIED', data_mode: 'REAL', planning_enabled: true, verified_at: new Date(review.verifiedAt),
    source_name: 'Reviewed San Fernando outbound pilot', source_reference: `${id}: ${review.sourceReference}` };
}
async function insert(client, table, fields, receipt) {
  assert.ok(TABLES.includes(table));
  const data = { document_id: crypto.randomBytes(12).toString('hex'), ...fields };
  const columns = Object.keys(data);
  assert.ok(columns.every(c => /^[a-z_]+$/.test(c)));
  const row = (await client.query(`insert into ${table} (${columns.join(',')},created_at,updated_at,published_at) values (${columns.map((_, i) => `$${i + 1}`).join(',')},now(),now(),now()) returning *`, Object.values(data))).rows[0];
  receipt.inserted.push({ table, id: row.id, documentId: row.document_id });
  return row;
}
function comparable(row, fields) {
  return Object.entries(fields).every(([key, value]) => {
    if (value === null) return row[key] == null;
    if (typeof value === 'number') return ['latitude', 'longitude'].includes(key) ? Math.abs(Number(row[key]) - value) < 1e-12 : Number(row[key]) === value;
    if (key === 'verified_at') return new Date(row[key]).toISOString() === new Date(value).toISOString();
    if (typeof value === 'object') return JSON.stringify(row[key]) === JSON.stringify(value);
    return row[key] === value;
  });
}
async function ensure(client, table, code, fields, receipt) {
  const row = await find(client, table, code);
  if (row) { assert.ok(comparable(row, fields), `Refusing existing-row drift: ${code} (${Object.keys(fields).filter(key => !comparable(row, { [key]: fields[key] })).join(',')})`); return row; }
  return insert(client, table, { [CODE[table]]: code, ...fields }, receipt);
}
async function link(client, table, fromColumn, fromId, toColumn, toId, orderColumn) {
  assert.ok(TABLES.includes(table));
  const rows = (await client.query(`select * from ${table} where ${fromColumn} = $1`, [fromId])).rows;
  assert.ok(rows.length <= 1 && (!rows.length || rows[0][toColumn] === toId), `Relation drift: ${table}`);
  if (!rows.length) await client.query(`insert into ${table} (${fromColumn},${toColumn},${orderColumn}) values ($1,$2,1)`, [fromId, toId]);
}
async function activate(client, data, { apply = false, receiptFile = RECEIPT } = {}) {
  assert.deepEqual(validateReviewedManifest(data), [], 'Transport verification is incomplete.');
  await client.query('begin');
  try {
    await client.query(`lock table ${TABLES.join(',')} in share row exclusive mode`);
    const receipt = { version: '1.0.0', id: data.id, manifestHash: hash(JSON.stringify(data)), createdAt: new Date().toISOString(), beforeDigest: await transportDigest(client), inserted: [], changedPermissions: [] };
    const nodes = new Map();
    for (const code of ['RCH-MEXICO-BAYAN-STA-MONICA-TRANSFER', 'RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF']) {
      const n = await find(client, 'transport_nodes', code);
      assert.ok(n && planningEligibilityFor(n).eligible, `Existing verified point unavailable: ${code}`); nodes.set(code, n);
    }
    for (const n of data.nodes) nodes.set(n.node_code, await ensure(client, 'transport_nodes', n.node_code, { name: n.name, node_type: n.node_type, latitude: n.latitude, longitude: n.longitude,
      municipality_city: 'City of San Fernando', province: 'Pampanga', ...evidence(n.verification, data.id) }, receipt));
    const routes = new Map();
    const existing = await find(client, 'routes', 'RCH-ARAYAT-SF-VIA-STAANA-MEXICO');
    assert.ok(existing && planningEligibilityFor(existing, { requireActive: true }).eligible); routes.set(existing.route_code, existing);
    for (const r of data.routes) routes.set(r.route_code, await ensure(client, 'routes', r.route_code, { route_name: r.route_name, transport_mode: r.transport_mode,
      origin: r.origin, destination: r.destination, active: true, route_status: 'active', base_fare: null, estimated_travel_time: null, ...evidence(data.review, data.id) }, receipt));
    for (const v of data.variants) {
      const offsets = geometryStopOffsets(v, v.stops.map(code => ({ node: { lat: Number(nodes.get(code).latitude), lng: Number(nodes.get(code).longitude) } }))).map(value => Number.isFinite(value) ? Math.round(value) : null);
      assert.ok(offsets.length === v.stops.length && offsets.every((n, i) => Number.isFinite(n) && (i === 0 || n > offsets[i - 1])), `Corridor cannot establish ordered stop distances: ${v.variant_code}`);
      const row = await ensure(client, 'route_variants', v.variant_code, { display_name: v.display_name, direction: v.direction, signboard_text: v.signboard_text,
        operating_status: 'ACTIVE', geometry_source: v.geometry_source, geometry_geojson: v.geometry_geojson, encoded_polyline: null, source_type: 'PROJECT_TEAM_FIELD_VERIFICATION',
        ...evidence(v.corridorVerification, data.id) }, receipt);
      await link(client, 'route_variants_route_lnk', 'route_variant_id', row.id, 'route_id', routes.get(v.route_code).id, 'route_variant_ord');
      await link(client, 'route_variants_start_node_lnk', 'route_variant_id', row.id, 'transport_node_id', nodes.get(v.stops[0]).id, 'route_variant_ord');
      await link(client, 'route_variants_end_node_lnk', 'route_variant_id', row.id, 'transport_node_id', nodes.get(v.stops.at(-1)).id, 'route_variant_ord');
      const existingStops = (await client.query('select s.* from route_variant_stops s join route_variant_stops_route_variant_lnk l on l.route_variant_stop_id=s.id where l.route_variant_id=$1 order by sequence', [row.id])).rows;
      assert.ok(existingStops.length === 0 || existingStops.length === v.stops.length, 'Stop-count drift');
      for (const [index, code] of v.stops.entries()) {
        const fields = { sequence: index + 1, pickup_allowed: index === 0, dropoff_allowed: index !== 0, transfer_allowed: index === 0, is_timepoint: false,
          instruction_template: index === 0 ? `Check the signboard (${v.signboardAliases.join(', ')}) and ask the driver about your landmark and final drop-off.` : null,
          distance_from_variant_start_m: offsets[index] };
        let stop = existingStops[index];
        if (stop) assert.ok(comparable(stop, fields), 'Stop drift');
        else stop = await insert(client, 'route_variant_stops', fields, receipt);
        await link(client, 'route_variant_stops_route_variant_lnk', 'route_variant_stop_id', stop.id, 'route_variant_id', row.id, 'route_variant_stop_ord');
        await link(client, 'route_variant_stops_transport_node_lnk', 'route_variant_stop_id', stop.id, 'transport_node_id', nodes.get(code).id, 'route_variant_stop_ord');
      }
    }
    for (const change of data.transferPermissionChanges) {
      const v = await find(client, 'route_variants', change.variantCode), n = nodes.get(change.nodeCode);
      assert.ok(v && n);
      const stops = (await client.query('select s.* from route_variant_stops s join route_variant_stops_route_variant_lnk v on v.route_variant_stop_id=s.id join route_variant_stops_transport_node_lnk n on n.route_variant_stop_id=s.id where v.route_variant_id=$1 and n.transport_node_id=$2', [v.id, n.id])).rows;
      assert.equal(stops.length, 1);
      const stop = stops[0];
      if (stop.transfer_allowed === change.value) continue;
      assert.equal(stop.transfer_allowed, change.expected, 'Existing transfer flag drift');
      receipt.changedPermissions.push({ id: stop.id, before: stop.transfer_allowed, after: change.value, updatedAt: stop.updated_at });
      await client.query('update route_variant_stops set transfer_allowed=$1 where id=$2', [change.value, stop.id]);
    }
    receipt.afterDigest = await transportDigest(client);
    receipt.changed = receipt.inserted.length > 0 || receipt.changedPermissions.length > 0;
    if (apply && receipt.changed) {
      assert.ok(!fs.existsSync(receiptFile), 'An activation receipt already exists; preserve it for rollback.');
      fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    }
    await client.query(apply ? 'commit' : 'rollback');
    return receipt;
  } catch (error) { await client.query('rollback'); throw error; }
}
async function rollback(client, receipt, { apply = false } = {}) {
  assert.equal(receipt.id, 'CSF-OUTBOUND-2026-10-07');
  await client.query('begin');
  try {
    await client.query(`lock table ${TABLES.join(',')} in share row exclusive mode`);
    assert.equal(await transportDigest(client), receipt.afterDigest, 'Transport data changed after activation; refusing rollback.');
    for (const change of receipt.changedPermissions) await client.query('update route_variant_stops set transfer_allowed=$1 where id=$2 and transfer_allowed=$3', [change.before, change.id, change.after]);
    const relations = { route_variant_stops: [['route_variant_stops_route_variant_lnk', 'route_variant_stop_id'], ['route_variant_stops_transport_node_lnk', 'route_variant_stop_id']],
      route_variants: [['route_variants_route_lnk', 'route_variant_id'], ['route_variants_start_node_lnk', 'route_variant_id'], ['route_variants_end_node_lnk', 'route_variant_id']] };
    for (const record of [...receipt.inserted].reverse()) {
      assert.ok(['route_variant_stops', 'route_variants', 'routes', 'transport_nodes'].includes(record.table));
      for (const [table, field] of relations[record.table] || []) await client.query(`delete from ${table} where ${field}=$1`, [record.id]);
      const removed = await client.query(`delete from ${record.table} where id=$1 and document_id=$2 returning id`, [record.id, record.documentId]);
      assert.equal(removed.rowCount, 1);
    }
    assert.equal(await transportDigest(client), receipt.beforeDigest, 'Rollback did not restore the baseline.');
    await client.query(apply ? 'commit' : 'rollback');
    return { rolledBack: apply, restoredDigest: receipt.beforeDigest };
  } catch (error) { await client.query('rollback'); throw error; }
}
async function main() {
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const args = process.argv.slice(2), apply = args.includes('--apply');
  if (!args.includes('--rollback') && validateReviewedManifest(data).length) {
    console.log(JSON.stringify(reportManifest(data), null, 2));
    if (apply) process.exitCode = 1;
    return;
  }
  if (apply && !args.includes('--rollback')) assert.ok(args.includes(`--approved-sha256=${hash(JSON.stringify(data))}`), 'Supply the hash of the reviewed manifest to apply.');
  const client = await connect();
  try { console.log(JSON.stringify(args.includes('--rollback') ? await rollback(client, JSON.parse(fs.readFileSync(RECEIPT, 'utf8')), { apply }) : await activate(client, data, { apply }), null, 2)); }
  finally { await client.end(); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { activate, rollback, reportManifest, transportDigest, TABLES };
