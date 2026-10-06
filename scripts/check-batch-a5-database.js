'use strict';
// Fresh read-only checkpoint; does not run any existing seed/apply database tests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { databaseAudit, REPORT, CODES } = require('./generate-batch-a5-candidates');
const { connect } = require('./seed-phase5b-transfer-research');
const { loadVariant } = require('./activate-pilot-field-verified');
const { buildTransportGraph } = require('../src/services/pamana-journey/graph-builder');
const { planJourneys } = require('../src/services/pamana-journey/journey-planner');
const { enrichJourneyInformation } = require('../src/services/pamana-journey/journey-information-enricher');
async function main() {
  const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
  const current = await databaseAudit();
  assert.equal(current.digest, report.database_before.digest);
  assert.deepEqual(current.full_database, report.database_before.full_database);
  assert.deepEqual(current.variants, report.database_before.variants);
  const client = await connect(); let variants;
  try {
    await client.query('begin isolation level repeatable read read only');
    variants = []; for (const code of CODES) variants.push(await loadVariant(client, code));
    await client.query('rollback');
  } finally { await client.end(); }
  const graph = buildTransportGraph({ variants });
  const options = { requestedDeparture: '2026-10-05T08:00:00+08:00' };
  const plan = (from, to) => planJourneys(graph, { candidateBoardingNodeIds: [from], candidateDestinationNodeIds: [to] })
    .map(j => enrichJourneyInformation(j, options));
  const outbound = plan('RCH-PSU-MEXICO-FRONT', 'RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF');
  const direct = outbound.find(j => j.transferCount === 0), transfer = outbound.find(j => j.transferCount === 1);
  const inbound = plan('RCH-ROB-STARMILLS-ARAYAT-GATE-LOAD', 'RCH-PSU-MEXICO-FRONT')[0];
  assert.ok(direct && transfer && inbound);
  assert.equal(direct.legs[0].fare.status, 'FARE_DISTANCE_UNAVAILABLE');
  assert.equal(direct.legs[0].fare.payableFare, null);
  assert.equal(inbound.legs[0].fare.status, 'FARE_DISTANCE_UNAVAILABLE');
  assert.equal(inbound.transferCount, 0);
  assert.equal(transfer.legs[0].fare.payableFare, 100);
  assert.equal(transfer.legs[0].fare.sourceType, 'DEMO_ESTIMATE');
  assert.equal(transfer.legs[1].fare.status, 'FARE_DISTANCE_UNAVAILABLE');
  assert.equal(transfer.fareSummary.knownSubtotal, 100);
  assert.equal(transfer.fareSummary.totalFare, null);
  // REAL/SIMULATED planning gate remains effective with no production edits.
  const simulated = variants.map(v => ({ ...v, data_mode: 'SIMULATED' }));
  assert.equal(buildTransportGraph({ variants: simulated }).variants.size, 0);
  const after = await databaseAudit();
  assert.deepEqual(after.full_database, current.full_database);
  assert.equal(after.digest, current.digest);
  console.log('PASS: fresh read-only DB checkpoint; full row/sequence hashes, null geometry, UNKNOWN source and pilot eligibility unchanged');
  console.log('PASS: production planner/fare modules still return FARE_DISTANCE_UNAVAILABLE for jeep legs; tricycle remains PHP 100, total null; REAL/SIMULATED isolation enforced');
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
