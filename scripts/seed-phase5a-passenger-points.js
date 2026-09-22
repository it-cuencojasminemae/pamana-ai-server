'use strict';

/**
 * Phase 5A commuter-supported and remotely corroborated passenger points.
 *
 * This seed is additive and planning-disabled. It stores no Street View
 * camera coordinate, mall-centre coordinate, fare, schedule, or geometry.
 */

const crypto = require('crypto');
const path = require('path');
const { Client } = require('pg');

const MANIFEST_PATH = path.join(
  __dirname,
  'data',
  'phase5a-sm-robinsons-passenger-points.json'
);
const manifest = require(MANIFEST_PATH);

const PROTECTED_STATUSES = new Set(['FIELD_VERIFIED', 'AUTHORITATIVE_CURRENT']);
const COUNT_TABLES = [
  'routes',
  'route_variants',
  'transport_nodes',
  'route_variant_stops',
  'fare_rules',
  'service_patterns',
];
const NODE_FIELDS = [
  'name',
  'node_type',
  'barangay',
  'municipality_city',
  'province',
  'latitude',
  'longitude',
  'google_place_id',
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

  return process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl }
    : {
        host: process.env.DATABASE_HOST || '127.0.0.1',
        port: Number(process.env.DATABASE_PORT || 5432),
        database: process.env.DATABASE_NAME,
        user: process.env.DATABASE_USERNAME,
        password: process.env.DATABASE_PASSWORD,
        ssl,
      };
}

const documentId = () => crypto.randomBytes(16).toString('hex').slice(0, 24);

function validateManifest() {
  if (manifest.manifest_version !== '1.0.0' || manifest.phase !== '5A') {
    throw new Error('Unexpected Phase 5A manifest version');
  }
  if (manifest.transport_nodes.length !== 2) {
    throw new Error('Phase 5A must define exactly two directional passenger points');
  }

  const codes = new Set();
  const directionRoles = new Set();
  for (const node of manifest.transport_nodes) {
    if (codes.has(node.internal_code)) throw new Error(`Duplicate node code ${node.internal_code}`);
    codes.add(node.internal_code);
    directionRoles.add(node.passenger_direction_role);

    if (node.verification_status !== 'CORROBORATED_RESEARCH') {
      throw new Error(`${node.internal_code} must remain CORROBORATED_RESEARCH`);
    }
    if (node.data_mode !== 'REAL' || node.planning_enabled !== false) {
      throw new Error(`${node.internal_code} has an unsafe trust classification`);
    }
    if (node.latitude !== null || node.longitude !== null || node.google_place_id !== null) {
      throw new Error(`${node.internal_code} must not derive a coordinate or Place ID`);
    }
    if (!Array.isArray(node.evidence) || node.evidence.length < 2) {
      throw new Error(`${node.internal_code} lacks corroborating evidence`);
    }
    node.evidence.forEach((sourceId) => {
      if (!manifest.sources[sourceId]) {
        throw new Error(`${node.internal_code} references unknown source ${sourceId}`);
      }
    });
  }

  if (!directionRoles.has('OUTBOUND_DROPOFF') || !directionRoles.has('INBOUND_LOADING')) {
    throw new Error('Outbound drop-off and inbound loading must remain separate concepts');
  }
  for (const key of ['fare_rules', 'service_patterns', 'route_geometry', 'route_variant_stops']) {
    if (manifest.operational_facts[key].length !== 0) {
      throw new Error(`${key} must remain empty in Phase 5A`);
    }
  }
}

function buildNodeData(node) {
  return {
    name: node.display_name,
    node_type: node.node_type,
    barangay: node.barangay,
    municipality_city: node.municipality_city,
    province: node.province,
    latitude: null,
    longitude: null,
    google_place_id: null,
    planning_enabled: false,
    verification_status: 'CORROBORATED_RESEARCH',
    data_mode: 'REAL',
    source_name: 'PAMANA commuter account and remote Google Maps Street View review',
    source_url: null,
    source_reference: `PHASE5A-2026-09-22; evidence: ${node.evidence.join(', ')}`,
    notes: [
      'REMOTE VISUAL CORROBORATION — NOT PHYSICAL FIELD VERIFICATION.',
      ...node.evidence_notes,
      `Not proved: ${node.does_not_prove.join('; ')}.`,
      'Street View camera coordinates and mall-centre coordinates are not transport-point coordinates.',
    ].join(' '),
  };
}

