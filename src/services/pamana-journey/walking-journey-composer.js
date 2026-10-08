'use strict';

const { LEG_TYPE } = require('./types');
const { countVehicleTransfers } = require('./transfer-count');

function candidateByNode(candidates) {
  const result = new Map();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const nodeId = candidate?.node?.nodeId;
    if (!nodeId) continue;
    const existing = result.get(nodeId);
    const candidateDistance = candidate.walkingDistanceMeters ?? candidate.straightLineDistanceMeters;
    const existingDistance = existing
      ? (existing.walkingDistanceMeters ?? existing.straightLineDistanceMeters)
      : Number.POSITIVE_INFINITY;
    if (!existing || candidateDistance < existingDistance) result.set(nodeId, candidate);
  }
  return result;
}

function transferLeg(first, second, connection) {
  return Object.freeze({
    type: LEG_TYPE.TRANSFER,
    at: first.alightAt,
    ...(connection ? { to: second.boardAt, connectionId: connection.id } : {}),
    fromRouteVariantId: first.routeVariantId,
    fromVariantCode: first.variantCode,
    toRouteVariantId: second.routeVariantId,
    toVariantCode: second.variantCode,
  });
}

function sequenceLegs(accessCandidate, transitLegs, egressCandidate, connections = [], transferWalks = new Map()) {
  const ordered = [];
  if (accessCandidate.walkingLeg) ordered.push({ ...accessCandidate.walkingLeg, purpose: 'ACCESS' });
  transitLegs.forEach((leg, index) => {
    ordered.push(leg);
    if (index < transitLegs.length - 1) {
      const connection = connections[index];
      ordered.push(transferLeg(leg, transitLegs[index + 1], connection));
      if (connection) ordered.push({ ...transferWalks.get(connection.id), purpose: 'TRANSFER', connectionId: connection.id });
    }
  });
  if (egressCandidate.walkingLeg) ordered.push({ ...egressCandidate.walkingLeg, purpose: 'EGRESS' });
  return Object.freeze(ordered.map((leg, index) => Object.freeze({ ...leg, sequence: index + 1 })));
}

function composeWalkingJourneys(transportJourneys, {
  accessCandidates = [],
  egressCandidates = [],
  transferWalks = new Map(),
} = {}) {
  const accessByNode = candidateByNode(accessCandidates);
  const egressByNode = candidateByNode(egressCandidates);
  const journeys = [];
  for (const journey of Array.isArray(transportJourneys) ? transportJourneys : []) {
    const access = accessByNode.get(journey?.originNode?.nodeId);
    const egress = egressByNode.get(journey?.destinationNode?.nodeId);
    if (!access || !egress) continue;
    const connections = journey.transferConnections || [];
    if (connections.some(connection => connection && !transferWalks.has(connection.id))) continue;
    const legs = sequenceLegs(access, journey.legs, egress, connections, transferWalks);
    journeys.push(Object.freeze({
      ...journey,
      legs,
      transferCount: countVehicleTransfers(legs),
      access: Object.freeze({
        node: access.node,
        walkingDistanceMeters: access.walkingDistanceMeters,
        walkingDurationSeconds: access.walkingDurationSeconds,
        withinProximityThreshold: access.withinProximityThreshold,
      }),
      egress: Object.freeze({
        node: egress.node,
        walkingDistanceMeters: egress.walkingDistanceMeters,
        walkingDurationSeconds: egress.walkingDurationSeconds,
        withinProximityThreshold: egress.withinProximityThreshold,
      }),
    }));
  }
  return Object.freeze(journeys);
}

module.exports = {
  composeWalkingJourneys,
  sequenceLegs,
};
