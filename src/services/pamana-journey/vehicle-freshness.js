'use strict';

const { availabilityConfig } = require('./availability-config');

const FRESHNESS_STATUS = Object.freeze({
  FRESH: 'FRESH',
  STALE: 'STALE',
  UNKNOWN: 'UNKNOWN',
});

function unknownFreshness() {
  return Object.freeze({ status: FRESHNESS_STATUS.UNKNOWN, latestObservedAt: null, ageSeconds: null });
}

function evaluateLocationFreshness(location, { now = new Date(), config = {} } = {}) {
  const policy = availabilityConfig(config);
  const observed = new Date(location?.recorded_at ?? location?.recordedAt ?? NaN);
  const current = new Date(now);
  if (!Number.isFinite(observed.getTime()) || !Number.isFinite(current.getTime())) return unknownFreshness();
  const rawAgeSeconds = (current.getTime() - observed.getTime()) / 1000;
  if (rawAgeSeconds < -policy.maximumFutureClockSkewSeconds) return unknownFreshness();
  const ageSeconds = Math.max(0, Math.floor(rawAgeSeconds));
  return Object.freeze({
    status: ageSeconds <= policy.locationMaxAgeSeconds
      ? FRESHNESS_STATUS.FRESH
      : FRESHNESS_STATUS.STALE,
    latestObservedAt: observed.toISOString(),
    ageSeconds,
  });
}

function latestFreshness(records, options = {}) {
  const candidates = (Array.isArray(records) ? records : [])
    .map((record) => record?.latestObservedAt
      ? Object.freeze({
        status: record.status,
        latestObservedAt: record.latestObservedAt,
        ageSeconds: record.ageSeconds,
      })
      : evaluateLocationFreshness(record?.location ?? record, options))
    .filter((freshness) => freshness.latestObservedAt)
    .sort((first, second) => Date.parse(second.latestObservedAt) - Date.parse(first.latestObservedAt));
  return candidates[0] || unknownFreshness();
}

module.exports = {
  FRESHNESS_STATUS,
  evaluateLocationFreshness,
  latestFreshness,
  unknownFreshness,
};
