'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const routes = require('../src/api/pamana-ai/routes/pamana-ai');
const { createTripPlanHandler } = require('../src/api/pamana-ai/controllers/trip-plan');
const { PASSENGER_CATEGORIES } = require('../src/services/pamana-journey/fare-engine');
const { planJourneysWithWalkingCandidates } = require('../src/services/pamana-journey/walking-journey-service');
const {
  TRIP_PLAN_STATUS,
  orchestrateTripPlan,
} = require('../src/services/pamana-journey/trip-plan-orchestrator');
const { validateTripPlanRequest } = require('../src/services/pamana-journey/trip-plan-request-validator');
const { directFixture, evidence, node, route, simulatedFixture, stop, variant } = require('./fixtures/phase10-synthetic-network');
const { directWalkingFixture, transferWalkingFixture, withCoordinates } = require('./fixtures/phase11-synthetic-network');
const { fareRule, servicePattern } = require('./fixtures/phase12-synthetic-information');
const { operationalRecord } = require('./fixtures/phase13-synthetic-availability');

const NOW = new Date('2026-09-28T08:00:00+08:00');
const REQUEST_BODY = Object.freeze({
  origin: Object.freeze({ lat: 14.5994, lng: 120.9794, label: 'Synthetic origin', source: 'USER_GPS' }),
  destination: Object.freeze({ lat: 14.6106, lng: 120.9906, label: 'Synthetic destination', source: 'GEOAPIFY' }),
  departureAt: '2026-09-28T08:00:00+08:00',
  passengerCategory: 'REGULAR',
});
const REQUEST = validateTripPlanRequest(REQUEST_BODY).value;
const geometry = Object.freeze({ type: 'LineString', coordinates: [[120.9794, 14.5994], [120.98, 14.6]] });

function fixtureRouter({ fail = () => false } = {}) {
  return Object.freeze({
    async routeWalk({ from, to }) {
      if (fail(from, to)) return Object.freeze({ ok: false, error: Object.freeze({ code: 'ROUTING_TIMEOUT' }) });
      return Object.freeze({
        ok: true,
        value: Object.freeze({
          type: 'WALK', from, to, distanceMeters: 120, durationSeconds: 90,
          geometry, instructions: Object.freeze([]), source: 'GEOAPIFY',
          calculatedAt: NOW.toISOString(),
        }),
      });
    },
  });
}

function fixtureServices(fixture, {
  fareRules = [], servicePatterns = [], operationalRecords = [], capture = {}, overrides = {},
} = {}) {
  return {
    loadEligibleCoordinateNodes: async () => Object.values(fixture.nodes || {}),
    loadEligibleTransportGraphData: async (options) => {
      capture.graphOptions = options;
      return { variants: fixture.variants || [] };
    },
    loadFareAndServiceData: async () => ({ fareRules, servicePatterns }),
    loadOperationalData: async (options) => {
      capture.operationOptions = options;
      return { operationalRecords };
    },
    ...overrides,
  };
}

async function planFixture(fixture, options = {}) {
  return orchestrateTripPlan(options.request || REQUEST, {
    router: options.router || fixtureRouter(),
    now: () => NOW,
    walkingConfig: { initialCandidateRadiusMeters: 300, maximumCandidateRadiusMeters: 300, maxCandidateCount: 5 },
    config: options.config,
    services: fixtureServices(fixture, options),
  });
}

