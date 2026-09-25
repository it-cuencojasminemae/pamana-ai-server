'use strict';

const assert = require('node:assert/strict');
const {
  buildTransportGraph,
  routeVariantPlanningEligibilityFor,
} = require('../src/services/pamana-journey/graph-builder');
const { planJourneys } = require('../src/services/pamana-journey/journey-planner');
const {
  loadEligibleTransportGraphData,
  transportGraphQuery,
} = require('../src/services/pamana-journey/transport-data-loader');
const { TRANSPORT_MODES } = require('../src/services/pamana-journey/types');
const { planVerifiedTransportJourneys } = require('../src/services/pamana-journey');
const {
  directFixture,
  evidence,
  node,
  route,
  simulatedFixture,
  stop,
  throughRouteFixture,
  transferFixture,
  variant,
} = require('./fixtures/phase10-synthetic-network');

function plan(data, origin, destination, options = {}) {
  const graph = buildTransportGraph(data, options);
  return {
    graph,
    journeys: planJourneys(graph, {
      candidateBoardingNodeIds: [origin],
      candidateDestinationNodeIds: [destination],
    }),
  };
}

{
  const fixture = directFixture();
  const { graph, journeys } = plan(fixture, fixture.nodes.A.id, fixture.nodes.C.id);
  assert.equal(graph.variants.size, 1);
  assert.equal(graph.nodes.size, 3);
  assert.equal(journeys.length, 1);
  assert.equal(journeys[0].transferCount, 0);
  assert.deepEqual(journeys[0].legs.map((leg) => leg.variantCode), ['DIRECT-OUT']);
  assert.deepEqual(journeys[0].legs[0].intermediateNodes.map((item) => item.nodeCode), ['B']);
  assert.deepEqual([journeys[0].legs[0].boardSequence, journeys[0].legs[0].alightSequence], [1, 3]);
  assert.equal(planJourneys(graph, { candidateBoardingNodeIds: ['B'], candidateDestinationNodeIds: ['C'] }).length, 0, 'pickup permission is mandatory');
  assert.equal(planJourneys(graph, { candidateBoardingNodeIds: ['A'], candidateDestinationNodeIds: ['B'] }).length, 0, 'drop-off permission is mandatory');
  assert.equal(plan(fixture, fixture.nodes.C.id, fixture.nodes.A.id).journeys.length, 0, 'outbound sequence is never reversed');
  const unsorted = structuredClone(fixture);
  unsorted.variants[0].route_variant_stops.reverse();
  assert.deepEqual(
    plan(unsorted, unsorted.nodes.A.id, unsorted.nodes.C.id).journeys[0].legs[0].intermediateNodes.map((item) => item.nodeCode),
    ['B'],
    'stored sequence values, not population order, define travel order'
  );
  const duplicateSequence = structuredClone(fixture.variants[0]);
  duplicateSequence.route_variant_stops[1].sequence = 1;
  assert.equal(routeVariantPlanningEligibilityFor(duplicateSequence).eligible, false);
  console.log('ok - graph creates forward ride edges with stop permissions and a direct segment');
}

{
  const fixture = directFixture({ includeInbound: true });
  const { journeys } = plan(fixture, fixture.nodes.C.node_code, fixture.nodes.A.documentId);
  assert.equal(journeys.length, 1);
  assert.equal(journeys[0].legs[0].variantCode, 'DIRECT-IN');
  assert.equal(journeys[0].legs[0].direction, 'INBOUND');
  console.log('ok - reverse travel requires its own inbound RouteVariant');
}

{
  const fixture = throughRouteFixture();
  const { journeys } = plan(fixture, fixture.nodes.A.id, fixture.nodes.C.id);
  assert.equal(journeys.length, 1);
  const [leg] = journeys[0].legs;
  assert.equal(leg.boardAt.nodeCode, 'THROUGH-A');
  assert.equal(leg.alightAt.nodeCode, 'THROUGH-C');
  assert.deepEqual(leg.intermediateNodes.map((item) => item.nodeCode), ['THROUGH-B']);
  assert.deepEqual([leg.boardSequence, leg.alightSequence], [2, 4]);
  console.log('ok - through-route planning uses only the applicable ordered segment');
}

