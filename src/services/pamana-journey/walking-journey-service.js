'use strict';

const { buildTransportGraph } = require('./graph-builder');
const { planJourneys } = require('./journey-planner');
const { findAccessNodes, loadEligibleCoordinateNodes } = require('./access-node-finder');
const { loadEligibleTransportGraphData } = require('./transport-data-loader');
const { createWalkingRouter } = require('./walking-router');
const { composeWalkingJourneys } = require('./walking-journey-composer');

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
  router = createWalkingRouter(),
  config = {},
  signal,
} = {}) {
  const roleNodes = roleEligibleNodes(nodes, graph);
  const access = await findAccessNodes({
    point: origin,
    nodes: roleNodes.access,
    direction: 'ACCESS',
    router,
    config,
    signal,
  });
  if (signal?.aborted || access.candidates.length === 0) {
    return Object.freeze({
      accessCandidates: access.candidates,
      egressCandidates: Object.freeze([]),
      failures: signal?.aborted
        ? Object.freeze([...access.failures, Object.freeze({ nodeId: null, code: 'ROUTING_CANCELLED' })])
        : access.failures,
      journeys: Object.freeze([]),
    });
  }
  const egress = await findAccessNodes({
    point: destination,
    nodes: roleNodes.egress,
    direction: 'EGRESS',
    router,
    config,
    signal,
  });
  const transportJourneys = planJourneys(graph, {
    candidateBoardingNodeIds: access.candidates.map((candidate) => candidate.node.nodeId),
    candidateDestinationNodeIds: egress.candidates.map((candidate) => candidate.node.nodeId),
  });
  return Object.freeze({
    accessCandidates: access.candidates,
    egressCandidates: egress.candidates,
    failures: Object.freeze([...access.failures, ...egress.failures]),
    journeys: composeWalkingJourneys(transportJourneys, {
      accessCandidates: access.candidates,
      egressCandidates: egress.candidates,
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
  router = createWalkingRouter(),
  config = {},
  signal,
} = {}) {
  const [nodes, graphData] = await Promise.all([
    loadEligibleCoordinateNodes({ strapiInstance }),
    loadEligibleTransportGraphData({ strapiInstance, demoMode: false, serviceDate }),
  ]);
  const graph = buildTransportGraph(graphData, { demoMode: false, serviceDate });
  return planJourneysWithWalkingCandidates({
    origin,
    destination,
    nodes,
    graph,
    router,
    config,
    signal,
  });
}

module.exports = {
  planJourneysWithWalkingCandidates,
  planVerifiedJourneysWithWalking,
};
