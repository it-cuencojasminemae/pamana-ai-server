'use strict';

const assert = require('node:assert/strict');
const { buildTransportGraph } = require('../src/services/pamana-journey/graph-builder');
const { planJourneys } = require('../src/services/pamana-journey/journey-planner');
const { normalizeDisruption, disruptionQuery, loadEligibleDisruptions } = require('../src/services/pamana-journey/disruption-data-loader');
const {
  applyDisruptionConstraints,
  attachDisruptionWarnings,
} = require('../src/services/pamana-journey/disruption-engine');
const { orchestrateTripPlan } = require('../src/services/pamana-journey/trip-plan-orchestrator');
const { validateTripPlanRequest } = require('../src/services/pamana-journey/trip-plan-request-validator');
const { createTripPlanHandler } = require('../src/api/pamana-ai/controllers/trip-plan');
const { roleEligibleNodes } = require('../src/services/pamana-journey/walking-journey-service');
const { directFixture, evidence, route, stop, throughRouteFixture, transferFixture, variant } = require('./fixtures/phase10-synthetic-network');
const { directWalkingFixture } = require('./fixtures/phase11-synthetic-network');

const AT = new Date('2026-09-28T00:00:00.000Z');
const disruption = (effect, target = {}, overrides = {}) => ({
  id: `disruption-${effect}-${Object.values(target)[0] || 'general'}`,
  effect,
  title: `Synthetic ${effect}`,
  severity: 'high',
  startsAt: '2026-09-27T00:00:00.000Z',
  endsAt: null,
  routeId: null,
  variantId: null,
  nodeId: null,
  geometry: null,
  ...target,
  ...overrides,
});

function graphAfter(fixture, disruptions) {
  return buildTransportGraph(applyDisruptionConstraints({ variants: fixture.variants }, disruptions).graphData, {
    serviceDate: AT,
  });
}

function journeys(graph, from, to) {
  return planJourneys(graph, { candidateBoardingNodeIds: [from], candidateDestinationNodeIds: [to] });
}

{
  const query = disruptionQuery({ serviceDate: AT });
  assert.equal(query.filters.planning_enabled, true);
  assert.equal(query.filters.data_mode, 'REAL');
  assert.equal(query.filters.disruption_status, 'active');
  assert.equal(query.filters.starts_at.$lte, AT.toISOString());
  assert.equal(query.filters.resolved_at.$null, true);
  assert.ok(query.populate.affected_route && query.populate.affected_route_variant && query.populate.affected_transport_node);

  const raw = {
    id: 'trusted', title: 'Trusted warning', severity: 'moderate', effect: 'WARNING_ONLY',
    starts_at: '2026-09-27T00:00:00.000Z', ends_at: '2026-09-29T00:00:00.000Z',
    disruption_status: 'active', resolved_at: null, ...evidence,
    geometry_source: 'FIELD_GPS', geometry_geojson: { type: 'Point', coordinates: [120.7, 15.1] },
  };
  assert.ok(normalizeDisruption(raw, { serviceDate: AT }));
  assert.equal(normalizeDisruption({ ...raw, planning_enabled: false }, { serviceDate: AT }), null);
  assert.equal(normalizeDisruption({ ...raw, verification_status: 'RESEARCH_CANDIDATE' }, { serviceDate: AT }), null);
  assert.equal(normalizeDisruption({ ...raw, data_mode: 'SIMULATED' }, { serviceDate: AT }), null);
  assert.equal(normalizeDisruption({ ...raw, starts_at: '2026-09-29T00:00:00.000Z' }, { serviceDate: AT }), null);
  assert.equal(normalizeDisruption({ ...raw, ends_at: AT.toISOString() }, { serviceDate: AT }), null);
  assert.equal(normalizeDisruption({ ...raw, resolved_at: '2026-09-27T12:00:00.000Z' }, { serviceDate: AT }), null);
  assert.equal(normalizeDisruption({ ...raw, effect: 'NODE_CLOSED' }, { serviceDate: AT }), null);
  assert.equal(normalizeDisruption({ ...raw, effect: 'ROUTE_SUSPENDED', description: 'Mexico - San Fernando', latitude: 15.1, longitude: 120.7 }, { serviceDate: AT }), null);
  console.log('ok - loader query and in-memory gate require active, trusted, explicit, time-valid REAL disruptions');
  console.log('ok - names, descriptions and nearby coordinates cannot replace an explicit Route, Variant or TransportNode relation');
}

