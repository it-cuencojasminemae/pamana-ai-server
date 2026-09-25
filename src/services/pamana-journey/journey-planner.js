'use strict';

const crypto = require('node:crypto');
const { canTransfer } = require('./transfer-detector');
const { LEG_TYPE, MAX_TRANSFERS } = require('./types');

const nodeReference = (node) => Object.freeze({
  nodeId: node.id,
  nodeCode: node.nodeCode,
  name: node.name,
});

function legFromEdge(edge, sequence) {
  return Object.freeze({
    sequence,
    type: LEG_TYPE.TRANSIT,
    transportMode: edge.variant.route.transportMode,
    routeId: edge.variant.route.id,
    routeCode: edge.variant.route.routeCode,
    routeVariantId: edge.variant.id,
    variantCode: edge.variant.variantCode,
    direction: edge.variant.direction,
    boardAt: nodeReference(edge.boardStop.node),
    alightAt: nodeReference(edge.alightStop.node),
    boardSequence: edge.boardStop.sequence,
    alightSequence: edge.alightStop.sequence,
    signboard: edge.variant.signboard,
    intermediateNodes: Object.freeze(edge.intermediateNodes.map(nodeReference)),
    verificationStatus: edge.variant.verificationStatus,
    dataMode: edge.variant.dataMode,
  });
}

function journeyIdentity(edges) {
  return edges.map((edge) => [
    edge.variant.id,
    edge.boardStop.node.id,
    edge.alightStop.node.id,
  ].join(':')).join('>');
}

function journeyFromEdges(edges) {
  const identity = journeyIdentity(edges);
  const legs = Object.freeze(edges.map((edge, index) => legFromEdge(edge, index + 1)));
  const modes = Object.freeze([...new Set(legs.map((leg) => leg.transportMode))]);
  const statuses = Object.freeze([...new Set(legs.map((leg) => leg.verificationStatus))]);
  const dataModes = Object.freeze([...new Set(legs.map((leg) => leg.dataMode))]);
  return Object.freeze({
    id: `journey-${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 16)}`,
    legs,
    transferCount: Math.max(0, legs.length - 1),
    modes,
    originNode: legs[0].boardAt,
    destinationNode: legs[legs.length - 1].alightAt,
    dataQuality: Object.freeze({
      planningEligible: true,
      verificationStatuses: statuses,
      dataModes,
    }),
    warnings: Object.freeze([]),
  });
}

const stableJourneyKey = (journey) => journey.legs.map((leg) => [
  leg.variantCode,
  leg.boardAt.nodeCode,
  leg.alightAt.nodeCode,
].join(':')).join('>');

function resolvedCandidateSet(graph, candidates) {
  const result = new Set();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const id = graph.resolveNodeId(candidate);
    if (id) result.add(id);
  }
  return result;
}

/**
 * Finds direct and one-transfer journeys only. Candidate nodes are supplied by
 * the caller; this service performs no geocoding, proximity search or walking.
 */
function planJourneys(graph, {
  candidateBoardingNodeIds = [],
  candidateDestinationNodeIds = [],
  maxTransfers = MAX_TRANSFERS,
} = {}) {
  if (!graph || maxTransfers < 0 || maxTransfers > MAX_TRANSFERS) return [];
  const origins = resolvedCandidateSet(graph, candidateBoardingNodeIds);
  const destinations = resolvedCandidateSet(graph, candidateDestinationNodeIds);
  if (!origins.size || !destinations.size) return [];

  const candidates = [];
  for (const origin of origins) {
    for (const firstEdge of graph.outgoing.get(origin) || []) {
      if (destinations.has(firstEdge.alightStop.node.id)) {
        candidates.push([firstEdge]);
      }
      if (maxTransfers === 0) continue;
      for (const secondEdge of graph.outgoing.get(firstEdge.alightStop.node.id) || []) {
        if (!destinations.has(secondEdge.alightStop.node.id)) continue;
        if (canTransfer(firstEdge, secondEdge)) candidates.push([firstEdge, secondEdge]);
      }
    }
  }

  const unique = new Map();
  for (const edges of candidates) {
    const key = journeyIdentity(edges);
    if (!unique.has(key)) unique.set(key, journeyFromEdges(edges));
  }
  return [...unique.values()].sort((first, second) =>
    first.transferCount - second.transferCount
    || first.legs.length - second.legs.length
    || stableJourneyKey(first).localeCompare(stableJourneyKey(second))
  );
}

module.exports = {
  journeyFromEdges,
  planJourneys,
};
