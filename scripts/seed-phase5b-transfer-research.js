'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Client } = require('pg');
const manifest = require('./data/phase5b-san-juan-transfer-research.json');

const TABLE_KEYS = Object.freeze({ routes: 'route_code', transport_nodes: 'node_code', route_variants: 'variant_code' });
const LINKS = Object.freeze({
  route_code: ['route_variants_route_lnk', 'routes', 'route_id'],
  start_node_code: ['route_variants_start_node_lnk', 'transport_nodes', 'transport_node_id'],
  end_node_code: ['route_variants_end_node_lnk', 'transport_nodes', 'transport_node_id'],
});
const TABLES = [
  'routes', 'transport_nodes', 'route_variants', 'route_variant_stops', 'fare_rules', 'service_patterns',
  'route_stops', 'vehicles', 'trips', 'vehicle_locations', 'disruptions', 'passenger_reports', 'drivers',
  ...Object.values(LINKS).map(([table]) => table),
];
const STRONG = new Set(['FIELD_VERIFIED', 'AUTHORITATIVE_CURRENT']);

function databaseConfig() {
  // Use the application's connection settings, including schema and TLS settings.
  const env = Object.assign((key, fallback) => process.env[key] ?? fallback, {
    int: (key, fallback) => Number(process.env[key] ?? fallback),
    bool: (key, fallback) => (process.env[key] ?? String(fallback)) === 'true',
  });
  const config = require('../config/database')({ env }).connection;
  assert.equal(config.client, 'postgres', 'Phase 5B requires PostgreSQL');
  return { ...config.connection, connectionTimeoutMillis: 10000, query_timeout: 30000 };
}

async function connect() {
  const config = databaseConfig();
  const client = new Client(config);
  await client.connect();
  await client.query("select set_config('search_path', quote_ident($1), false)", [config.schema || 'public']);
  return client;
}

function validateManifest() {
  assert.equal(manifest.phase, '5B');
  assert.equal(manifest.manifest_version, '1.0.0');
  assert.equal(manifest.nodes.length, 2);
  assert.equal(manifest.routes.length, 1);
  assert.equal(manifest.variants.length, 2);
  const codes = [];
  for (const record of [...manifest.nodes, ...manifest.routes, ...manifest.variants]) {
    const code = record.node_code || record.variant_code || record.route_code;
    assert.ok(code.startsWith('RCH-'));
    codes.push(code);
    assert.equal(record.verification_status, 'CORROBORATED_RESEARCH');
    assert.equal(record.data_mode, 'REAL');
    assert.equal(record.planning_enabled, false);
    assert.ok(record.evidence.length > 0);
    for (const id of record.evidence) assert.ok(manifest.sources[id], `Missing evidence ${id}`);
  }
  assert.equal(new Set(codes).size, codes.length);
  for (const node of manifest.nodes) {
    for (const key of ['latitude', 'longitude', 'google_place_id']) assert.equal(node[key], null);
  }
  for (const route of manifest.routes) {
    assert.equal(route.active, false);
    assert.equal(route.route_status, 'inactive');
    assert.equal(route.base_fare, null);
    assert.equal(route.estimated_travel_time, null);
  }
  for (const variant of manifest.variants) {
    assert.equal(variant.operating_status, 'UNKNOWN');
    assert.equal(variant.geometry_source, 'UNKNOWN');
    assert.equal(variant.encoded_polyline, null);
    assert.equal(variant.geometry_geojson, null);
  }
  for (const records of Object.values(manifest.operational_records)) assert.deepEqual(records, []);
}

function rowData(record, table) {
  const { evidence, route_code, start_node_code, end_node_code, ...data } = record;
  if (table !== 'route_variants') data.route_code = route_code;
  // Remove absent attributes; references live in Strapi relation tables.
  Object.keys(data).forEach((key) => { if (data[key] === undefined) delete data[key]; });
  const primary = manifest.sources[evidence[0]];
  const result = {
    ...data,
    source_name: primary.name,
    source_url: primary.url,
    source_reference: `PHASE5B-2026-09-23; scripts/data/phase5b-san-juan-transfer-research.json; evidence: ${evidence.join(', ')}`,
    notes: data.notes || manifest.variant_note,
  };
  if (table === 'route_variants') result.source_type = 'COMMUTER_AND_REMOTE_RESEARCH';
  return result;
}

async function find(client, table, code) {
  assert.ok(TABLE_KEYS[table], 'Unsupported research table');
  const rows = (await client.query(`select * from ${table} where ${TABLE_KEYS[table]} = $1 for update`, [code])).rows;
  assert.ok(rows.length <= 1, `Duplicate ${table} research identifier: ${code}`);
  return rows[0];
}