{
  const fixture = directFixture({ includeInbound: true });
  const outbound = fixture.variants[0];
  const inbound = fixture.variants[1];
  const routeId = outbound.route.documentId;
  const routeBlocked = graphAfter(fixture, [disruption('ROUTE_SUSPENDED', { routeId })]);
  assert.equal(routeBlocked.variants.size, 0);
  const exactBlocked = graphAfter(fixture, [disruption('VARIANT_SUSPENDED', { variantId: outbound.documentId })]);
  assert.equal(exactBlocked.variants.has(outbound.documentId), false);
  assert.equal(exactBlocked.variants.has(inbound.documentId), true);
  console.log('ok - route suspension blocks every variant while variant suspension blocks only the exact relation target');
}

{
  const fixture = directFixture();
  const baseVariant = fixture.variants[0];
  const alternativeRoute = route('ALTERNATIVE');
  const alternative = variant('ALTERNATIVE-OUT', 'OUTBOUND', alternativeRoute, [
    stop('ALTERNATIVE-OUT', fixture.nodes.A, 1, { dropoff_allowed: false }),
    stop('ALTERNATIVE-OUT', fixture.nodes.C, 2, { pickup_allowed: false }),
  ]);
  const input = { variants: [baseVariant, alternative] };
  const before = JSON.stringify(input);
  const constrained = applyDisruptionConstraints(input, [
    disruption('WARNING_ONLY', { routeId: baseVariant.route.documentId }, { id: 'weak-warning' }),
    disruption('VARIANT_SUSPENDED', { variantId: baseVariant.documentId }, { id: 'strong-block' }),
  ]);
  const graph = buildTransportGraph(constrained.graphData, { serviceDate: AT });
  const found = journeys(graph, fixture.nodes.A.documentId, fixture.nodes.C.documentId);
  assert.equal(found.length, 1);
  assert.equal(found[0].legs[0].routeVariantId, alternative.documentId);
  assert.equal(JSON.stringify(input), before);
  console.log('ok - a blocking effect wins over a warning, preserves a valid unaffected alternative, and never mutates transport truth');
}

{
  const fixture = throughRouteFixture();
  const [variant] = fixture.variants;
  const [first, middle, last] = [variant.route_variant_stops[0], variant.route_variant_stops[2], variant.route_variant_stops[4]];
  const closed = graphAfter(fixture, [disruption('NODE_CLOSED', { nodeId: middle.transport_node.documentId })]);
  assert.equal(journeys(closed, first.transport_node.documentId, middle.transport_node.documentId).length, 0);
  assert.equal(journeys(closed, middle.transport_node.documentId, last.transport_node.documentId).length, 0);
  assert.equal(journeys(closed, first.transport_node.documentId, last.transport_node.documentId).length, 1);

  const boarding = graphAfter(fixture, [disruption('BOARDING_CLOSED', { nodeId: middle.transport_node.documentId })]);
  assert.equal(journeys(boarding, middle.transport_node.documentId, last.transport_node.documentId).length, 0);
  assert.equal(journeys(boarding, first.transport_node.documentId, middle.transport_node.documentId).length, 1);
  const roleNodes = roleEligibleNodes(Object.values(fixture.nodes), boarding);
  assert.equal(roleNodes.access.some((node) => node.documentId === middle.transport_node.documentId), false);
  assert.equal(roleNodes.egress.some((node) => node.documentId === middle.transport_node.documentId), true);
  const alighting = graphAfter(fixture, [disruption('ALIGHTING_CLOSED', { nodeId: middle.transport_node.documentId })]);
  assert.equal(journeys(alighting, first.transport_node.documentId, middle.transport_node.documentId).length, 0);
  assert.equal(journeys(alighting, middle.transport_node.documentId, last.transport_node.documentId).length, 1);
  const alightingRoles = roleEligibleNodes(Object.values(fixture.nodes), alighting);
  assert.equal(alightingRoles.egress.some((node) => node.documentId === middle.transport_node.documentId), false);
  console.log('ok - node, boarding and alighting closures have distinct semantics and closed intermediate nodes remain traversable');
}

