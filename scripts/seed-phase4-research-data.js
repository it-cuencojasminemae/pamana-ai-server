'use strict';

/**
 * Phase 4 Mexico -> City of San Fernando research seed.
 *
 * Safety properties:
 * - the JSON manifest is the reviewable source of seed values;
 * - all live records remain planning-disabled;
 * - no route geometry, stop sequence, fare, timetable, or coordinate is seeded;
 * - stronger FIELD_VERIFIED/AUTHORITATIVE_CURRENT records are never changed;
 * - the short transaction and advisory lock make reruns deterministic.
 */

const crypto = require('crypto');
const path = require('path');
const { Client } = require('pg');

const MANIFEST_PATH = path.join(
  __dirname,
  'data',
  'phase4-mexico-san-fernando-research.json'
);

const manifest = require(MANIFEST_PATH);

const STATUS_RANK = Object.freeze({
  RESEARCH_CANDIDATE: 1,
  HISTORICAL_UNVERIFIED: 1,
  SIMULATED_DEMO: 1,
  CORROBORATED_RESEARCH: 2,
  FIELD_VERIFIED: 3,
  AUTHORITATIVE_CURRENT: 4,
});

const PROTECTED_STATUSES = new Set(['FIELD_VERIFIED', 'AUTHORITATIVE_CURRENT']);
const COUNT_TABLES = [
  'routes',
  'route_variants',
  'transport_nodes',
  'route_variant_stops',
  'fare_rules',
  'service_patterns',
];

const ROUTE_FIELDS = [
  'route_name',
  'origin',
  'destination',
  'route_status',
  'active',
  'planning_enabled',
  'verification_status',
  'data_mode',
  'source_name',
  'source_url',
  'source_reference',
  'notes',
];

const NODE_FIELDS = [
  'name',
  'node_type',
  'municipality_city',
  'province',
  'planning_enabled',
  'verification_status',
  'data_mode',
  'source_name',
  'source_url',
  'source_reference',
  'notes',
];

function databaseConfig() {
  const ssl = process.env.DATABASE_SSL === 'true'
    ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' }
    : false;

  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL, ssl };
  }

  return {
    host: process.env.DATABASE_HOST || '127.0.0.1',
    port: Number(process.env.DATABASE_PORT || 5432),
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    ssl,
  };
}

const documentId = () => crypto.randomBytes(16).toString('hex').slice(0, 24);

function sourceFor(record) {
  const sourceId = record.evidence[0];
  const source = manifest.sources[sourceId];
  if (!source) throw new Error(`Unknown source ${sourceId} for ${record.internal_code}`);
  return { sourceId, source };
}

function evidenceReference(record) {
  return `${record.source_reference} Evidence: ${record.evidence.join(', ')}.`;
}

function buildRouteData(record) {
  const { source } = sourceFor(record);
  return {
    route_name: record.display_name,
    origin: record.origin,
    destination: record.destination,
    route_status: 'inactive',
    active: false,
    planning_enabled: false,
    verification_status: record.research_status,
    data_mode: record.data_mode,
    source_name: source.source_name,
    source_url: source.source_url,
    source_reference: evidenceReference(record),
    notes: 'Research-only candidate. No fare, travel time, geometry, schedule, stop sequence, terminal, signboard, or boarding point has been asserted. Field verification is required before passenger use.',
  };
}

function buildNodeData(record) {
  const { source } = sourceFor(record);
  return {
    name: record.display_name,
    node_type: record.node_type,
    municipality_city: record.municipality_city,
    province: record.province,
    planning_enabled: false,
    verification_status: record.research_status,
    data_mode: record.data_mode,
    source_name: source.source_name,
    source_url: source.source_url,
    source_reference: evidenceReference(record),
    notes: 'Research destination candidate only. Coordinates and any transport loading, alighting, terminal, or route relationship remain unverified.',
  };
}

function validateManifest() {
  if (manifest.manifest_version !== '1.0.0' || manifest.phase !== 4) {
    throw new Error('Unexpected Phase 4 manifest version');
  }

  const records = [
    ...manifest.route_candidates,
    ...manifest.transport_node_candidates,
    ...manifest.historical_toda_research,
    ...manifest.disruption_research,
  ];
  const codes = new Set();

  for (const record of records) {
    if (!record.internal_code.startsWith('RCH-')) {
      throw new Error(`Research code lacks RCH- prefix: ${record.internal_code}`);
    }
    if (codes.has(record.internal_code)) {
      throw new Error(`Duplicate manifest code: ${record.internal_code}`);
    }
    codes.add(record.internal_code);
    if (record.planning_allowed !== false) {
      throw new Error(`${record.internal_code} must remain planning-disabled`);
    }
    if (!Array.isArray(record.evidence) || record.evidence.length === 0) {
      throw new Error(`${record.internal_code} has no evidence chain`);
    }
    record.evidence.forEach((sourceId) => {
      if (!manifest.sources[sourceId]) {
        throw new Error(`${record.internal_code} references unknown source ${sourceId}`);
      }
    });
  }

  for (const route of manifest.route_candidates) {
    if (route.research_status !== 'CORROBORATED_RESEARCH' || route.data_mode !== 'REAL') {
      throw new Error(`${route.internal_code} has an unsafe trust classification`);
    }
    const serialized = JSON.stringify(route);
    if (/San Luis/i.test(serialized)) {
      throw new Error(`${route.internal_code} contains legacy San Luis data`);
    }
    for (const prohibited of ['base_fare', 'estimated_travel_time', 'geometry', 'headway']) {
      if (Object.prototype.hasOwnProperty.call(route, prohibited)) {
        throw new Error(`${route.internal_code} must not define ${prohibited}`);
      }
    }
  }

  for (const node of manifest.transport_node_candidates) {
    if (node.latitude !== null || node.longitude !== null) {
      throw new Error(`${node.internal_code} must not have guessed coordinates`);
    }
  }

  for (const collection of ['route_variants', 'route_variant_stops', 'fare_rules', 'service_patterns']) {
    if (manifest.operational_seed_policy[collection].length !== 0) {
      throw new Error(`${collection} must remain empty in Phase 4`);
    }
  }
}

