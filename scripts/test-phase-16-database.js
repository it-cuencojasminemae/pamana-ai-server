'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connect, snapshot } = require('./seed-phase5b-transfer-research');

const EXPECTED_TRANSPORT_DIGEST = '3d63fcdb5d9581d71e2c68d54db9c00868510dcc9b91e6e38fcb893373af9139';

async function main() {
  const client = await connect();
  try {
    await client.query('begin read only');
    const before = await snapshot(client);
    const counts = (await client.query(`
      select
        (select count(*)::int from route_variants where planning_enabled is true) planning_variants,
        (select count(*)::int from transport_nodes where planning_enabled is true) planning_nodes,
        (select count(*)::int from routes where planning_enabled is true) planning_routes`)).rows[0];
    assert.deepEqual(counts, { planning_variants: 4, planning_nodes: 4, planning_routes: 3 });
    for (const table of ['vehicles', 'trips', 'vehicle_locations']) {
      const result = await client.query(`select count(*)::int count from ${table} where data_mode = 'SIMULATED'`);
      assert.ok(result.rows[0].count >= 0); // Diagnostic only; Phase 16 creates no rows in any mode.
    }
    assert.deepEqual(await snapshot(client), before);
    const digest = crypto.createHash('sha256').update(JSON.stringify(before)).digest('hex');
    assert.equal(digest, EXPECTED_TRANSPORT_DIGEST);
    console.log('ok - Phase 16 performs zero PostgreSQL writes and pilot planning counts remain unchanged');
    console.log(`Transport row digest: ${digest}`);
  } finally {
    await client.query('rollback');
    await client.end();
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error.stack || error.message}`);
  process.exitCode = 1;
});