{
  assert.deepEqual(PASSENGER_CATEGORIES, ['REGULAR', 'STUDENT', 'SENIOR', 'PWD']);
  assert.equal(validateTripPlanRequest(REQUEST_BODY).ok, true);
  const defaulted = validateTripPlanRequest({
    origin: { lat: 15, lng: 120 }, destination: { lat: 15.1, lng: 120.1 },
  }, { now: () => NOW });
  assert.equal(defaulted.value.departureAt, NOW.toISOString());
  assert.equal(defaulted.value.passengerCategory, 'REGULAR');

  for (const body of [
    null,
    {},
    { ...REQUEST_BODY, origin: { lat: '15', lng: 120 } },
    { ...REQUEST_BODY, origin: { lat: NaN, lng: 120 } },
    { ...REQUEST_BODY, origin: { lat: Infinity, lng: 120 } },
    { ...REQUEST_BODY, origin: { lat: 91, lng: 120 } },
    { ...REQUEST_BODY, destination: { lat: 15, lng: 181 } },
    { ...REQUEST_BODY, origin: { lat: 0, lng: 0 } },
    { ...REQUEST_BODY, departureAt: '2026-02-30T08:00:00+08:00' },
    { ...REQUEST_BODY, departureAt: 'September 28' },
    { ...REQUEST_BODY, passengerCategory: 'CHILD' },
    { ...REQUEST_BODY, routeVariantId: 'client-truth' },
    { ...REQUEST_BODY, origin: { ...REQUEST_BODY.origin, boardingNodeId: 'client-truth' } },
    { ...REQUEST_BODY, unexpected: true },
  ]) assert.equal(validateTripPlanRequest(body).ok, false);
  const oversized = { ...REQUEST_BODY, origin: { ...REQUEST_BODY.origin, label: 'x'.repeat(9000) } };
  assert.equal(validateTripPlanRequest(oversized).ok, false);
  console.log('ok - request validation enforces shape, numeric bounds, 0,0 protection, timestamps, categories and server-owned facts');
}

async function testDirectEnrichment() {
  const fixture = directWalkingFixture();
  const variantRecord = fixture.variants[0];
  variantRecord.geometry_source = 'FIELD_GPS';
  variantRecord.geometry_geojson = geometry;
  const result = await planFixture(fixture, {
    fareRules: [fareRule('PHASE14', { variantRecord, regularFare: 20 })],
    servicePatterns: [servicePattern('PHASE14', variantRecord)],
    operationalRecords: [operationalRecord(variantRecord)],
  });
  assert.equal(result.status, TRIP_PLAN_STATUS.JOURNEYS_FOUND);
  assert.equal(result.meta.dataMode, 'REAL');
  assert.equal(result.meta.journeyCount, 1);
  assert.equal(result.request.departureAt, '2026-09-28T00:00:00.000Z');
  const journey = result.journeys[0];
  assert.deepEqual(journey.legs.map((leg) => leg.type), ['WALK', 'TRANSIT', 'WALK']);
  assert.equal(journey.transferCount, 0);
  assert.equal(journey.legs[0].distanceMeters, 120);
  assert.equal(journey.legs[0].durationSeconds, 90);
  const transit = journey.legs[1];
  assert.equal(transit.fare.status, 'KNOWN');
  assert.equal(transit.fare.payableFare, 20);
  assert.equal(transit.service.status, 'KNOWN');
  assert.equal(transit.availability.status, 'LIVE_ACTIVE');
  assert.equal(transit.availability.wait.status, 'SERVICE_INTERVAL_ONLY');
  assert.equal(transit.durationSeconds, null);
  assert.deepEqual(transit.geometry, geometry);
  assert.equal(journey.durationSummary.knownWalkingDurationSeconds, 180);
  assert.equal(journey.durationSummary.totalJourneyDurationSeconds, null);
  assert.equal(JSON.stringify(result).includes('recommendation'), false);
  console.log('ok - direct orchestration returns WALK, TRANSIT, WALK with fare, service and live availability and no fake transit duration');
}

async function testTransfer() {
  const fixture = transferWalkingFixture();
  const result = await planFixture(fixture, {
    servicePatterns: fixture.variants.map((item, index) => servicePattern(`TRANSFER-${index}`, item)),
  });
  assert.equal(result.status, TRIP_PLAN_STATUS.JOURNEYS_FOUND);
  assert.equal(result.journeys[0].transferCount, 1);
  assert.deepEqual(result.journeys[0].legs.map((leg) => leg.type), [
    'WALK', 'TRANSIT', 'TRANSFER', 'TRANSIT', 'WALK',
  ]);
  assert.equal(result.journeys[0].legs[2].fare.status, 'NOT_APPLICABLE');
  console.log('ok - transfer orchestration preserves independent transit legs and WALK, TRANSIT, TRANSFER, TRANSIT, WALK order');
}