async function ensureRecord(client, table, record) {
  const key = TABLE_KEYS[table];
  const code = record[key];
  const data = rowData(record, table);
  const existing = await find(client, table, code);
  if (existing) {
    if (STRONG.has(existing.verification_status) || existing.planning_enabled === true || existing.verified_at) {
      return { table, code, action: 'protected', id: existing.id, document_id: existing.document_id };
    }
    // Fail on edited research rather than replacing manually maintained facts.
    for (const [field, value] of Object.entries(data)) {
      assert.deepEqual(existing[field] ?? null, value, `${code}.${field} differs; reconcile evidence before reseeding`);
    }
    return { table, code, action: 'unchanged', id: existing.id, document_id: existing.document_id };
  }
  const columns = ['document_id', ...Object.keys(data)];
  const values = [crypto.randomBytes(12).toString('hex'), ...Object.values(data)];
  const placeholders = values.map((_, index) => `$${index + 1}`);
  const row = (await client.query(
    `insert into ${table} (${columns.join(', ')}, created_at, updated_at, published_at)
     values (${placeholders.join(', ')}, now(), now(), now()) returning id, document_id`, values
  )).rows[0];
  return { table, code, action: 'created', ...row };
}

async function ensureLinks(client, variant, result) {
  if (result.action === 'protected') return;
  for (const [field, [table, targetTable, targetColumn]] of Object.entries(LINKS)) {
    const target = await find(client, targetTable, variant[field]);
    assert.ok(target, `Missing ${field}: ${variant[field]}; seed earlier phases first`);
    const links = (await client.query(`select * from ${table} where route_variant_id = $1 for update`, [result.id])).rows;
    if (links.length) {
      assert.equal(links.length, 1, `Multiple ${field} relations for ${variant.variant_code}`);
      assert.equal(links[0][targetColumn], target.id, `Refusing to replace ${variant.variant_code}.${field}`);
    } else {
      await client.query(
        `insert into ${table} (route_variant_id, ${targetColumn}, route_variant_ord) values ($1, $2, 1)`,
        [result.id, target.id]
      );
    }
  }
}

async function snapshot(client) {
  const result = {};
  for (const table of TABLES) {
    // Return hashes only: no personal data or full record contents in receipts.
    result[table] = (await client.query(`select id, md5(to_jsonb(t)::text) as hash from ${table} t order by id`)).rows;
  }
  return result;
}

function assertPreserved(before, after) {
  for (const table of TABLES) {
    const current = new Map(after[table].map((row) => [row.id, row.hash]));
    for (const row of before[table]) assert.equal(current.get(row.id), row.hash, `${table} row ${row.id} was changed or removed`);
  }
}

const counts = (state) => Object.fromEntries(Object.entries(state).map(([table, rows]) => [table, rows.length]));

async function seed(client) {
  validateManifest();
  // Caller must hold a transaction. Table locks also protect against writers
  // which do not share our advisory lock; Strapi does not enforce code uniqueness.
  await client.query("set local lock_timeout = '5s'");
  await client.query("set local statement_timeout = '30s'");
  await client.query("select pg_advisory_xact_lock(hashtext('pamana-phase5a-passenger-points'))");
  await client.query(`lock table routes, transport_nodes, route_variants,
    route_variants_route_lnk, route_variants_start_node_lnk, route_variants_end_node_lnk
    in share row exclusive mode`);
  const before = await snapshot(client);
  const records = [];
  for (const node of manifest.nodes) records.push(await ensureRecord(client, 'transport_nodes', node));
  for (const route of manifest.routes) records.push(await ensureRecord(client, 'routes', route));
  for (const variant of manifest.variants) {
    const record = await ensureRecord(client, 'route_variants', variant);
    records.push(record);
    await ensureLinks(client, variant, record);
  }
  const after = await snapshot(client);
  assertPreserved(before, after);
  for (const table of TABLES.filter((name) => !TABLE_KEYS[name] && !name.endsWith('_lnk'))) {
    assert.deepEqual(after[table], before[table], `Unexpected ${table} changes`);
  }
  return { before: counts(before), after: counts(after), existing_rows_unchanged: true, records };
}

async function main() {
  const client = await connect();
  try {
    await client.query('begin');
    const result = await seed(client);
    await client.query('commit');
    console.log(JSON.stringify(result));
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { manifest, validateManifest, rowData, connect, seed, snapshot, assertPreserved };
