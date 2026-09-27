'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connect, snapshot } = require('./seed-phase5b-transfer-research');

const EXPECTED_TRANSPORT_DIGEST = '77776e1a08d971a39b2718a10a116c7748e452900f26931dfbc90acd0377fdae';

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
    assert.deepEqual(counts, { planning_variants: 0, planning_nodes: 0, planning_routes: 0 });
    const permissions = (await client.query(`
      select r.name
      from up_permissions p
      join up_permissions_role_lnk link on link.permission_id = p.id
      join up_roles r on r.id = link.role_id
      where p.action in ('api::trip.trip.active', 'api::trip.trip.options')
      order by p.action, r.name`)).rows.map((row) => row.name);
    assert.deepEqual(permissions, ['Driver', 'Driver']);
    const digest = crypto.createHash('sha256').update(JSON.stringify(before)).digest('hex');
    assert.equal(digest, EXPECTED_TRANSPORT_DIGEST);
    assert.deepEqual(await snapshot(client), before);
    console.log('ok - Phase 17 changes no research/planning records and production eligibility remains zero');
    console.log('ok - only the Driver role can read driver trip options and active-trip presentation');
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
