'use strict';
// Exercise the actual Passenger API handler + real Strapi loaders. Only walking
// is a controlled fixture, so no new Geoapify routes or credentials are needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compileStrapi, createStrapi } = require('@strapi/strapi');
const { createTripPlanHandler } = require('../src/api/pamana-ai/controllers/trip-plan');
const { orchestrateTripPlan } = require('../src/services/pamana-journey/trip-plan-orchestrator');
const { connect } = require('./seed-phase5b-transfer-research');
const { counts, digest } = require('./activate-pilot-field-verified');
const { EXPECTED_DIGEST, expectedGeometry } = require('./helpers/pilot-geometry-expectations');
const { assertNoSecrets } = require('./generate-batch-a5-candidates');
async function main() {
  const audit = await connect(); let app;
  try {
    const before = { counts: await counts(audit), digest: await digest(audit) }; assert.equal(before.digest, EXPECTED_DIGEST);
    app = await createStrapi(await compileStrapi()).load();
    const nodes = await app.documents('api::transport-node.transport-node').findMany({ filters: { planning_enabled: true, verification_status: 'FIELD_VERIFIED', data_mode: 'REAL' } });
    const byCode = new Map(nodes.map(n => [n.node_code, n]));
    const point = code => { const n = byCode.get(code); assert.ok(n); return { lat: Number(n.latitude), lng: Number(n.longitude), label: n.name, source: 'GEOAPIFY' }; };
    const router = { routeWalk: async ({ from, to }) => ({ ok: true, value: { type: 'WALK', from, to,
      distanceMeters: 0, durationSeconds: 0, geometry: { type: 'LineString', coordinates: [[from.lng, from.lat], [to.lng, to.lat]] },
      instructions: [], source: 'GEOAPIFY', calculatedAt: new Date().toISOString() } }) };
    const handler = createTripPlanHandler({ orchestrate: (request, options) => orchestrateTripPlan(request,
      { ...options, strapiInstance: app, router, walkingConfig: { initialCandidateRadiusMeters: 100, maximumCandidateRadiusMeters: 100 } }) });
    const psu = 'RCH-PSU-MEXICO-FRONT', sm = 'RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF', rob = 'RCH-ROB-STARMILLS-ARAYAT-GATE-LOAD', mexico = 'RCH-MEXICO-BAYAN-STA-MONICA-TRANSFER';
    const results = [];
    for (const category of ['REGULAR', 'STUDENT']) for (const [from, to] of [[psu, sm], [rob, psu], [mexico, sm], [psu, mexico]]) {
      const ctx = { state: { user: { id: 'batch-b-api-readonly-smoke', role: { name: 'Passenger' } } },
        request: { body: { origin: point(from), destination: point(to), departureAt: new Date().toISOString(), passengerCategory: category } },
        set() {}, forbidden() { throw new Error('Passenger role unexpectedly denied'); } };
      await handler(ctx); assert.equal(ctx.status, 200); assert.equal(ctx.body.status, 'JOURNEYS_FOUND');
      for (const journey of ctx.body.journeys) {
        const legs = journey.legs.filter(l => l.type === 'TRANSIT'); assert.equal(journey.transferCount, legs.length - 1);
        assert.equal(journey.fareSummary.totalStatus, 'KNOWN'); assert.ok(Number.isInteger(journey.fareSummary.totalFare));
        for (const leg of legs) { assert.equal(leg.fare.status, 'KNOWN'); assert.ok(Number.isInteger(leg.fare.payableFare));
          assert.equal(leg.roadDistanceSource, 'STORED_ROUTE_STOP_DISTANCE'); assert.deepEqual(leg.geometry, expectedGeometry(leg.variant.code));
          assert.equal(leg.fare.sourceType, leg.transportMode === 'TRICYCLE' ? 'DEMO_ESTIMATE' : 'SYSTEM_CALCULATED');
        }
      }
      results.push({ from, to, category, http_status_from_handler: ctx.status, response: ctx.body });
    }
    const regularOutbound = results.find(r => r.from === psu && r.to === sm && r.category === 'REGULAR').response;
    assert.equal(regularOutbound.journeys.find(j => j.transferCount === 0).fareSummary.totalFare, 27);
    assert.equal(regularOutbound.journeys.find(j => j.transferCount === 1).fareSummary.totalFare, 114);
    assert.deepEqual(await counts(audit), before.counts); assert.equal(await digest(audit), before.digest);
    for (const {response} of results) {
      assert.equal(response.recommendations.recommended.journeyId, response.journeys[0].id);
      assert.equal(response.recommendations.fewestTransfers.journeyId, response.journeys[0].id);
      assert.equal(response.recommendations.cheapest.journeyId, response.journeys[0].id);
      assert.deepEqual(response.recommendations.fastest, {journeyId:null, unavailableReason:'TIME_DATA_UNAVAILABLE'});
    }
    const report = { phase:'BATCH_B', recommendations_checked:true, scope: 'Actual Passenger controller + production Strapi database loaders; controlled walking fixture, no new Geoapify routing; no HTTP transport/authentication retest',
      passed: true, checked_at: new Date().toISOString(), database_digest: before.digest, results };
    assertNoSecrets(JSON.stringify(report), process.env.GEOAPIFY_SERVER_API_KEY);
    fs.writeFileSync(path.join(__dirname, '../documentation/batch-b-passenger-api-results.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('PASS: actual Passenger handler status 200/JOURNEYS_FOUND for eight regular/student endpoint requests; backend recommendation categories, approved stored geometry and integer fares returned');
    console.log('PASS: direct/inbound/onward and tricycle+jeep results, transfer counts and fare/distance provenance; no transport writes or new routing requests');
  } finally { if (app) await app.destroy(); await audit.end(); }
}
main().catch(error => { console.error(`API smoke failed: ${error instanceof assert.AssertionError ? error.message.split('\n')[0] : error.name}`); process.exitCode = 1; });