async function upsertNode(client, node) {
  const desired = buildNodeData(node);
  const existing = (
    await client.query(
      `select *
         from transport_nodes
        where node_code = $1
        limit 1
        for update`,
      [node.internal_code]
    )
  ).rows[0];

  if (!existing) {
    const insertColumns = ['document_id', 'node_code', ...NODE_FIELDS];
    const values = [
      documentId(),
      node.internal_code,
      ...NODE_FIELDS.map((field) => desired[field]),
    ];
    const parameters = values.map((_, index) => `$${index + 1}`);
    const result = await client.query(
      `insert into transport_nodes (${insertColumns.join(', ')}, created_at, updated_at, published_at)
       values (${parameters.join(', ')}, now(), now(), now())
       returning id, document_id`,
      values
    );
    return {
      code: node.internal_code,
      action: 'created',
      id: result.rows[0].id,
      document_id: result.rows[0].document_id,
    };
  }

  if (PROTECTED_STATUSES.has(existing.verification_status)) {
    return {
      code: node.internal_code,
      action: 'protected',
      id: existing.id,
      document_id: existing.document_id,
    };
  }

  const changedFields = NODE_FIELDS.filter(
    (field) => (existing[field] ?? null) !== (desired[field] ?? null)
  );
  if (changedFields.length === 0) {
    return {
      code: node.internal_code,
      action: 'unchanged',
      id: existing.id,
      document_id: existing.document_id,
    };
  }

  const assignments = changedFields.map((field, index) => `${field} = $${index + 1}`);
  const values = changedFields.map((field) => desired[field]);
  values.push(existing.id);
  const result = await client.query(
    `update transport_nodes
        set ${assignments.join(', ')}, updated_at = now()
      where id = $${values.length}
      returning id, document_id`,
    values
  );

  return {
    code: node.internal_code,
    action: 'updated',
    id: result.rows[0].id,
    document_id: result.rows[0].document_id,
  };
}

async function associateEndpointIfVariantExists(
  client,
  { variantCode, nodeCode, relationTable }
) {
  const variant = (
    await client.query(
      `select id, planning_enabled, verification_status, data_mode
         from route_variants
        where variant_code = $1
        limit 1
        for update`,
      [variantCode]
    )
  ).rows[0];

  if (!variant) return { variant_code: variantCode, action: 'variant_not_present' };
  if (
    variant.planning_enabled !== false ||
    variant.verification_status !== 'CORROBORATED_RESEARCH' ||
    variant.data_mode !== 'REAL'
  ) {
    return { variant_code: variantCode, action: 'skipped_non_research_variant' };
  }

  const node = (
    await client.query('select id from transport_nodes where node_code = $1', [nodeCode])
  ).rows[0];
  if (!node) throw new Error(`Endpoint node ${nodeCode} is missing`);

  const existing = (
    await client.query(
      `select transport_node_id from ${relationTable} where route_variant_id = $1`,
      [variant.id]
    )
  ).rows;

  if (existing.length === 0) {
    await client.query(
      `insert into ${relationTable} (route_variant_id, transport_node_id, route_variant_ord)
       values ($1, $2, 1)`,
      [variant.id, node.id]
    );
    return { variant_code: variantCode, action: 'endpoint_linked', node_code: nodeCode };
  }
  if (existing.some((link) => link.transport_node_id === node.id)) {
    return { variant_code: variantCode, action: 'endpoint_unchanged', node_code: nodeCode };
  }

  throw new Error(`${variantCode} already has a different endpoint; refusing to overwrite it`);
}

async function tableCounts(client) {
  const counts = {};
  for (const table of COUNT_TABLES) {
    counts[table] = (
      await client.query(`select count(*)::int as count from ${table}`)
    ).rows[0].count;
  }
  return counts;
}

async function seed(client) {
  validateManifest();
  const nodes = [];
  for (const node of manifest.transport_nodes) nodes.push(await upsertNode(client, node));

  const endpointPolicy = manifest.route_variant_endpoint_policy;
  const variant_endpoints = [
    await associateEndpointIfVariantExists(client, {
      variantCode: endpointPolicy.outbound_variant_code,
      nodeCode: endpointPolicy.outbound_endpoint_node_code,
      relationTable: 'route_variants_end_node_lnk',
    }),
    await associateEndpointIfVariantExists(client, {
      variantCode: endpointPolicy.inbound_variant_code,
      nodeCode: endpointPolicy.inbound_start_node_code,
      relationTable: 'route_variants_start_node_lnk',
    }),
  ];

  return { nodes, variant_endpoints };
}

async function main() {
  const client = new Client(databaseConfig());
  await client.connect();

  try {
    await client.query('begin');
    await client.query("set local lock_timeout = '5s'");
    await client.query("set local statement_timeout = '30s'");
    await client.query("select pg_advisory_xact_lock(hashtext('pamana-phase5a-passenger-points'))");

    const before = await tableCounts(client);
    const records = await seed(client);
    const after = await tableCounts(client);
    const createdNodes = records.nodes.filter((node) => node.action === 'created').length;

    if (after.transport_nodes !== before.transport_nodes + createdNodes) {
      throw new Error('Unexpected transport-node count change during Phase 5A seed');
    }
    for (const table of ['routes', 'route_variants', 'route_variant_stops', 'fare_rules', 'service_patterns']) {
      if (before[table] !== after[table]) {
        throw new Error(`${table} count changed during the Phase 5A passenger-point seed`);
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
    console.error(`Phase 5A passenger-point seed failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  MANIFEST_PATH,
  manifest,
  validateManifest,
  buildNodeData,
  seed,
};
