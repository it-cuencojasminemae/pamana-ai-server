'use strict';

// Presentation classifications for the returned set. Preserve planner order,
// fares and eligibility; ties always use the planner's deterministic order.
function validOption(journey, { context } = {}) {
  const transit = (journey?.legs || []).filter(leg => leg.type === 'TRANSIT');
  return journey?.dataQuality?.planningEligible === true
    && journey.dataQuality.dataModes.length > 0
    && journey.dataQuality.dataModes.every(mode => mode === 'REAL')
    && (!journey.dataQuality.researchPreview || context?.researchPreview === true)
    && transit.length > 0 && transit.every(leg => leg.boardAt && leg.alightAt);
}

function recommendJourneys(journeys, { context } = {}) {
  const options = journeys.filter(journey => validOption(journey, { context }));
  const choice = (journey, reason) => Object.freeze({ journeyId: journey?.id || null, unavailableReason: journey ? null : reason });
  const first = options[0];
  const faresKnown = options.length > 0 && options.every(j => j.fareSummary.totalStatus === 'KNOWN'
    && Number.isFinite(j.fareSummary.totalFare) && j.fareSummary.totalFare >= 0
    && j.fareSummary.currency && j.fareSummary.currency === first.fareSummary.currency);
  const timesKnown = options.length > 0 && options.every(j => Number.isFinite(j.durationSummary.totalJourneyDurationSeconds)
    && j.durationSummary.totalJourneyDurationSeconds >= 0);
  const minimum = metric => options.reduce((best, j) => !best || metric(j) < metric(best) ? j : best, null);
  const availabilityRanks = { LIVE_ACTIVE: 3, SERVICE_EXPECTED: 2, LIMITED: 1 };
  const evidence = options.map(journey => ({ journey, strength: Math.min(...journey.legs.filter(leg => leg.type === 'TRANSIT')
    .map(leg => leg.availability?.status === 'LIVE_ACTIVE' && !(leg.availability.boardableVehicleCount > 0) ? 0 : availabilityRanks[leg.availability?.status] || 0)) }));
  const reliable = evidence.length && evidence.every(item => item.strength > 0) && new Set(evidence.map(item => item.strength)).size > 1
    ? evidence.reduce((best, item) => item.strength > best.strength ? item : best).journey : null;
  return Object.freeze({
    recommended: choice(first, 'NO_VALID_JOURNEY'),
    cheapest: choice(faresKnown ? minimum(j => j.fareSummary.totalFare) : null, options.length ? 'FARE_DATA_UNAVAILABLE' : 'NO_VALID_JOURNEY'),
    fastest: choice(timesKnown ? minimum(j => j.durationSummary.totalJourneyDurationSeconds) : null, options.length ? 'TIME_DATA_UNAVAILABLE' : 'NO_VALID_JOURNEY'),
    fewestTransfers: choice(options.length ? minimum(j => j.transferCount) : null, 'NO_VALID_JOURNEY'),
    mostReliable: choice(reliable, options.length ? 'RELIABILITY_EVIDENCE_INSUFFICIENT' : 'NO_VALID_JOURNEY'),
  });
}

module.exports = { recommendJourneys, validOption };
