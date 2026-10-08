'use strict';
const assert = require('node:assert/strict');
const { compileStrapi, createStrapi } = require('@strapi/strapi');
const { connect } = require('./seed-phase5b-transfer-research');
const { counts } = require('./activate-pilot-field-verified');
const { transportDigest } = require('./activate-san-fernando-expansion');
const { expectedGeometry } = require('./helpers/pilot-geometry-expectations');
const { orchestrateTripPlan } = require('../src/services/pamana-journey/trip-plan-orchestrator');
const { createTripPlanHandler } = require('../src/api/pamana-ai/controllers/trip-plan');
const { expansionSettings } = require('../src/services/pamana-journey/pilot-expansion');
async function main() {
  const audit = await connect(); let app;
  try {
    const before = { digest: await transportDigest(audit), counts: await counts(audit) };
    app = await createStrapi(await compileStrapi()).load();
    const nodes = await app.documents('api::transport-node.transport-node').findMany({ filters: { planning_enabled: true, verification_status: 'FIELD_VERIFIED', data_mode: 'REAL' } });
    const byCode = new Map(nodes.map(n => [n.node_code, n]));
    const codes = ['RCH-PSU-MEXICO-FRONT', 'RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF', 'RCH-ROB-STARMILLS-ARAYAT-GATE-LOAD', 'RCH-MEXICO-BAYAN-STA-MONICA-TRANSFER'];
    const point = code => { const n = byCode.get(code); assert.ok(n); return { lat: Number(n.latitude), lng: Number(n.longitude), label: n.name, source: 'GEOAPIFY' }; };
    const router = { routeWalk: async ({ from, to }) => ({ ok: true, value: { type: 'WALK', from, to, distanceMeters: 0, durationSeconds: 0,
      geometry: { type: 'LineString', coordinates: [[from.lng, from.lat], [to.lng, to.lat]] }, instructions: [], source: 'GEOAPIFY', calculatedAt: new Date().toISOString() } }) };
    const handler = createTripPlanHandler({ orchestrate: (request, options) => orchestrateTripPlan(request, { ...options, strapiInstance: app, router,
      walkingConfig: { initialCandidateRadiusMeters: 100, maximumCandidateRadiusMeters: 100 } }) });
    let requests = 0;
    for (const category of ['REGULAR', 'STUDENT', 'SENIOR', 'PWD']) for (const [from, to] of [[codes[0], codes[1]], [codes[2], codes[0]], [codes[3], codes[1]], [codes[0], codes[3]]]) {
      const ctx = { state: { user: { id: 'csf-existing-pilot-test', role: { name: 'Passenger' } } }, request: { body: {
        origin: point(from), destination: point(to), departureAt: new Date().toISOString(), passengerCategory: category } } };
      await handler(ctx); assert.equal(ctx.status, 200); assert.equal(ctx.body.status, 'JOURNEYS_FOUND'); requests++;
      for (const j of ctx.body.journeys) {
        assert.equal(j.fareSummary.totalStatus, 'KNOWN'); assert.equal(j.dataQuality.planningEligible, true); assert.deepEqual(j.dataQuality.dataModes, ['REAL']);
        const rides = j.legs.filter(l => l.type === 'TRANSIT'); assert.equal(j.transferCount, rides.length - 1);
        for (const leg of rides) { assert.deepEqual(leg.geometry, expectedGeometry(leg.variant.code)); assert.ok(Number.isInteger(leg.fare.payableFare)); }
      }
      if (from === codes[0] && to === codes[1] && category === 'REGULAR') {
        assert.equal(ctx.body.journeys.find(j => j.transferCount === 0).fareSummary.totalFare, 27);
        assert.equal(ctx.body.journeys.find(j => j.transferCount === 1).fareSummary.totalFare, 114);
      }
    }
    assert.equal(expansionSettings({ enabled: true }).enabled, false);
    assert.equal(await transportDigest(audit), before.digest); assert.deepEqual(await counts(audit), before.counts);
    console.log(`ok - ${requests} real-loader Passenger requests retain PSU/Mexico/SM/Robinson geometry, fares, discounts and rankings; transport digest unchanged`);
  } finally { if (app) await app.destroy(); await audit.end(); }
}
main().catch(error => { console.error(`FAIL: ${error.message}`); process.exitCode = 1; });