{
  const fixture = transferFixture();
  const { journeys } = plan(fixture, fixture.nodes.A.id, fixture.nodes.D.id);
  assert.equal(journeys.length, 1);
  assert.equal(journeys[0].transferCount, 1);
  assert.deepEqual(journeys[0].modes, ['TRICYCLE', 'PUJ_TRADITIONAL']);
  assert.deepEqual(journeys[0].legs.map((leg) => leg.variantCode), ['LOCAL-OUT', 'TRUNK-OUT']);
  assert.equal(journeys[0].legs[0].alightAt.nodeId, journeys[0].legs[1].boardAt.nodeId);
  assert.equal(planJourneys(buildTransportGraph(fixture), {
    candidateBoardingNodeIds: [fixture.nodes.A.id],
    candidateDestinationNodeIds: [fixture.nodes.D.id],
    maxTransfers: 0,
  }).length, 0);

  const lookalike = node('LOOKALIKE', { name: fixture.nodes.T.name });
  const broken = structuredClone(fixture);
  broken.variants[1].route_variant_stops[0].transport_node = lookalike;
  assert.equal(plan(broken, broken.nodes.A.id, broken.nodes.D.id).journeys.length, 0, 'matching names cannot create transfers');
  broken.variants[1].route_variant_stops[0].transport_node = broken.nodes.T;
  broken.variants[1].route_variant_stops[0].transfer_allowed = false;
  assert.equal(plan(broken, broken.nodes.A.id, broken.nodes.D.id).journeys.length, 0, 'transfer permission is mandatory');

  const directRoute = route('TRANSFER-DIRECT', 'BUS');
  const directVariant = variant('TRANSFER-DIRECT-OUT', 'OUTBOUND', directRoute, [
    stop('TRANSFER-DIRECT-OUT', fixture.nodes.A, 1),
    stop('TRANSFER-DIRECT-OUT', fixture.nodes.D, 2),
  ]);
  const ordered = plan({ variants: [...fixture.variants, directVariant] }, fixture.nodes.A.id, fixture.nodes.D.id).journeys;
  assert.deepEqual(ordered.map((journey) => journey.transferCount), [0, 1], 'structural ordering prefers fewer transfers');
  console.log('ok - one transfer uses one exact shared node and explicit permissions, never name matching');
}

{
  const fixture = directFixture();
  const duplicateGraph = buildTransportGraph({ variants: [fixture.variants[0], structuredClone(fixture.variants[0])] });
  const journeys = planJourneys(duplicateGraph, {
    candidateBoardingNodeIds: [fixture.nodes.A.id],
    candidateDestinationNodeIds: [fixture.nodes.C.id],
  });
  assert.equal(duplicateGraph.variants.size, 1);
  assert.equal(journeys.length, 1);
  assert.equal(journeys[0].id, planJourneys(duplicateGraph, {
    candidateBoardingNodeIds: [fixture.nodes.A.id], candidateDestinationNodeIds: [fixture.nodes.C.id],
  })[0].id, 'journey IDs are deterministic');
  console.log('ok - duplicate variants and journeys collapse to one deterministic result');
}

{
  const base = directFixture();
  const research = structuredClone(base.variants[0]);
  research.id = research.documentId = 'variant-research';
  research.variant_code = 'RCH-TEST';
  research.planning_enabled = false;
  research.verification_status = 'CORROBORATED_RESEARCH';
  const historical = structuredClone(base.variants[0]);
  historical.id = historical.documentId = 'variant-historical';
  historical.variant_code = 'HISTORICAL-TEST';
  historical.verification_status = 'HISTORICAL_UNVERIFIED';
  const inactive = structuredClone(base.variants[0]);
  inactive.id = inactive.documentId = 'variant-inactive'; inactive.variant_code = 'INACTIVE'; inactive.operating_status = 'INACTIVE';
  const suspended = structuredClone(base.variants[0]);
  suspended.id = suspended.documentId = 'variant-suspended'; suspended.variant_code = 'SUSPENDED'; suspended.operating_status = 'SUSPENDED';
  const unknown = structuredClone(base.variants[0]);
  unknown.id = unknown.documentId = 'variant-unknown'; unknown.variant_code = 'UNKNOWN'; unknown.operating_status = 'UNKNOWN';
  const future = structuredClone(base.variants[0]);
  future.id = future.documentId = 'variant-future'; future.variant_code = 'FUTURE'; future.effective_from = '2030-01-01';
  const inactiveRoute = structuredClone(base.variants[0]);
  inactiveRoute.id = inactiveRoute.documentId = 'variant-inactive-route'; inactiveRoute.variant_code = 'INACTIVE-ROUTE';
  inactiveRoute.route.active = false; inactiveRoute.route.route_status = 'inactive';
  const untrustedNode = structuredClone(base.variants[0]);
  untrustedNode.id = untrustedNode.documentId = 'variant-untrusted-node'; untrustedNode.variant_code = 'UNTRUSTED-NODE';
  untrustedNode.route_variant_stops[1].transport_node.planning_enabled = false;
  untrustedNode.route_variant_stops[1].transport_node.verification_status = 'RESEARCH_CANDIDATE';
  const graph = buildTransportGraph({ variants: [research, historical, inactive, suspended, unknown, future, inactiveRoute, untrustedNode] }, { serviceDate: new Date('2026-09-25T00:00:00Z') });
  assert.equal(graph.variants.size, 0);
  assert.equal(graph.excludedVariants.length, 8);
  assert.ok(graph.excludedVariants.find((item) => item.id === 'variant-research').reasons.includes('VARIANT_PLANNING_DISABLED'));
  assert.ok(graph.excludedVariants.find((item) => item.id === 'variant-unknown').reasons.includes('VARIANT_NOT_OPERATING'));
  assert.ok(graph.excludedVariants.find((item) => item.id === 'variant-inactive-route').reasons.includes('ROUTE_NOT_ACTIVE'));
  assert.ok(graph.excludedVariants.find((item) => item.id === 'variant-untrusted-node').reasons.some((reason) => reason.includes('NODE_PLANNING_DISABLED')));
  const limited = structuredClone(base.variants[0]);
  limited.operating_status = 'LIMITED';
  assert.equal(routeVariantPlanningEligibilityFor(limited).eligible, true);
  console.log('ok - research, historical, inactive, suspended, unknown and out-of-date variants are excluded');
}

