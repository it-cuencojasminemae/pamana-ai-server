'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connect, snapshot } = require('./seed-phase5b-transfer-research');

const EXPECTED_TRANSPORT_DIGEST = '77776e1a08d971a39b2718a10a116c7748e452900f26931dfbc90acd0377fdae';

async function main() {
  const client = await connect();
  try {
    await client.query('begin read only');
    const counts = (await client.query(`
      select
        (select count(*)::int from routes where planning_enabled is true) as planning_routes,
        (select count(*)::int from route_variants where planning_enabled is true) as planning_variants,
        (select count(*)::int from transport_nodes where planning_enabled is true) as planning_nodes,
        (select count(*)::int from disruptions) as disruptions,
        (select count(*)::int from disruptions where planning_enabled is true) as planning_disruptions`)).rows[0];
    assert.deepEqual(counts, {
      planning_routes: 0, planning_variants: 0, planning_nodes: 0,
      disruptions: 0, planning_disruptions: 0,
    });
    const digest = crypto.createHash('sha256').update(JSON.stringify(await snapshot(client))).digest('hex');
    assert.equal(digest, EXPECTED_TRANSPORT_DIGEST);
    console.log('ok - production data remains empty for planning and disruptions; no journey can be fabricated');
    console.log(`Transport row digest: ${digest}`);
  } finally {
    await client.query('rollback');
    await client.end();
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
