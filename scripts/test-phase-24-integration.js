'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compileStrapi, createStrapi } = require('@strapi/strapi');
const { connect } = require('./seed-phase5b-transfer-research');
const { counts, digest } = require('./activate-pilot-field-verified');
const { orchestrateTripPlan } = require('../src/services/pamana-journey/trip-plan-orchestrator');
const EXPECTED = '3d63fcdb5d9581d71e2c68d54db9c00868510dcc9b91e6e38fcb893373af9139';

// The real Strapi data loaders and deterministic engine run together. Only the
// external walking provider is mocked; its synthetic geometry is never saved.
(async () => {
  const audit = await connect();
  let app;
  try {
    assert.equal(await digest(audit), EXPECTED);
    app = await createStrapi(await compileStrapi()).load();
    const nodes = await app.documents('api::transport-node.transport-node').findMany({
      filters: { planning_enabled: true, verification_status: 'FIELD_VERIFIED', data_mode: 'REAL' },
    });
    const byCode = new Map(nodes.map(node => [node.node_code, node]));
    assert.equal(byCode.size, 4);
    const point = code => {
      const node = byCode.get(code); assert.ok(node, 'verified endpoint exists');
      return { lat: Number(node.latitude), lng: Number(node.longitude), label: node.name, source: 'GEOAPIFY' };
    };
    const router = { routeWalk: async ({ from, to }) => ({ ok: true, value: {
      type: 'WALK', from, to, distanceMeters: 20, durationSeconds: 20,
      geometry: { type: 'LineString', coordinates: [[from.lng, from.lat], [to.lng, to.lat]] },
      instructions: [], source: 'GEOAPIFY', calculatedAt: new Date().toISOString(),
    } }) };
    const psu = 'RCH-PSU-MEXICO-FRONT', sm = 'RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF',
      mexico = 'RCH-MEXICO-BAYAN-STA-MONICA-TRANSFER', returnCode = 'RCH-ROB-STARMILLS-ARAYAT-GATE-LOAD';
    const results = [];
    for (const [from, to, category] of [[psu, sm, 'REGULAR'], [psu, mexico, 'REGULAR'], [mexico, sm, 'REGULAR'], [returnCode, psu, 'REGULAR'], [psu, sm, 'STUDENT']]) {
      const request = { origin: point(from), destination: point(to), departureAt: new Date().toISOString(), passengerCategory: category };
      const result = await orchestrateTripPlan(request, { strapiInstance: app, router, walkingConfig: { initialCandidateRadiusMeters: 100, maximumCandidateRadiusMeters: 100 } });
      assert.equal(result.status, 'JOURNEYS_FOUND');
      assert.ok(result.journeys.length > 0);
      for (const journey of result.journeys) {
        assert.equal(journey.dataQuality.planningEligible, true);
        for (const leg of journey.legs.filter(leg => leg.type === 'TRANSIT')) {
          assert.equal(leg.geometry, null); assert.equal(leg.durationSeconds, null);
          assert.equal(leg.service.status, 'UNKNOWN');
          assert.equal(leg.service.headwayMinutes, null);
        }
        assert.equal(journey.durationSummary.totalJourneyDurationSeconds, null);
      }
      results.push(result);
    }
    assert.ok(results[0].journeys.some(journey => journey.transferCount === 0 && journey.fareSummary.totalFare === 30));
    assert.ok(results[0].journeys.some(journey => journey.transferCount === 1));
    assert.ok(results[3].journeys.every(journey => journey.legs.some(leg => leg.type === 'TRANSIT' && leg.direction === 'INBOUND')));
    assert.ok(results[4].journeys.every(journey => journey.legs.filter(leg => leg.type === 'TRANSIT').every(leg => leg.fare.discountedFare === null)));
    console.log('ok - real Strapi loaders compose direct, transfer, intermediate and inbound pilot journeys with factual fares and unknown schedules/ETA');
    const missing = await orchestrateTripPlan({ ...results[0].request, origin: { lat: 14, lng: 119 } }, { strapiInstance: app, router });
    assert.equal(missing.status, 'NO_ELIGIBLE_ACCESS_NODES'); assert.deepEqual(missing.journeys, []);
    const nonzeroWalk = { ...results[0].request, origin: { ...results[0].request.origin, lat: results[0].request.origin.lat + 0.0003 }, destination: { ...results[0].request.destination, lat: results[0].request.destination.lat + 0.0003 } };
    const unavailable = await orchestrateTripPlan(nonzeroWalk, { strapiInstance: app,
      router: { routeWalk: async () => ({ ok: false, error: { code: 'ROUTING_PROVIDER_UNAVAILABLE' } }) } });
    assert.equal(unavailable.status, 'ROUTING_PROVIDER_UNAVAILABLE'); assert.deepEqual(unavailable.journeys, []);
    console.log('ok - far-away places and external routing failure produce honest empty states');
    const current = await counts(audit);
    assert.deepEqual([current.planning_routes, current.planning_variants, current.field_verified_nodes, current.route_variant_stops, current.fare_rules, current.service_patterns], [3, 4, 4, 8, 2, 0]);
    assert.equal(await digest(audit), EXPECTED);
    if (process.env.PAMANA_PHASE24_CONTRACT_FILE) {
      const file = path.resolve(process.env.PAMANA_PHASE24_CONTRACT_FILE);
      fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(results));
    }
    console.log('ok - integrated planning makes zero transport writes; pilot digest and counts unchanged');
  } finally { if (app) await app.destroy(); await audit.end(); }
})().catch(error => { console.error(`FAIL - ${error instanceof assert.AssertionError ? error.message : error.name} (provider details withheld)`); process.exitCode = 1; });
