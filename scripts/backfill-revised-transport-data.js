'use strict';

/**
 * Phase 3 transport-knowledge backfill.
 *
 * Run only after Strapi has synchronized the Phase 3 schemas:
 *   npm run backfill:phase-3
 *
 * The migration is deliberately conservative:
 * - it creates no RouteVariant, TransportNode, FareRule, or ServicePattern rows;
 * - it changes only null safety/default fields on the new tables;
 * - it never changes legacy route/stop names, geometry, fares, or sequences;
 * - it verifies legacy row counts inside the same short transaction.
 */

const { Client } = require('pg');

const LEGACY_TABLES = [
  'routes',
  'route_stops',
  'vehicles',
  'trips',
  'vehicle_locations',
  'disruptions',
  'passenger_reports',
];

const NEW_TABLES = [
  'route_variants',
  'transport_nodes',
  'route_variant_stops',
  'fare_rules',
  'service_patterns',
];

const ACCESSIBILITY_COLUMNS = [
  ['route_stops', 'covered_waiting_area'],
  ['route_stops', 'accessible_toilet_nearby'],
  ['vehicles', 'wheelchair_accessible'],
  ['vehicles', 'low_floor'],
  ['transport_nodes', 'covered_waiting_area'],
  ['transport_nodes', 'wheelchair_accessible'],
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

async function tableCounts(client, tables) {
  const counts = {};
  for (const table of tables) {
    const result = await client.query(`select count(*)::int as count from ${table}`);
    counts[table] = result.rows[0].count;
  }
  return counts;
}

async function assertTablesExist(client, tables) {
  const result = await client.query(
    `select table_name
       from information_schema.tables
      where table_schema = current_schema()
        and table_name = any($1::text[])`,
    [tables]
  );
  const existing = new Set(result.rows.map((row) => row.table_name));
  const missing = tables.filter((table) => !existing.has(table));

  if (missing.length > 0) {
    throw new Error(
      `Schema synchronization is incomplete; missing tables: ${missing.join(', ')}`
    );
  }
}

async function assertAccessibilityIsNullable(client) {
  for (const [table, column] of ACCESSIBILITY_COLUMNS) {
    const result = await client.query(
      `select is_nullable
         from information_schema.columns
        where table_schema = current_schema()
          and table_name = $1
          and column_name = $2`,
      [table, column]
    );

    if (result.rows.length !== 1 || result.rows[0].is_nullable !== 'YES') {
      throw new Error(`${table}.${column} must allow null after schema synchronization`);
    }
  }
}

async function setNullDefaults(client) {
  const updates = {
    routes_active: (
      await client.query(
        `update routes
            set active = (route_status = 'active')
          where active is null`
      )
    ).rowCount,
  };

  const statements = [
    [
      'route_variants',
      `update route_variants
          set planning_enabled = coalesce(planning_enabled, false),
              operating_status = coalesce(operating_status, 'UNKNOWN'),
              geometry_source = coalesce(geometry_source, 'UNKNOWN'),
              verification_status = coalesce(verification_status, 'RESEARCH_CANDIDATE'),
              data_mode = coalesce(data_mode, 'REAL')
        where planning_enabled is null
           or operating_status is null
           or geometry_source is null
           or verification_status is null
           or data_mode is null`,
    ],
    [
      'transport_nodes',
      `update transport_nodes
          set planning_enabled = coalesce(planning_enabled, false),
              verification_status = coalesce(verification_status, 'RESEARCH_CANDIDATE'),
              data_mode = coalesce(data_mode, 'REAL')
        where planning_enabled is null
           or verification_status is null
           or data_mode is null`,
    ],
    [
      'fare_rules',
      `update fare_rules
          set currency = coalesce(currency, 'PHP'),
              planning_enabled = coalesce(planning_enabled, false),
              verification_status = coalesce(verification_status, 'RESEARCH_CANDIDATE'),
              data_mode = coalesce(data_mode, 'REAL')
        where currency is null
           or planning_enabled is null
           or verification_status is null
           or data_mode is null`,
    ],
    [
      'service_patterns',
      `update service_patterns
          set dispatch_type = coalesce(dispatch_type, 'UNKNOWN'),
              planning_enabled = coalesce(planning_enabled, false),
              verification_status = coalesce(verification_status, 'RESEARCH_CANDIDATE'),
              data_mode = coalesce(data_mode, 'REAL')
        where dispatch_type is null
           or planning_enabled is null
           or verification_status is null
           or data_mode is null`,
    ],
    [
      'route_variant_stops',
      `update route_variant_stops
          set pickup_allowed = coalesce(pickup_allowed, false),
              dropoff_allowed = coalesce(dropoff_allowed, false),
              transfer_allowed = coalesce(transfer_allowed, false),
              is_timepoint = coalesce(is_timepoint, false)
        where pickup_allowed is null
           or dropoff_allowed is null
           or transfer_allowed is null
           or is_timepoint is null`,
    ],
  ];

  for (const [table, sql] of statements) {
    updates[table] = (await client.query(sql)).rowCount;
  }

  return updates;
}

async function main() {
  const client = new Client(databaseConfig());
  await client.connect();

  try {
    await client.query('begin');
    await client.query("set local lock_timeout = '5s'");
    await client.query("set local statement_timeout = '30s'");

    await assertTablesExist(client, [...LEGACY_TABLES, ...NEW_TABLES]);
    const before = await tableCounts(client, LEGACY_TABLES);
    await assertAccessibilityIsNullable(client);
    const updates = await setNullDefaults(client);
    const after = await tableCounts(client, LEGACY_TABLES);

    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error('Legacy row counts changed during the Phase 3 backfill');
    }

    const newTables = await tableCounts(client, NEW_TABLES);
    await client.query('commit');

    console.log(JSON.stringify({ legacy_counts: after, new_table_counts: newTables, updated_rows: updates }));
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`Phase 3 backfill failed: ${error.message}`);
  process.exit(1);
});
