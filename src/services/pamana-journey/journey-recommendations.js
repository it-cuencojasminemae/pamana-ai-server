'use strict';

// Presentation classifications for the returned set. Preserve planner order,
// fares and eligibility; ties always use the planner's deterministic order.
function validOption(journey) {
  const transit = (journey?.legs || []).filter(leg => leg.type === 'TRANSIT');
  return journey?.dataQuality?.planningEligible === true
    && journey.dataQuality.dataModes.length > 0
    && journey.dataQuality.dataModes.every(mode => mode === 'REAL')
    && transit.length > 0 && transit.every(leg => leg.boardAt && leg.alightAt);
}

function recommendJourneys(journeys) {
  const options = journeys.filter(validOption);
  const choice = (journey, reason) => Object.freeze({ journeyId: journey?.id || null, unavailableReason: journey ? null : reason });
  const first = options[0];
  const faresKnown = options.length > 0 && options.every(j => j.fareSummary.totalStatus === 'KNOWN'
    && Number.isFinite(j.fareSummary.totalFare) && j.fareSummary.totalFare >= 0
    && j.fareSummary.currency && j.fareSummary.currency === first.fareSummary.currency);
  const timesKnown = options.length > 0 && options.every(j => Number.isFinite(j.durationSummary.totalJourneyDurationSeconds)
    && j.durationSummary.totalJourneyDurationSeconds >= 0);
  const minimum = metric => options.reduce((best, j) => !best || metric(j) < metric(best) ? j : best, null);
  return Object.freeze({
    recommended: choice(first, 'NO_VALID_JOURNEY'),
    cheapest: choice(faresKnown ? minimum(j => j.fareSummary.totalFare) : null, options.length ? 'FARE_DATA_UNAVAILABLE' : 'NO_VALID_JOURNEY'),
    fastest: choice(timesKnown ? minimum(j => j.durationSummary.totalJourneyDurationSeconds) : null, options.length ? 'TIME_DATA_UNAVAILABLE' : 'NO_VALID_JOURNEY'),
    fewestTransfers: choice(options.length ? minimum(j => j.transferCount) : null, 'NO_VALID_JOURNEY'),
  });
}

module.exports = { recommendJourneys, validOption };
