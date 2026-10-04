'use strict';

// Read-only transport facts; mocked disruptions/AI never reach a database or HTTP API.
const assert = require('node:assert/strict');
const { connect } = require('./seed-phase5b-transfer-research');
const { counts, digest, loadVariant, manifest } = require('./activate-pilot-field-verified');
const { EXPECTED_DIGEST } = require('./check-hackathon-demo');
const { orchestrateTripPlan } = require('../src/services/pamana-journey/trip-plan-orchestrator');
const { validateTripPlanRequest } = require('../src/services/pamana-journey/trip-plan-request-validator');
const { createJourneyExplanationService, sanitizeJourneyExplanationRequest } = require('../src/services/pamana-ai/journey-explanation');
const { simulateScenarioSnapshot } = require('../src/services/pamana-demo/vehicle-simulator');

const CODES = Object.freeze({ psu: 'RCH-PSU-MEXICO-FRONT', sm: 'RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF', return: 'RCH-ROB-STARMILLS-ARAYAT-GATE-LOAD', outbound: 'RCH-SJ-SMROB-OUT', inbound: 'RCH-SJ-SMROB-IN' });
async function loadFacts(client) {
  const nodes = (await client.query('select * from transport_nodes where node_code=any($1::text[]) order by node_code', [manifest.nodes.map(node => node.node_code)])).rows;
  const variants = [];
  for (const variant of manifest.variants) variants.push(await loadVariant(client, variant.variant_code));
  const fareRules = (await client.query(`select f.*, to_char(f.effective_from,'YYYY-MM-DD') effective_from,
    to_char(f.effective_to,'YYYY-MM-DD') effective_to, jsonb_build_object('id',v.id,'documentId',v.document_id,'variant_code',v.variant_code) route_variant
    from fare_rules f join fare_rules_route_variant_lnk l on l.fare_rule_id=f.id
    join route_variants v on v.id=l.route_variant_id order by v.variant_code`)).rows;
  return { nodes, variants, fareRules };
}
async function rehearse(facts, at = new Date().toISOString()) {
  const untouched = JSON.stringify(facts);
  const point = code => {
    const node = facts.nodes.find(item => item.node_code === code);
    assert.ok(node, 'field-verified endpoint must exist');
    return { lat: Number(node.latitude), lng: Number(node.longitude), label: node.name };
  };
  // The rehearsal starts exactly at supplied endpoints. Nonzero walking is not fabricated.
  const router = { routeWalk: async () => ({ ok: false, error: { code: 'ROUTING_PROVIDER_UNAVAILABLE' } }) };
  const plan = async (from, to, disruptions = []) => {
    const validated = validateTripPlanRequest({ origin: point(from), destination: point(to), departureAt: at, passengerCategory: 'REGULAR' });
    assert.equal(validated.ok, true);
    return orchestrateTripPlan(validated.value, { now: () => new Date(at), router,
      walkingConfig: { initialCandidateRadiusMeters: 30, maximumCandidateRadiusMeters: 30 }, services: {
        loadEligibleCoordinateNodes: async () => facts.nodes,
        loadEligibleTransportGraphData: async () => ({ variants: facts.variants }),
        loadFareAndServiceData: async () => ({ fareRules: facts.fareRules, servicePatterns: [] }),
        loadOperationalData: async () => ({ operationalRecords: [] }),
        loadEligibleDisruptions: async () => disruptions,
      } });
  };
  const outbound = await plan(CODES.psu, CODES.sm);
  const inbound = await plan(CODES.return, CODES.psu);
  assert.equal(outbound.status, 'JOURNEYS_FOUND'); assert.equal(inbound.status, 'JOURNEYS_FOUND');
  const direct = outbound.journeys.find(journey => journey.transferCount === 0);
  const transfer = outbound.journeys.find(journey => journey.transferCount === 1);
  assert.ok(direct); assert.ok(transfer);
  assert.equal(direct.fareSummary.totalStatus, 'KNOWN'); assert.equal(direct.fareSummary.totalFare, 30);
  assert.equal(transfer.fareSummary.totalStatus, 'PARTIAL'); assert.equal(transfer.fareSummary.totalFare, null); assert.equal(transfer.fareSummary.knownSubtotal, 14);
  assert.ok(inbound.journeys[0].legs.some(leg => leg.type === 'TRANSIT' && leg.variant.code === CODES.inbound && leg.signboard === 'SAN JUAN'));
  for (const journey of [...outbound.journeys, ...inbound.journeys]) {
    assert.equal(journey.durationSummary.totalJourneyDurationSeconds, null);
    for (const leg of journey.legs.filter(item => item.type === 'TRANSIT')) {
      assert.equal(leg.geometry, null); assert.equal(leg.durationSeconds, null); assert.equal(leg.service.status, 'UNKNOWN');
      assert.deepEqual(leg.availability.wait, { status: 'UNKNOWN', lowMinutes: null, highMinutes: null, basis: null });
    }
  }
  const target = facts.variants.find(variant => variant.variant_code === CODES.outbound);
  const temporary = [{ id: 'phase26-in-memory-only', title: 'SIMULATED REHEARSAL: variant suspension', severity: 'high', effect: 'VARIANT_SUSPENDED', variantId: target.documentId || target.document_id, routeId: null, nodeId: null, geometry: null, startsAt: at, endsAt: null }];
  const changed = await plan(CODES.psu, CODES.sm, temporary);
  assert.ok(changed.journeys.length > 0 && changed.journeys.every(journey => journey.transferCount === 1));
  assert.deepEqual(await plan(CODES.return, CODES.psu, temporary), inbound, 'unrelated inbound journey unaffected');
  assert.deepEqual(await plan(CODES.psu, CODES.sm), outbound, 'reset is a fresh request without the in-memory effect');
  const request = { originLabel: point(CODES.psu).label, destinationLabel: point(CODES.sm).label, journey: {
    transferCount: direct.transferCount, modes: direct.modes, legs: direct.legs,
    fareSummary: direct.fareSummary, availabilitySummary: direct.availabilitySummary, durationSummary: direct.durationSummary, warnings: direct.warnings,
  } };
  assert.equal(sanitizeJourneyExplanationRequest(request).ok, true);
  const failedAI = await createJourneyExplanationService({ provider: { name: 'gemini', explainJourney: async () => { throw new Error('synthetic provider failure'); } } })(request);
  assert.equal(failedAI.status, 'PROVIDER_UNAVAILABLE'); assert.equal(failedAI.explanation, null);
  const snapshots = [0, 20, 40].map(elapsedSeconds => simulateScenarioSnapshot({ elapsedSeconds, now: new Date(at) }));
  assert.deepEqual(snapshots.map(snapshot => snapshot.vehicles[0].occupancy), ['AVAILABLE', 'NEAR_FULL', 'FULL']);
  assert.ok(snapshots.every(snapshot => snapshot.dataMode === 'SIMULATED' && snapshot.simulation));
  assert.deepEqual(simulateScenarioSnapshot({ elapsedSeconds: 0, now: new Date(at) }), snapshots[0]);
  assert.equal(JSON.stringify(facts), untouched);
  return { direct: 'PASS — REAL FIELD-VERIFIED TRANSPORT DATA', transfer: 'PASS — PARTIAL fare; known subtotal PHP 14',
    inbound: 'PASS — explicit INBOUND variant / SAN JUAN', simulation: 'PASS — SIMULATED OPERATIONAL DATA',
    occupancy: 'AVAILABLE → NEAR_FULL → FULL', disruption: 'PASS — in-memory normalized effect only; unrelated inbound unchanged; reset verified',
    aiFailure: 'PASS — mocked failure; factual result unchanged', geometry: 'TRANSIT remains null; no nonzero walking geometry fabricated',
    externalProviderRequests: 0, persistentWrites: 0 };
}
async function main() {
  const client = await connect();
  try {
    await client.query('begin read only');
    assert.equal(await digest(client), EXPECTED_DIGEST);
    const before = await counts(client);
    const results = await rehearse(await loadFacts(client));
    assert.deepEqual(await counts(client), before); assert.equal(await digest(client), EXPECTED_DIGEST);
    console.log(JSON.stringify({ ...results, digest: EXPECTED_DIGEST }, null, 2));
  } finally { await client.query('rollback'); await client.end(); }
}
if (require.main === module) main().catch(() => { console.error('Demo rehearsal failed. No provider details or secrets are logged.'); process.exitCode = 1; });
module.exports = { rehearse, loadFacts, CODES };
