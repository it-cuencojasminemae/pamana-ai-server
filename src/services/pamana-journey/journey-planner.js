'use strict';

const crypto = require('node:crypto');
const { canTransfer } = require('./transfer-detector');
const { LEG_TYPE, MAX_TRANSFERS } = require('./types');
const { distanceForEdge } = require('./route-distance');
const { countVehicleTransfers } = require('./transfer-count');
const { boardingGuidance } = require('./pilot-expansion');

const nodeReference = (node) => Object.freeze({
  nodeId: node.id,
  nodeCode: node.nodeCode,
  name: node.name,
  nodeType: node.nodeType,
  ...(Number.isFinite(node.lat) && Number.isFinite(node.lng)
    ? { lat: node.lat, lng: node.lng } : {}),
  ...(node.connector ? { connector: node.connector } : {}),
});

function legFromEdge(edge, sequence) {
  const distance = distanceForEdge(edge);
  return Object.freeze({
    sequence,
    type: LEG_TYPE.TRANSIT,
    transportMode: edge.variant.route.transportMode,
    routeId: edge.variant.route.id,
    routeCode: edge.variant.route.routeCode,
    routeVariantId: edge.variant.id,
    variantCode: edge.variant.variantCode,
    direction: edge.variant.direction,
    operatingStatus: edge.variant.operatingStatus,
    boardAt: nodeReference(edge.boardStop.node),
    alightAt: nodeReference(edge.alightStop.node),
    boardSequence: edge.boardStop.sequence,
    alightSequence: edge.alightStop.sequence,
    segmentDistanceMeters: distance.meters,
    roadDistanceSource: distance.source,
    signboard: edge.variant.signboard,
    ...boardingGuidance(edge.variant.variantCode),
    ...(edge.boardStop.instructionTemplate ? { boardingInstructions: [...(boardingGuidance(edge.variant.variantCode).boardingInstructions || []), edge.boardStop.instructionTemplate] } : {}),
    intermediateNodes: Object.freeze(edge.intermediateNodes.map(nodeReference)),
    verificationStatus: edge.variant.verificationStatus,
    dataMode: edge.variant.dataMode,
    evidenceClass: [edge.boardStop.node, edge.alightStop.node].some(node => node.connector?.evidenceClass === 'LOCAL_RESEARCH')
      ? 'USER_REPORTED' : edge.variant.evidenceClass,
    ...(edge.variant.geometrySource === 'RESEARCH_PREVIEW' ? { geometrySource: 'RESEARCH_PREVIEW' } : {}),
    ...(edge.variant.signboardAliases?.length ? { signboardAliases: edge.variant.signboardAliases } : {}),
    ...(edge.variant.boardingInstructions?.length ? { boardingInstructions: [...edge.variant.boardingInstructions, ...(edge.boardStop.instructionTemplate ? [edge.boardStop.instructionTemplate] : [])] } : {}),
    ...(edge.variant.geometry ? { rideGeometry: require('./corridor-connectors').sliceLine(edge.variant.geometry.type === 'MultiLineString' ? edge.variant.geometry.coordinates.flat() : edge.variant.geometry.coordinates,
      edge.boardStop.geometryOffsetMeters, edge.alightStop.geometryOffsetMeters) } : {}),
  });
}

function journeyIdentity(edges) {
  return edges.map((edge) => [
    edge.variant.id,
    edge.boardStop.node.id,
    edge.alightStop.node.id,
  ].join(':')).join('>');
}

function journeyFromEdges(edges, connections = []) {
  const identity = journeyIdentity(edges) + connections.map((c, index) => c ? `|${index}:${c.id}` : '').join('');
  const legs = Object.freeze(edges.map((edge, index) => legFromEdge(edge, index + 1)));
  const modes = Object.freeze([...new Set(legs.map((leg) => leg.transportMode))]);
  const statuses = Object.freeze([...new Set(legs.map((leg) => leg.verificationStatus))]);
  const dataModes = Object.freeze([...new Set(legs.map((leg) => leg.dataMode))]);
  return Object.freeze({
    id: `journey-${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 16)}`,
    legs,
    ...(connections.some(Boolean) ? { transferConnections: Object.freeze(connections) } : {}),
    transferCount: countVehicleTransfers(legs),
    modes,
    originNode: legs[0].boardAt,
    destinationNode: legs[legs.length - 1].alightAt,
    dataQuality: Object.freeze({
      planningEligible: true,
      verificationStatuses: statuses,
      dataModes,
      ...(legs.some(leg => leg.evidenceClass === 'USER_REPORTED') ? { evidenceClass: 'LOCAL_RESEARCH', researchPreview: true } : {}),
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
 * Bounded forward-only search, with explicit directed pedestrian connections.
 * Candidate nodes are supplied by
 * the caller; this service performs no geocoding, proximity search or walking.
 */
function planJourneys(graph, {
  candidateBoardingNodeIds = [],
  candidateDestinationNodeIds = [],
  maxTransfers = 1,
  transferConnections = [],
  context,
  maxPublicRides = maxTransfers + 1,
  allowInitialFeeder = false,
} = {}) {
  if (!graph || !Number.isInteger(maxTransfers) || maxTransfers < 0 || maxTransfers > MAX_TRANSFERS) return [];
  const origins = resolvedCandidateSet(graph, candidateBoardingNodeIds);
  const destinations = resolvedCandidateSet(graph, candidateDestinationNodeIds);
  if (!origins.size || !destinations.size) return [];

  const candidates = [];
  function visit(edges, links, seenNodes, seenVariants) {
    const last = edges[edges.length - 1];
    const at = last.alightStop.node.id;
    if (destinations.has(at)) candidates.push({ edges, links });
    const feederCount = edges.filter(edge => edge.variant.route.transportMode === 'TRICYCLE').length;
    const publicCount = edges.length - feederCount;
    if (publicCount >= maxPublicRides || edges.length >= maxPublicRides + (allowInitialFeeder ? 1 : 0)) return;
    const nextBoards = [{ nodeId: at, connection: null }];
    for (const connection of transferConnections) {
      if (!(connection.status === 'VERIFIED' || (context?.researchPreview && connection.status === 'RESEARCH_PREVIEW')) || connection.fromNodeCode !== last.alightStop.node.nodeCode || !last.alightStop.transferAllowed) continue;
      const target = graph.resolveNodeId(connection.toNodeCode);
      if (target && target !== at && !seenNodes.has(target)) nextBoards.push({ nodeId: target, connection });
    }
    for (const next of nextBoards) for (const edge of graph.outgoing.get(next.nodeId) || []) {
      if (seenVariants.has(edge.variant.id) || seenNodes.has(edge.alightStop.node.id)) continue;
      if (allowInitialFeeder && edge.variant.route.transportMode === 'TRICYCLE') continue;
      if (next.connection ? !edge.boardStop.transferAllowed : !canTransfer(last, edge)) continue;
      visit([...edges, edge], [...links, next.connection], new Set([...seenNodes, next.nodeId, edge.alightStop.node.id]), new Set([...seenVariants, edge.variant.id]));
    }
  }
  for (const origin of origins) for (const edge of graph.outgoing.get(origin) || []) {
    if (edge.alightStop.node.id !== origin) visit([edge], [], new Set([origin, edge.alightStop.node.id]), new Set([edge.variant.id]));
  }

  const unique = new Map();
  for (const { edges, links } of candidates) {
    const journey = journeyFromEdges(edges, links);
    if (!unique.has(journey.id)) unique.set(journey.id, journey);
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
