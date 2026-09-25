'use strict';

const { LEG_TYPE } = require('./types');

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

function transferLeg(first, second) {
  return Object.freeze({
    type: LEG_TYPE.TRANSFER,
    at: first.alightAt,
    fromRouteVariantId: first.routeVariantId,
    fromVariantCode: first.variantCode,
    toRouteVariantId: second.routeVariantId,
    toVariantCode: second.variantCode,
  });
}

function sequenceLegs(accessCandidate, transitLegs, egressCandidate) {
  const ordered = [];
  if (accessCandidate.walkingLeg) ordered.push(accessCandidate.walkingLeg);
  transitLegs.forEach((leg, index) => {
    ordered.push(leg);
    if (index < transitLegs.length - 1) ordered.push(transferLeg(leg, transitLegs[index + 1]));
  });
  if (egressCandidate.walkingLeg) ordered.push(egressCandidate.walkingLeg);
  return Object.freeze(ordered.map((leg, index) => Object.freeze({ ...leg, sequence: index + 1 })));
}

function composeWalkingJourneys(transportJourneys, {
  accessCandidates = [],
  egressCandidates = [],
} = {}) {
  const accessByNode = candidateByNode(accessCandidates);
  const egressByNode = candidateByNode(egressCandidates);
  const journeys = [];
  for (const journey of Array.isArray(transportJourneys) ? transportJourneys : []) {
    const access = accessByNode.get(journey?.originNode?.nodeId);
    const egress = egressByNode.get(journey?.destinationNode?.nodeId);
    if (!access || !egress) continue;
    journeys.push(Object.freeze({
      ...journey,
      legs: sequenceLegs(access, journey.legs, egress),
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