async function testUnknownsAndDomainResults() {
  const unknown = await planFixture(directWalkingFixture());
  const transit = unknown.journeys[0].legs.find((leg) => leg.type === 'TRANSIT');
  assert.equal(transit.fare.status, 'UNKNOWN');
  assert.equal(transit.fare.payableFare, null);
  assert.equal(transit.service.status, 'UNKNOWN');
  assert.equal(transit.availability.status, 'UNKNOWN');
  assert.equal(transit.availability.wait.lowMinutes, null);
  assert.equal(transit.availability.wait.highMinutes, null);
  assert.equal(transit.durationSeconds, null);
  assert.equal(unknown.journeys[0].durationSummary.totalJourneyDurationSeconds, null);

  const noNodes = await orchestrateTripPlan(REQUEST, {
    now: () => NOW,
    services: {
      loadEligibleCoordinateNodes: async () => [],
      loadEligibleTransportGraphData: async () => ({ variants: [] }),
    },
  });
  assert.equal(noNodes.status, TRIP_PLAN_STATUS.NO_ELIGIBLE_ACCESS_NODES);
  assert.deepEqual(noNodes.journeys, []);

  const nodes = {
    A: withCoordinates(node('DISC-A'), 14.6000, 120.9800),
    B: withCoordinates(node('DISC-B'), 14.6030, 120.9830),
    C: withCoordinates(node('DISC-C'), 14.6070, 120.9870),
    D: withCoordinates(node('DISC-D'), 14.6100, 120.9900),
  };
  const firstRoute = route('DISC-FIRST');
  const secondRoute = route('DISC-SECOND');
  const disconnected = {
    nodes,
    variants: [
      variant('DISC-FIRST-OUT', 'OUTBOUND', firstRoute, [stop('DISC-FIRST-OUT', nodes.A, 1), stop('DISC-FIRST-OUT', nodes.B, 2)]),
      variant('DISC-SECOND-OUT', 'OUTBOUND', secondRoute, [stop('DISC-SECOND-OUT', nodes.C, 1), stop('DISC-SECOND-OUT', nodes.D, 2)]),
    ],
  };
  const noJourney = await planFixture(disconnected);
  assert.equal(noJourney.status, TRIP_PLAN_STATUS.NO_TRANSPORT_JOURNEY);
  assert.deepEqual(noJourney.journeys, []);
  console.log('ok - unknown values remain null and empty access/graph outcomes return normal domain statuses');
}

async function testProviderFailures() {
  const unavailable = await planFixture(directWalkingFixture(), {
    router: fixtureRouter({ fail: () => true }),
  });
  assert.equal(unavailable.status, TRIP_PLAN_STATUS.ROUTING_PROVIDER_UNAVAILABLE);
  assert.ok(unavailable.warnings.includes('ROUTING_TIMEOUT'));

  const fixture = directWalkingFixture();
  const partial = await planFixture(fixture, {
    overrides: {
      planJourneysWithWalkingCandidates: async (options) => {
        const result = await planJourneysWithWalkingCandidates(options);
        return { ...result, failures: [...result.failures, { nodeId: 'failed-candidate', code: 'ROUTING_TIMEOUT' }] };
      },
    },
  });
  assert.equal(partial.status, TRIP_PLAN_STATUS.JOURNEYS_FOUND);
  assert.equal(partial.meta.journeyCount, 1);
  assert.ok(partial.warnings.includes('ROUTING_TIMEOUT'));
  console.log('ok - total routing failure is controlled while partial candidate failure preserves valid journeys and warnings');
}

