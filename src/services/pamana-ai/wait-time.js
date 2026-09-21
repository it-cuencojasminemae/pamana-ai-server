'use strict';

/**
 * Phase 14 - Vehicle Wait-Time Prediction
 *
 * Baseline model: average gap between historical completed-trip start times
 * on the route. The pilot has almost no usable trip history yet (a handful
 * of same-day test trips seconds apart), so this deliberately falls back to
 * an assumed default service frequency when there isn't enough real signal
 * - and says so honestly via `basis` and a low `confidence`, rather than
 * pretending a real pattern exists.
 *
 * Only real trips (is_simulated: false) count toward this average - Phase 21
 * (Simulation Engine, not yet built) will write demo Trips to make the map
 * look alive, and those must never be presented as evidence of a real
 * service pattern (PAMANA_CLAUDE_CODE_CONTEXT.md data-integrity rule).
 */

const { DATA_MODE } = require('../transport-data/planning-eligibility');

const DEFAULT_FREQUENCY_MINUTES = 15; // typical jeepney headway assumption, used only as a fallback
const MIN_GAP_MINUTES = 1; // filters out same-burst test artifacts, not real service gaps
const MAX_PLAUSIBLE_GAP_MINUTES = 45; // a gap wider than this reflects a driver going offline/test data, not real headway
const MIN_INTERVALS_FOR_OBSERVED_PREDICTION = 5;

async function predictWaitTime(strapi, { routeId }) {
  const trips = await strapi.documents('api::trip.trip').findMany({
    filters: {
      route: { id: routeId },
      trip_status: 'completed',
      is_simulated: false,
      data_mode: DATA_MODE.REAL,
    },
    sort: ['started_at:asc'],
    fields: ['started_at'],
  });

  const startTimes = trips
    .map((t) => new Date(t.started_at).getTime())
    .sort((a, b) => a - b);

  const intervalsMin = [];
  for (let i = 1; i < startTimes.length; i++) {
    const diffMin = (startTimes[i] - startTimes[i - 1]) / 60000;
    if (diffMin >= MIN_GAP_MINUTES && diffMin <= MAX_PLAUSIBLE_GAP_MINUTES) intervalsMin.push(diffMin);
  }

  // A single interval is useful context, but insufficient for a passenger
  // prediction. Until enough observations exist, the response stays honest
  // about using a fallback service-frequency estimate.
  const usingRealHistory = intervalsMin.length >= MIN_INTERVALS_FOR_OBSERVED_PREDICTION;
  const avgInterval = usingRealHistory
    ? intervalsMin.reduce((a, b) => a + b, 0) / intervalsMin.length
    : DEFAULT_FREQUENCY_MINUTES;

  const activeTrips = await strapi.documents('api::trip.trip').findMany({
    filters: {
      route: { id: routeId },
      trip_status: 'active',
      is_simulated: false,
      data_mode: DATA_MODE.REAL,
    },
    fields: ['id'],
  });
  const hasActiveVehicle = activeTrips.length > 0;

  const low = Math.max(1, Math.round(avgInterval * 0.7));
  const high = Math.max(low + 1, Math.round(avgInterval * 1.3));

  let availabilityClass;
  if (!hasActiveVehicle) {
    availabilityClass = 'Low';
  } else if (high <= 10) {
    availabilityClass = 'High';
  } else if (high <= 25) {
    availabilityClass = 'Medium';
  } else {
    availabilityClass = 'Low';
  }

  const confidence = usingRealHistory ? 0.7 : 0.2;

  return {
    route_id: routeId,
    predicted_wait_minutes: { low, high },
    availability_class: availabilityClass,
    confidence,
    active_vehicles: activeTrips.length,
    sample_count: intervalsMin.length,
    basis: usingRealHistory ? 'historical_trip_intervals' : 'fallback_default_frequency',
  };
}

module.exports = {
  predictWaitTime,
  DEFAULT_FREQUENCY_MINUTES,
  MIN_INTERVALS_FOR_OBSERVED_PREDICTION,
};
