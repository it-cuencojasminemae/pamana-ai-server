'use strict';

const { evaluateFareForLeg, summarizeJourneyFares } = require('./fare-engine');
const { loadFareAndServiceData } = require('./fare-service-data-loader');
const { countVehicleTransfers } = require('./transfer-count');
const { evaluateServiceForLeg } = require('./service-pattern-engine');
const { loadOperationalData } = require('./availability-data-loader');
const { simulatedRideDuration } = require('./research-demo-observations');
const {
  availabilityForLeg,
  summarizeJourneyAvailability,
} = require('./availability-engine');

function enrichJourneyInformation(journey, {
  fareRules = [],
  servicePatterns = [],
  operationalRecords = [],
  passengerCategory = 'REGULAR',
  requestedDeparture,
  observedAt = new Date(),
  availabilityConfig = {},
  allowSimulated = false,
  context,
} = {}) {
  if (!journey || !Array.isArray(journey.legs)) return null;
  const legs = Object.freeze(journey.legs.map((leg) => {
    const service = evaluateServiceForLeg(leg, {
      servicePatterns,
      requestedDeparture,
      allowSimulated,
    });
    return Object.freeze({
      ...leg,
      ...(context?.allowSimulatedObservations && leg.type === 'TRANSIT' ? { simulatedDurationSeconds: simulatedRideDuration(leg, context) } : {}),
      fare: evaluateFareForLeg(leg, {
        fareRules,
        passengerCategory,
        requestedDate: requestedDeparture,
        allowSimulated,
        context,
      }),
      service,
      availability: (() => { const availability = availabilityForLeg(leg, {
        service,
        operationalRecords,
        now: observedAt,
        config: availabilityConfig,
        allowSimulated,
      }); return { ...availability, ...(context?.allowSimulatedObservations && leg.type === 'TRANSIT'
        ? { evidenceClass: 'SIMULATED', sourceSummary: 'SIMULATED preview observations', wait: { ...availability.wait,
          basis: availability.wait.basis ? 'SIMULATED_HEADWAY' : null } } : {}) }; })(),
    });
  }));
  return Object.freeze({
    ...journey,
    legs,
    transferCount: countVehicleTransfers(legs),
    fareSummary: summarizeJourneyFares(legs),
    availabilitySummary: summarizeJourneyAvailability(legs),
    informationAsOf: requestedDeparture || null,
  });
}

async function enrichVerifiedJourneyInformation(journey, {
  passengerCategory = 'REGULAR',
  requestedDeparture,
  observedAt = new Date(),
  availabilityConfig = {},
  allowSimulated = false,
  strapiInstance = global.strapi,
} = {}) {
  const [information, operations] = await Promise.all([
    loadFareAndServiceData({ journey, requestedDeparture, strapiInstance }),
    loadOperationalData({ journey, strapiInstance, allowSimulated }),
  ]);
  return enrichJourneyInformation(journey, {
    ...information,
    ...operations,
    passengerCategory,
    requestedDeparture,
    observedAt,
    availabilityConfig,
    allowSimulated,
  });
}

module.exports = {
  enrichJourneyInformation,
  enrichVerifiedJourneyInformation,
};
