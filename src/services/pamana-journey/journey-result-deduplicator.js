'use strict';

// Compare the journey actually used by the passenger, not unused variant
// termini. Missing ride geometry must never establish cross-variant equality.
function resultKey(journey, { accessAlternatives = false } = {}) {
  const firstRide = journey.legs.find(leg => leg.type === 'TRANSIT');
  const legs = journey.legs.filter(leg => !accessAlternatives || leg.type !== 'WALK' || leg.purpose !== 'ACCESS').map(leg => {
    if (leg.type === 'TRANSIT') {
      const { variant, service, ...rest } = leg;
      const { appliedPatternId, ...serviceFacts } = service || {};
      if (accessAlternatives && leg === firstRide) {
        const { boardAt, geometry, segmentDistanceMeters, roadDistanceSource, durationSeconds, intermediateNodes, boardingInstructions, evidenceClass, ...facts } = rest;
        return { ...facts, variant, service: serviceFacts };
      }
      return { ...rest, service: serviceFacts,
        ...(leg.geometry && (leg.route?.id || leg.route?.code) ? {} : { variant }) };
    }
    if (leg.type === 'TRANSFER') {
      const { fromRouteVariantId, fromVariantCode, toRouteVariantId, toVariantCode, ...rest } = leg;
      return rest;
    }
    const { calculatedAt, ...rest } = leg;
    return rest;
  }).map((leg, index) => ({ ...leg, sequence: index + 1 }));
  // Object property order is not a passenger-visible difference. Coordinate
  // rounding removes sub-centimetre slicing noise on a shared corridor.
  function canonical(value, key = '') {
    if (Array.isArray(value)) return value.map(item => canonical(item, key));
    if (value && typeof value === 'object') {
      if (value.connector?.temporary && Number.isFinite(value.lat) && Number.isFinite(value.lng)) {
        // Request-local connector IDs include the variant/section ID, even
        // when both variants project to exactly the same boarding/drop-off.
        const { nodeId, nodeCode, connector, ...point } = value;
        const { sectionId, variantCode, offsetMeters, ...permission } = connector;
        value = { ...point, connector: permission };
      }
      return Object.fromEntries(Object.keys(value).sort().map(name => [name, canonical(value[name], name)]));
    }
    return key === 'coordinates' && Number.isFinite(value) ? Number(value.toFixed(7)) : value;
  }
  return JSON.stringify(canonical({ legs, transferCount: journey.transferCount,
    fareSummary: journey.fareSummary, availabilitySummary: journey.availabilitySummary,
    ...(!accessAlternatives ? { durationSummary: journey.durationSummary, dataQuality: journey.dataQuality }
      : { dataQuality: { planningEligible: journey.dataQuality.planningEligible,
        verificationStatuses: journey.dataQuality.verificationStatuses, dataModes: journey.dataQuality.dataModes } }),
    warnings: journey.warnings }));
}

function distinctJourneyResults(journeys) {
  const unique = new Map();
  for (const journey of journeys) {
    const key = resultKey(journey);
    if (!unique.has(key)) unique.set(key, journey);
  }
  return [...unique.values()];
}

module.exports = { distinctJourneyResults, resultKey };