{
  const fixture = transferFixture();
  const transferNode = fixture.nodes.T.documentId;
  const baseline = graphAfter(fixture, []);
  assert.equal(journeys(baseline, fixture.nodes.A.documentId, fixture.nodes.D.documentId).length, 1);
  const blocked = graphAfter(fixture, [disruption('TRANSFER_BLOCKED', { nodeId: transferNode })]);
  assert.equal(journeys(blocked, fixture.nodes.A.documentId, fixture.nodes.D.documentId).length, 0);

  const through = throughRouteFixture();
  const via = through.variants[0].route_variant_stops[2].transport_node.documentId;
  const direct = graphAfter(through, [disruption('TRANSFER_BLOCKED', { nodeId: via })]);
  assert.equal(journeys(direct, through.nodes.X.documentId, through.nodes.Y.documentId).length, 1);
  console.log('ok - transfer blocks require an exact shared node and do not block direct pass-through rides');
}

{
  const fixture = directFixture();
  const graph = graphAfter(fixture, []);
  const journey = journeys(graph, fixture.nodes.A.documentId, fixture.nodes.C.documentId)[0];
  const routeId = fixture.variants[0].route.documentId;
  const warnings = [
    disruption('WARNING_ONLY', { routeId }, { id: 'warn-1', geometry: { type: 'Point', coordinates: [120.7, 15.1] } }),
    disruption('WARNING_ONLY', { routeId }, { id: 'warn-1' }),
    disruption('LIMITED_SERVICE', { variantId: fixture.variants[0].documentId }, { id: 'limited-1' }),
  ];
  const enriched = attachDisruptionWarnings(journey, warnings);
  assert.equal(enriched.warnings.length, 2);
  assert.deepEqual(enriched.warnings.map((item) => item.code), ['DISRUPTION_WARNING', 'LIMITED_SERVICE']);
  assert.equal(enriched.warnings[0].geometry.type, 'Point');
  assert.equal(enriched.legs[0].operatingStatus, journey.legs[0].operatingStatus);
  console.log('ok - advisory and limited-service warnings are structured, deduplicated and do not invent ETA or availability');
}

async function testOrchestratorBlockingStatus() {
  const fixture = directWalkingFixture();
  const request = validateTripPlanRequest({
    origin: fixture.origin,
    destination: fixture.destination,
    departureAt: AT.toISOString(),
    passengerCategory: 'REGULAR',
  }).value;
  const suspended = disruption('VARIANT_SUSPENDED', { variantId: fixture.variants[0].documentId });
  const result = await orchestrateTripPlan(request, {
    now: () => AT,
    services: {
      loadEligibleCoordinateNodes: async () => Object.values(fixture.nodes),
      loadEligibleTransportGraphData: async () => ({ variants: fixture.variants }),
      loadEligibleDisruptions: async () => [suspended],
    },
  });
  assert.equal(result.status, 'NO_TRANSPORT_JOURNEY');
  assert.ok(result.warnings.includes('NO_JOURNEY_DUE_TO_ACTIVE_DISRUPTION'));
  assert.deepEqual(result.journeys, []);
  console.log('ok - unified API returns an explicit no-journey disruption code when all eligible service is blocked');
}

async function testLoaderAndFailureHandling() {
  const trusted = {
    id: 'loaded-warning', title: 'Loaded advisory', severity: 'moderate', effect: 'WARNING_ONLY',
    starts_at: '2026-09-27T00:00:00.000Z', ends_at: null, disruption_status: 'active',
    resolved_at: null, ...evidence, geometry_source: 'UNKNOWN', geometry_geojson: null,
  };
  let captured;
  const loaded = await loadEligibleDisruptions({
    serviceDate: AT,
    strapiInstance: { documents: () => ({ findMany: async (query) => { captured = query; return [trusted, { ...trusted, id: 'research', verification_status: 'CORROBORATED_RESEARCH' }]; } }) },
  });
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, 'loaded-warning');
  assert.equal(captured.filters.data_mode, 'REAL');

  const handler = createTripPlanHandler({
    validate: () => ({ ok: true, value: {} }),
    orchestrate: async () => { throw new Error('database path and SQL must stay private'); },
  });
  const ctx = { state: { user: { id: 1, role: { name: 'Passenger' } } }, request: { body: {} } };
  await handler(ctx);
  assert.equal(ctx.status, 503);
  assert.deepEqual(ctx.body, { status: 'SERVICE_UNAVAILABLE', message: 'Trip planning is temporarily unavailable.' });
  assert.equal(JSON.stringify(ctx.body).includes('database path'), false);
  console.log('ok - eligible disruptions load once through strict filters and loader failure remains fail-closed and sanitized');
}

async function main() {
  await testLoaderAndFailureHandling();
  await testOrchestratorBlockingStatus();
}

main().catch((error) => {
  console.error(`FAIL: ${error.stack || error.message}`);
  process.exitCode = 1;
});
