'use strict';

const { buildTransportGraph } = require('./graph-builder');
const { planJourneys } = require('./journey-planner');
const { findAccessNodes, loadEligibleCoordinateNodes } = require('./access-node-finder');
const { mapWithConcurrency } = require('./access-node-finder');
const { loadEligibleTransportGraphData } = require('./transport-data-loader');
const { getDefaultWalkingRouter } = require('./walking-router');
const { composeWalkingJourneys } = require('./walking-journey-composer');
const { loadEligibleDisruptions } = require('./disruption-data-loader');
const { applyDisruptionConstraints, attachDisruptionWarnings } = require('./disruption-engine');
const { expansionSettings, filterExpansionGraphData } = require('./pilot-expansion');
const { walkingConfig: resolveWalkingConfig } = require('./walking-config');

function graphNodeId(graph, node) {
  for (const candidate of [node?.documentId, node?.document_id, node?.id, node?.node_code]) {
    if (candidate === null || candidate === undefined) continue;
    const resolved = graph?.resolveNodeId?.(candidate);
    if (resolved) return resolved;
  }
  return null;
}

function roleEligibleNodes(nodes, graph) {
  const egressIds = new Set();
  for (const edges of graph?.outgoing?.values?.() || []) {
    for (const edge of edges) egressIds.add(edge.alightStop.node.id);
  }
  const access = [];
  const egress = [];
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const nodeId = graphNodeId(graph, node);
    if (!nodeId) continue;
    if ((graph.outgoing.get(nodeId) || []).length > 0) access.push(node);
    if (egressIds.has(nodeId)) egress.push(node);
  }
  return { access, egress };
}

