'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connect, snapshot } = require('./seed-phase5b-transfer-research');
const { orchestrateTripPlan } = require('../src/services/pamana-journey/trip-plan-orchestrator');
const { validateTripPlanRequest } = require('../src/services/pamana-journey/trip-plan-request-validator');

const EXPECTED_TRANSPORT_DIGEST = '77776e1a08d971a39b2718a10a116c7748e452900f26931dfbc90acd0377fdae';

async function main() {
  const client = await connect();
  try {
    await client.query('begin read only');
    const counts = (await client.query(`
      select
        (select count(*)::int from routes where planning_enabled is true) as planning_routes,
        (select count(*)::int from route_variants where planning_enabled is true) as planning_variants,
        (select count(*)::int from transport_nodes where planning_enabled is true) as planning_nodes`)).rows[0];
    assert.deepEqual(counts, { planning_routes: 0, planning_variants: 0, planning_nodes: 0 });

    const request = validateTripPlanRequest({
      origin: { lat: 15.05, lng: 120.65, source: 'USER_GPS' },
      destination: { lat: 15.0, lng: 120.7, source: 'GEOAPIFY' },
      departureAt: '2026-09-28T08:00:00+08:00',
    }).value;
    const result = await orchestrateTripPlan(request, {
      now: () => new Date('2026-09-28T08:00:00+08:00'),
      services: {
        loadEligibleCoordinateNodes: async () => [],
        loadEligibleTransportGraphData: async () => ({ variants: [] }),
      },
    });
    assert.equal(result.status, 'NO_ELIGIBLE_ACCESS_NODES');
    assert.deepEqual(result.journeys, []);

    const state = await snapshot(client);
    const digest = crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex');
    assert.equal(digest, EXPECTED_TRANSPORT_DIGEST);
    console.log('ok - current PostgreSQL state has zero planning routes, variants and nodes; unified planning returns no fabricated journey');
    console.log('ok - Phase 14 performs zero persistent database writes');
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