{
  const fixture = simulatedFixture();
  assert.equal(buildTransportGraph(fixture).variants.size, 0);
  const graph = buildTransportGraph(fixture, { demoMode: true });
  assert.equal(graph.variants.size, 1);
  const journeys = planJourneys(graph, {
    candidateBoardingNodeIds: [fixture.nodes.A.id],
    candidateDestinationNodeIds: [fixture.nodes.B.id],
  });
  assert.equal(journeys.length, 1);
  assert.deepEqual(journeys[0].dataQuality.dataModes, ['SIMULATED']);
  console.log('ok - simulated service is excluded normally and requires explicit demo mode');
}

{
  assert.deepEqual(TRANSPORT_MODES, [
    'PUJ_TRADITIONAL', 'PUJ_MODERN', 'TRICYCLE', 'BUS', 'UV_EXPRESS', 'EMERGENCY_SERVICE',
  ]);
  const fixture = directFixture();
  const journey = plan(fixture, fixture.nodes.A.id, fixture.nodes.C.id).journeys[0];
  const serialized = JSON.stringify(journey);
  for (const forbidden of ['fare', 'wait', 'eta', 'duration', 'geometry', 'polyline']) {
    assert.equal(serialized.toLowerCase().includes(forbidden), false, `${forbidden} must not be invented`);
  }
  assert.equal(journey.legs[0].signboard, 'Signboard DIRECT-OUT');
  assert.equal(journey.warnings.length, 0);
  const noSignboard = structuredClone(fixture);
  noSignboard.variants[0].signboard_text = null;
  noSignboard.variants[0].route.estimated_travel_time = null;
  const unknownTimeLeg = plan(noSignboard, noSignboard.nodes.A.id, noSignboard.nodes.C.id).journeys[0].legs[0];
  assert.equal(unknownTimeLeg.signboard, null);
  assert.equal(Object.hasOwn(unknownTimeLeg, 'duration'), false);
  console.log('ok - provider-neutral legs omit fare, wait, ETA, duration and geometry');
}

async function testLoader() {
  const fixture = directFixture();
  const leakedResearch = structuredClone(fixture.variants[0]);
  leakedResearch.id = leakedResearch.documentId = 'leaked-research';
  leakedResearch.planning_enabled = false;
  leakedResearch.verification_status = 'CORROBORATED_RESEARCH';
  let uid;
  let query;
  const strapiInstance = { documents(value) {
    uid = value;
    return { findMany: async (valueQuery) => { query = valueQuery; return [fixture.variants[0], leakedResearch]; } };
  } };
  const result = await loadEligibleTransportGraphData({ strapiInstance, serviceDate: new Date('2026-09-25T00:00:00Z') });
  assert.equal(uid, 'api::route-variant.route-variant');
  assert.equal(query.filters.planning_enabled, true);
  assert.deepEqual(query.filters.operating_status.$in, ['ACTIVE', 'LIMITED']);
  assert.equal(query.filters.route.route_status, 'active');
  assert.equal(query.filters.route.active, true);
  assert.equal(query.filters.data_mode, 'REAL');
  assert.equal(result.variants.length, 1, 'defense-in-depth removes leaked research records');
  const demoQuery = transportGraphQuery({ demoMode: true });
  assert.deepEqual(demoQuery.filters.data_mode.$in, ['REAL', 'SIMULATED']);
  assert.ok(demoQuery.filters.verification_status.$in.includes('SIMULATED_DEMO'));
  assert.equal(JSON.stringify(query).includes('base_fare'), false);
  const planned = await planVerifiedTransportJourneys({
    strapiInstance,
    serviceDate: new Date('2026-09-25T00:00:00Z'),
    candidateBoardingNodeIds: [fixture.nodes.A.id],
    candidateDestinationNodeIds: [fixture.nodes.C.id],
  });
  assert.equal(planned.length, 1);
  assert.equal(planned[0].legs[0].variantCode, 'DIRECT-OUT');
  console.log('ok - loader queries only required planning fields and reapplies shared eligibility');
}

testLoader().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