async function testBoundsOrderingAndEvidenceIsolation() {
  const fixture = directWalkingFixture();
  const routeRecord = fixture.variants[0].route;
  fixture.variants = Array.from({ length: 8 }, (_, index) => variant(
    `BOUND-${String(index).padStart(2, '0')}`, 'OUTBOUND', routeRecord,
    [stop(`BOUND-${index}`, fixture.nodes.A, 1), stop(`BOUND-${index}`, fixture.nodes.B, 2)]
  ));
  const capture = {};
  const bounded = await planFixture(fixture, { capture, config: { maxJourneys: 5 } });
  assert.equal(bounded.journeys.length, 5);
  assert.deepEqual(bounded.journeys.map((journey) => journey.legs.find((leg) => leg.type === 'TRANSIT').variant.code),
    ['BOUND-00', 'BOUND-01', 'BOUND-02', 'BOUND-03', 'BOUND-04']);
  assert.equal(capture.graphOptions.demoMode, false);
  assert.equal(capture.operationOptions.allowSimulated, false);

  const simulated = simulatedFixture();
  simulated.nodes.A = withCoordinates(simulated.nodes.A, 14.6, 120.98);
  simulated.nodes.B = withCoordinates(simulated.nodes.B, 14.61, 120.99);
  simulated.variants[0].route_variant_stops[0].transport_node = simulated.nodes.A;
  simulated.variants[0].route_variant_stops[1].transport_node = simulated.nodes.B;
  assert.notEqual((await planFixture(simulated)).status, TRIP_PLAN_STATUS.JOURNEYS_FOUND);

  const research = directFixture();
  research.nodes.A = withCoordinates({ ...research.nodes.A, ...evidence, planning_enabled: false, verification_status: 'CORROBORATED_RESEARCH' }, 14.6, 120.98);
  research.nodes.C = withCoordinates({ ...research.nodes.C, ...evidence, planning_enabled: false, verification_status: 'CORROBORATED_RESEARCH' }, 14.61, 120.99);
  research.variants[0].planning_enabled = false;
  research.variants[0].verification_status = 'CORROBORATED_RESEARCH';
  assert.notEqual((await planFixture(research)).status, TRIP_PLAN_STATUS.JOURNEYS_FOUND);
  console.log('ok - results are capped and stably ordered; production orchestration rejects simulated and research evidence');
}

async function testAuthenticationAndDependencyBoundary() {
  const routeConfig = routes.routes.find((item) => item.path === '/pamana-ai/trip-plan');
  assert.equal(routeConfig.method, 'POST');
  assert.equal(routeConfig.handler, 'trip-plan.create');
  assert.notEqual(routeConfig.config.auth, false);
  assert.ok(routes.routes.some((item) => item.path === '/pamana-ai/wait-time'));

  let rejected = false;
  await createTripPlanHandler()({
    state: {}, request: { body: REQUEST_BODY },
    unauthorized() { rejected = true; this.status = 401; },
  });
  assert.equal(rejected, true);

  let called = false;
  const permitted = createTripPlanHandler({
    orchestrate: async (request) => {
      called = true;
      return { request, status: 'NO_ELIGIBLE_ACCESS_NODES', journeys: [], meta: {} };
    },
    now: () => NOW,
  });
  const ctx = { state: { user: { id: 1, role: { name: 'Passenger' } } }, request: { body: REQUEST_BODY } };
  await permitted(ctx);
  assert.equal(called, true);
  assert.equal(ctx.status, 200);

  const bootstrapSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
  assert.match(bootstrapSource, /Passenger:[\s\S]*api::pamana-ai\.trip-plan\.create/);
  const dependencyFiles = [
    'src/api/pamana-ai/controllers/trip-plan.js',
    ...fs.readdirSync(path.join(__dirname, '..', 'src', 'services', 'pamana-journey'))
      .filter((file) => file.endsWith('.js')).map((file) => `src/services/pamana-journey/${file}`),
  ];
  const source = dependencyFiles.map((file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).join('\n');
  assert.doesNotMatch(source, /services[\\/]pamana-ai|OpenAI|Gemini|predictWaitTime|predictDemand|analyzeSupplyDemand/);
  assert.doesNotMatch(source, /mode\s*[=:]\s*['\"]?(?:drive|transit)/i);
  console.log('ok - endpoint requires authentication, grants Passenger permission, preserves legacy API and has no LLM, ML, or drive-routing dependency');
}

async function main() {
  await testDirectEnrichment();
  await testTransfer();
  await testUnknownsAndDomainResults();
  await testProviderFailures();
  await testBoundsOrderingAndEvidenceIsolation();
  await testAuthenticationAndDependencyBoundary();
}

main().catch((error) => {
  console.error(`FAIL: ${error.stack || error.message}`);
  process.exitCode = 1;
});
