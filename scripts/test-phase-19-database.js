'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connect, snapshot } = require('./seed-phase5b-transfer-research');

const EXPECTED_DIGEST = '3d63fcdb5d9581d71e2c68d54db9c00868510dcc9b91e6e38fcb893373af9139';

async function main() {
  const client = await connect();
  try {
    await client.query('begin read only');
    const columns = (await client.query(`select column_name from information_schema.columns where table_name='passenger_reports'`)).rows.map(row => row.column_name);
    for (const column of ['description', 'location_accuracy_m', 'review_status', 'reviewed_at', 'review_notes', 'context_source']) assert.ok(columns.includes(column), `${column} missing`);
    const counts = (await client.query(`select
      (select count(*)::int from passenger_reports) reports,
      (select count(*)::int from passenger_reports where review_status='PENDING') pending_reports,
      (select count(*)::int from disruptions) disruptions,
      (select count(*)::int from routes where planning_enabled) planning_routes,
      (select count(*)::int from route_variants where planning_enabled) planning_variants,
      (select count(*)::int from transport_nodes where planning_enabled) planning_nodes`)).rows[0];
    assert.deepEqual(counts, { reports: 4, pending_reports: 4, disruptions: 0, planning_routes: 3, planning_variants: 4, planning_nodes: 4 });
    const digest = crypto.createHash('sha256').update(JSON.stringify(await snapshot(client))).digest('hex');
    assert.equal(digest, EXPECTED_DIGEST);
    console.log('ok - additive report migration preserves all existing reports and pilot planning records');
    console.log(`Transport row digest: ${digest}`);
  } finally { await client.query('rollback'); await client.end(); }
}

main().catch((error) => { console.error(`FAIL: ${error.message}`); process.exitCode = 1; });