async function planJourneysWithWalkingCandidates({
  origin,
  destination,
  nodes = [],
  graph,
  router = getDefaultWalkingRouter(),
  config = {},
  maxTransfers = 1,
  transferConnections = [],
  signal,
  context,
  accessPreference = 'AUTO',
  maxPublicRides,
  allowInitialFeeder = false,
} = {}) {
  if (signal?.aborted) return Object.freeze({ accessCandidates: [], egressCandidates: [], journeys: [], failures: [{ code: 'ROUTING_CANCELLED' }] });
  const roleNodes = roleEligibleNodes(nodes, graph);
  const [access, egress] = await Promise.all([findAccessNodes({
    point: origin,
    nodes: roleNodes.access,
    direction: 'ACCESS',
    router,
    config,
    signal,
    context,
  }), findAccessNodes({ point: destination, nodes: roleNodes.egress, direction: 'EGRESS', router, config, signal, context })]);
  if (access.candidates.length === 0) {
    return Object.freeze({
      accessCandidates: access.candidates,
      egressCandidates: Object.freeze([]),
      failures: signal?.aborted
        ? Object.freeze([...access.failures, Object.freeze({ nodeId: null, code: 'ROUTING_CANCELLED' })])
        : access.failures,
      journeys: Object.freeze([]),
    });
  }
  const feederIds = new Set([...graph.variants.values()].filter(v => v.route.transportMode === 'TRICYCLE').flatMap(v => v.stops.filter(s => s.pickupAllowed).map(s => s.node.id)));
  // A point can serve both tricycles and jeepneys. Filter the first service,
  // rather than removing a shared boarding point for WALK_ONLY passengers.
  const eligibleAccess = access.candidates.filter(candidate => accessPreference !== 'FEEDER' || feederIds.has(candidate.node.nodeId));
  let transportJourneys = planJourneys(graph, {
    candidateBoardingNodeIds: eligibleAccess.map((candidate) => candidate.node.nodeId),
    candidateDestinationNodeIds: egress.candidates.map((candidate) => candidate.node.nodeId),
    maxTransfers,
    transferConnections,
    context,
    maxPublicRides,
    allowInitialFeeder,
  });
  if (accessPreference === 'FEEDER') transportJourneys = transportJourneys.filter(j => j.legs.find(l => l.type === 'TRANSIT')?.transportMode === 'TRICYCLE');
  if (accessPreference === 'WALK_ONLY') transportJourneys = transportJourneys.filter(j => j.legs.find(l => l.type === 'TRANSIT')?.transportMode !== 'TRICYCLE');
  if (context?.researchPreview) {
    const policy = resolveWalkingConfig(config);
    const walkingJourneys = transportJourneys.filter(j => j.legs.find(l => l.type === 'TRANSIT')?.transportMode !== 'TRICYCLE');
    const practicalWalk = walkingJourneys.some(j => {
      const first = j.legs.find(l => l.type === 'TRANSIT');
      const candidate = eligibleAccess.find(c => c.node.nodeId === first.boardAt.nodeId);
      return candidate && (candidate.walkingDistanceMeters ?? candidate.straightLineDistanceMeters) <= policy.preferredWalkMeters;
    });
    if (accessPreference === 'WALK_ONLY' || (accessPreference === 'AUTO' && practicalWalk && !context.minimizeWalking)) transportJourneys = walkingJourneys;
  }
  const transferWalks = new Map();
  const transferFailures = [];
  const needed = new Map(transportJourneys.flatMap(j => (j.transferConnections || []).filter(Boolean).map(c => [c.id, c])));
  // Only approved links actually used by eligible journeys generate provider calls.
  await mapWithConcurrency([...needed.values()], 2, async connection => {
    if (signal?.aborted) { transferFailures.push({ code: 'ROUTING_CANCELLED' }); return; }
    const from = graph.nodes.get(graph.resolveNodeId(connection.fromNodeCode));
    const to = graph.nodes.get(graph.resolveNodeId(connection.toNodeCode));
    if (!from || !to || ![from.lat, from.lng, to.lat, to.lng].every(Number.isFinite)) return;
    let result;
    try { result = await router.routeWalk({ from: { lat: from.lat, lng: from.lng, label: from.name }, to: { lat: to.lat, lng: to.lng, label: to.name }, signal }); }
    catch { result = { ok: false, error: { code: 'ROUTING_NETWORK_ERROR' } }; }
    if (!signal?.aborted && result?.ok && result.value?.geometry && Number.isFinite(result.value.distanceMeters)) transferWalks.set(connection.id, result.value);
    else transferFailures.push({ nodeId: from.id, connectionId: connection.id, code: result?.error?.code || 'TRANSFER_WALK_UNAVAILABLE' });
  });
  return Object.freeze({
    accessCandidates: access.candidates,
    egressCandidates: egress.candidates,
    failures: Object.freeze([...access.failures, ...egress.failures, ...transferFailures]),
    journeys: composeWalkingJourneys(transportJourneys, {
      accessCandidates: eligibleAccess,
      egressCandidates: egress.candidates,
      transferWalks,
    }),
  });
}

/**
 * Internal service-level orchestration only. No Phase 11 HTTP endpoint calls it.
 */
async function planVerifiedJourneysWithWalking({
  origin,
  destination,
  strapiInstance = global.strapi,
  serviceDate = new Date(),
  router = getDefaultWalkingRouter(),
  config = {},
  signal,
} = {}) {
  const [nodes, graphData, disruptions] = await Promise.all([
    loadEligibleCoordinateNodes({ strapiInstance }),
    loadEligibleTransportGraphData({ strapiInstance, demoMode: false, serviceDate }),
    loadEligibleDisruptions({ strapiInstance, serviceDate, allowSimulated: false }),
  ]);
  const settings = expansionSettings();
  const constrained = applyDisruptionConstraints(filterExpansionGraphData(graphData, settings), disruptions);
  const graph = buildTransportGraph(constrained.graphData, { demoMode: false, serviceDate });
  const result = await planJourneysWithWalkingCandidates({
    origin,
    destination,
    nodes,
    graph,
    router,
    config,
    maxTransfers: settings.maxTransfers,
    transferConnections: settings.connections,
    signal,
  });
  return Object.freeze({
    ...result,
    journeys: Object.freeze((result.journeys || []).map((journey) =>
      attachDisruptionWarnings(journey, disruptions))),
    disruptionImpact: constrained.impact,
  });
}

module.exports = {
  planJourneysWithWalkingCandidates,
  planVerifiedJourneysWithWalking,
  roleEligibleNodes,
};
