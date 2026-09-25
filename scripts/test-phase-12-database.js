'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connect, snapshot } = require('./seed-phase5b-transfer-research');
const { enrichJourneyInformation } = require('../src/services/pamana-journey/journey-information-enricher');

const EXPECTED_PHASE_11_DIGEST = '77776e1a08d971a39b2718a10a116c7748e452900f26931dfbc90acd0377fdae';

async function main() {
  const client = await connect();
  try {
    await client.query('begin read only');
    const counts = (await client.query(`
      select
        (select count(*)::int from fare_rules) as fare_rules,
        (select count(*)::int from service_patterns) as service_patterns`)).rows[0];
    assert.deepEqual(counts, { fare_rules: 0, service_patterns: 0 });

    const researchState = (await client.query(`
      select
        (select count(*)::int from routes
          where route_code = 'RCH-SJ-CSF-SM-ROB'
            and base_fare is null and planning_enabled is false) as routes_preserved,
        (select count(*)::int from route_variants
          where variant_code in ('RCH-SJ-SMROB-OUT', 'RCH-SJ-SMROB-IN')
            and planning_enabled is false and operating_status = 'UNKNOWN') as variants_preserved`)).rows[0];
    assert.deepEqual(researchState, { routes_preserved: 1, variants_preserved: 2 });

    const journey = Object.freeze({
      id: 'database-contract-check',
      legs: Object.freeze([Object.freeze({
        sequence: 1,
        type: 'TRANSIT',
        routeId: 'unresolved-research-route',
        routeVariantId: 'unresolved-research-variant',
        routeCode: 'RCH-SJ-CSF-SM-ROB',
        variantCode: 'RCH-SJ-SMROB-OUT',
        segmentDistanceMeters: null,
      })]),
    });
    const enriched = enrichJourneyInformation(journey, {
      fareRules: [],
      servicePatterns: [],
      requestedDeparture: '2026-09-28T08:00:00+08:00',
    });
    assert.equal(enriched.legs[0].fare.status, 'UNKNOWN');
    assert.equal(enriched.legs[0].fare.regularFare, null);
    assert.equal(enriched.legs[0].service.status, 'UNKNOWN');
    assert.equal(enriched.fareSummary.totalStatus, 'UNKNOWN');
    assert.equal(enriched.fareSummary.totalFare, null);

    const state = await snapshot(client);
    const digest = crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex');
    assert.equal(digest, EXPECTED_PHASE_11_DIGEST, 'Phase 12 must not modify PostgreSQL transport rows');
    console.log('ok - production contains zero FareRule and zero ServicePattern records');
    console.log('ok - current research journey enrichment remains fare UNKNOWN and service UNKNOWN');
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
