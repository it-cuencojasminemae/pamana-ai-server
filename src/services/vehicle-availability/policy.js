'use strict';

const STATUSES = Object.freeze(['AVAILABLE', 'LIMITED', 'FULL', 'UNKNOWN']);
const SOURCES = Object.freeze(['DRIVER', 'PASSENGER', 'SYSTEM_ESTIMATE', 'SIMULATION']);
const TRIP_AVAILABILITY_FIELDS = ['availability_status', 'availability_source', 'availability_reported_at'];

// Starting operational assumption, configurable in one place. GPS never renews it.
function maxAgeSeconds() {
  const value = Number(process.env.MANUAL_AVAILABILITY_MAX_AGE_SECONDS);
  return Number.isFinite(value) && value > 0 && value <= 86400 ? value : 900;
}

function availabilityForTrip(trip, { now = new Date(), dataMode = trip?.data_mode } = {}) {
  const reportedAt = trip?.availability_reported_at;
  const reported = reportedAt ? Date.parse(reportedAt) : NaN;
  const age = (new Date(now).getTime() - reported) / 1000;
  const source = SOURCES.includes(trip?.availability_source) ? trip.availability_source : null;
  const reportedStatus = STATUSES.includes(trip?.availability_status) ? trip.availability_status : 'UNKNOWN';
  const valid = trip?.trip_status === 'active' && ['REAL', 'SIMULATED'].includes(dataMode)
    && trip?.data_mode === dataMode && source
    && (dataMode === 'SIMULATED' ? source === 'SIMULATION' : source !== 'SIMULATION' && trip?.is_simulated !== true)
    && Number.isFinite(age) && age >= 0;
  const stale = Boolean(valid && age >= maxAgeSeconds());
  // Passenger observations remain separate evidence, not accepted availability.
  const supported = source === 'DRIVER' || source === 'SIMULATION';
  return {
    status: valid && !stale && supported ? reportedStatus : 'UNKNOWN',
    reportedStatus: valid ? reportedStatus : 'UNKNOWN',
    source: valid ? source : null,
    confidence: valid && supported && !stale ? (source === 'SIMULATION' ? 'SIMULATED' : 'REPORTED') : 'UNKNOWN',
    reportedAt: valid ? new Date(reported).toISOString() : null,
    expiresAt: valid ? new Date(reported + maxAgeSeconds() * 1000).toISOString() : null,
    ageSeconds: valid ? Math.floor(age) : null,
    stale,
    dataMode: dataMode === 'REAL' ? 'REAL' : 'SIMULATED',
  };
}

module.exports = { STATUSES, SOURCES, TRIP_AVAILABILITY_FIELDS, maxAgeSeconds, availabilityForTrip };
