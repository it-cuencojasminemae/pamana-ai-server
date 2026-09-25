'use strict';

const DEFAULT_TRIP_PLAN_CONFIG = Object.freeze({
  maxJourneys: 5,
});

function tripPlanConfig(overrides = {}) {
  const maxJourneys = Math.floor(Number(overrides.maxJourneys));
  return Object.freeze({
    maxJourneys: Number.isFinite(maxJourneys) && maxJourneys > 0
      ? Math.min(maxJourneys, DEFAULT_TRIP_PLAN_CONFIG.maxJourneys)
      : DEFAULT_TRIP_PLAN_CONFIG.maxJourneys,
  });
}

module.exports = { DEFAULT_TRIP_PLAN_CONFIG, tripPlanConfig };
