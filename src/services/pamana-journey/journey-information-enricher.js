'use strict';

const { evaluateFareForLeg, summarizeJourneyFares } = require('./fare-engine');
const { loadFareAndServiceData } = require('./fare-service-data-loader');
const { evaluateServiceForLeg } = require('./service-pattern-engine');

function enrichJourneyInformation(journey, {
  fareRules = [],
  servicePatterns = [],
  passengerCategory = 'REGULAR',
  requestedDeparture,
} = {}) {
  if (!journey || !Array.isArray(journey.legs)) return null;
  const legs = Object.freeze(journey.legs.map((leg) => Object.freeze({
    ...leg,
    fare: evaluateFareForLeg(leg, {
      fareRules,
      passengerCategory,
      requestedDate: requestedDeparture,
    }),
    service: evaluateServiceForLeg(leg, { servicePatterns, requestedDeparture }),
  })));
  return Object.freeze({
    ...journey,
    legs,
    fareSummary: summarizeJourneyFares(legs),
    informationAsOf: requestedDeparture || null,
  });
}

async function enrichVerifiedJourneyInformation(journey, {
  passengerCategory = 'REGULAR',
  requestedDeparture,
  strapiInstance = global.strapi,
} = {}) {
  const data = await loadFareAndServiceData({ journey, requestedDeparture, strapiInstance });
  return enrichJourneyInformation(journey, {
    ...data,
    passengerCategory,
    requestedDeparture,
  });
}

module.exports = {
  enrichJourneyInformation,
  enrichVerifiedJourneyInformation,
};
