'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connect, snapshot } = require('./seed-phase5b-transfer-research');
const { enrichJourneyInformation } = require('../src/services/pamana-journey/journey-information-enricher');

const EXPECTED_TRANSPORT_DIGEST = '77776e1a08d971a39b2718a10a116c7748e452900f26931dfbc90acd0377fdae';

async function main() {
  const client = await connect();
  try {
    await client.query('begin read only');
    const counts = (await client.query(`
      select
        (select count(*)::int from route_variants where planning_enabled is true) as planning_variants,
        (select count(*)::int from transport_nodes where planning_enabled is true) as planning_nodes,
        (select count(*)::int from fare_rules) as fare_rules,
        (select count(*)::int from service_patterns) as service_patterns`)).rows[0];
    assert.deepEqual(counts, {
      planning_variants: 0,
      planning_nodes: 0,
      fare_rules: 0,
      service_patterns: 0,
    });
    const unresolved = enrichJourneyInformation({
      id: 'production-limitation',
      legs: [{ type: 'TRANSIT', routeVariantId: 'unresolved-san-juan' }],
    }, { requestedDeparture: '2026-09-28T08:00:00+08:00' });
    assert.equal(unresolved.legs[0].availability.status, 'UNKNOWN');
    assert.equal(unresolved.legs[0].availability.wait.status, 'UNKNOWN');
    assert.equal(unresolved.legs[0].availability.wait.lowMinutes, null);
    assert.equal(unresolved.legs[0].availability.wait.highMinutes, null);

    const state = await snapshot(client);
    const digest = crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex');
    assert.equal(digest, EXPECTED_TRANSPORT_DIGEST);
    console.log('ok - production has no eligible journey evidence and produces no fabricated wait');
    console.log('ok - Phase 13 performs zero database writes');
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
