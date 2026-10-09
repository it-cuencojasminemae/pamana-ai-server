'use strict';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .map(key => [key, canonical(value[key])]));
  return value;
}

function nodeKey(node) {
  if (!node) return null;
  if (node.connector?.temporary) {
    const { offsetMeters, variantCode, ...permission } = node.connector;
    // Only generator-declared alternatives share a group. Otherwise require
    // the same physical position; proximity alone cannot establish equality.
    return { connector: permission, ...(permission.candidateGroupId ? {} : {
      lat: Number(node.lat?.toFixed(7)), lng: Number(node.lng?.toFixed(7)),
    }) };
  }
  return { id: node.nodeId || node.nodeCode || null, code: node.nodeCode || null,
    lat: node.lat, lng: node.lng, nodeType: node.nodeType };
}

function accessibilityFacts(value) {
  return Object.fromEntries(Object.entries(value || {}).filter(([key]) =>
    /accessib|wheelchair|stepFree|stairs|boardingSide|permission|restriction/i.test(key)));
}

// Stable transport identity, ordered vehicle changes, and passenger constraints.
// Walking distance/time, provider timestamps and generated IDs are not routes.
function resultKey(journey) {
  const legs = (journey.legs || []).filter(leg => leg.type !== 'WALK').map(leg => {
    if (leg.type === 'TRANSIT') {
      const { sequence, boardAt, alightAt, intermediateNodes, geometry, rideGeometry,
        boardSequence, alightSequence, segmentDistanceMeters, roadDistanceSource,
        durationSeconds, simulatedDurationSeconds, service, availability, ...facts } = leg;
      const { appliedPatternId, ...serviceFacts } = service || {};
      const { dataFreshness, ...availabilityFacts } = availability || {};
      const grouped = boardAt?.connector?.candidateGroupId || alightAt?.connector?.candidateGroupId;
      return { ...facts, boardAt: nodeKey(boardAt), alightAt: nodeKey(alightAt),
        intermediateNodes: (intermediateNodes || []).filter(node => !node.connector?.temporary).map(nodeKey),
        ...(!grouped ? { geometry: geometry || rideGeometry || null } : {}),
        service: serviceFacts, availability: availabilityFacts };
    }
    const { sequence, at, to, ...facts } = leg;
    return { ...facts, at: nodeKey(at), to: nodeKey(to) };
  });
  const walkingConstraints = (journey.legs || []).filter(leg => leg.type === 'WALK')
    .map(leg => ({ purpose: leg.purpose, connectionId: leg.connectionId,
      ...accessibilityFacts(leg) }))
    .filter(leg => leg.purpose === 'TRANSFER' || Object.keys(leg).length > 2);
  return JSON.stringify(canonical({ legs, walkingConstraints,
    accessibility: accessibilityFacts(journey), transferCount: journey.transferCount,
    transferConnections: journey.transferConnections,
    fareSummary: journey.fareSummary, dataQuality: journey.dataQuality, warnings: journey.warnings }));
}

function walkingCost(journey, metric) {
  return (journey.legs || []).filter(leg => leg.type === 'WALK')
    .reduce((sum, leg) => sum + (Number.isFinite(leg[metric]) && leg[metric] >= 0 ? leg[metric] : Infinity), 0);
}

function distinctJourneyResults(journeys) {
  const unique = new Map();
  for (const journey of journeys) {
    const key = resultKey(journey);
    const current = unique.get(key);
    if (!current || walkingCost(journey, 'distanceMeters') < walkingCost(current, 'distanceMeters')
      || (walkingCost(journey, 'distanceMeters') === walkingCost(current, 'distanceMeters')
        && walkingCost(journey, 'durationSeconds') < walkingCost(current, 'durationSeconds'))) {
      unique.set(key, journey);
    }
  }
  // Retain the complete representative, including its ID and map geometry.
  return [...unique.values()];
}

module.exports = { distinctJourneyResults, resultKey };