function shouldProtectEvidence(existingStatus, desiredStatus) {
  if (PROTECTED_STATUSES.has(existingStatus)) return true;
  return (STATUS_RANK[existingStatus] || 0) > (STATUS_RANK[desiredStatus] || 0);
}

const sameValue = (left, right) => (left ?? null) === (right ?? null);

function changedFields(existing, desired, fields) {
  return fields.filter((field) => !sameValue(existing[field], desired[field]));
}

async function createRecord(client, table, codeColumn, code, desired, fields) {
  const columns = ['document_id', codeColumn, ...fields, 'created_at', 'updated_at', 'published_at'];
  const values = [documentId(), code, ...fields.map((field) => desired[field])];
  const parameters = values.map((_, index) => `$${index + 1}`);
  const sql = `insert into ${table} (${columns.join(', ')}) values (${parameters.join(', ')}, now(), now(), now()) returning id, document_id`;
  return (await client.query(sql, values)).rows[0];
}

async function updateRecord(client, table, id, desired, fields) {
  const changed = fields.map((field, index) => `${field} = $${index + 1}`);
  const values = fields.map((field) => desired[field]);
  values.push(id);
  const sql = `update ${table} set ${changed.join(', ')}, updated_at = now() where id = $${values.length} returning id, document_id`;
  return (await client.query(sql, values)).rows[0];
}

async function upsertResearchRecord(client, { table, codeColumn, code, desired, fields }) {
  const existing = (
    await client.query(
      `select * from ${table} where ${codeColumn} = $1 limit 1 for update`,
      [code]
    )
  ).rows[0];

  if (!existing) {
    return {
      action: 'created',
      ...(await createRecord(client, table, codeColumn, code, desired, fields)),
    };
  }

  if (shouldProtectEvidence(existing.verification_status, desired.verification_status)) {
    return { action: 'protected', id: existing.id, document_id: existing.document_id };
  }

  const changed = changedFields(existing, desired, fields);
  if (changed.length === 0) {
    return { action: 'unchanged', id: existing.id, document_id: existing.document_id };
  }

  return {
    action: 'updated',
    ...(await updateRecord(client, table, existing.id, desired, changed)),
  };
}

async function tableCounts(client) {
  const result = {};
  for (const table of COUNT_TABLES) {
    result[table] = (
      await client.query(`select count(*)::int as count from ${table}`)
    ).rows[0].count;
  }
  return result;
}

async function seed(client) {
  validateManifest();
  const records = { routes: [], transport_nodes: [] };

  for (const route of manifest.route_candidates) {
    const result = await upsertResearchRecord(client, {
      table: 'routes',
      codeColumn: 'route_code',
      code: route.internal_code,
      desired: buildRouteData(route),
      fields: ROUTE_FIELDS,
    });
    records.routes.push({ code: route.internal_code, ...result });
  }

  for (const node of manifest.transport_node_candidates) {
    const result = await upsertResearchRecord(client, {
      table: 'transport_nodes',
      codeColumn: 'node_code',
      code: node.internal_code,
      desired: buildNodeData(node),
      fields: NODE_FIELDS,
    });
    records.transport_nodes.push({ code: node.internal_code, ...result });
  }

  return records;
}

async function main() {
  const client = new Client(databaseConfig());
  await client.connect();

  try {
    await client.query('begin');
    await client.query("set local lock_timeout = '5s'");
    await client.query("set local statement_timeout = '30s'");
    await client.query("select pg_advisory_xact_lock(hashtext('pamana-phase4-research-seed'))");

    const before = await tableCounts(client);
    const records = await seed(client);
    const after = await tableCounts(client);

    const expectedRouteIncrease = records.routes.filter((item) => item.action === 'created').length;
    const expectedNodeIncrease = records.transport_nodes.filter((item) => item.action === 'created').length;
    if (after.routes !== before.routes + expectedRouteIncrease) {
      throw new Error('Unexpected route count change during Phase 4 seed');
    }
    if (after.transport_nodes !== before.transport_nodes + expectedNodeIncrease) {
      throw new Error('Unexpected transport-node count change during Phase 4 seed');
    }
    for (const table of ['route_variants', 'route_variant_stops', 'fare_rules', 'service_patterns']) {
      if (before[table] !== after[table]) {
        throw new Error(`${table} changed during the research-only seed`);
      }
    }

    await client.query('commit');
    console.log(JSON.stringify({ manifest_version: manifest.manifest_version, before, after, records }));
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Phase 4 research seed failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  MANIFEST_PATH,
  manifest,
  buildRouteData,
  buildNodeData,
  validateManifest,
  shouldProtectEvidence,
  changedFields,
  seed,
};
