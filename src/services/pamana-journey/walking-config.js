'use strict';

const DEFAULT_WALKING_CONFIG = Object.freeze({
  routingUrl: 'https://api.geoapify.com/v1/routing',
  initialCandidateRadiusMeters: 800,
  maximumCandidateRadiusMeters: 1500,
  maxCandidateCount: 5,
  maxConcurrentRequests: 2,
  requestTimeoutMs: 7000,
  proximityThresholdMeters: 15,
  cacheTtlMs: 5 * 60 * 1000,
  cacheMaxEntries: 100,
  coordinatePrecision: 6,
});

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function walkingConfig(overrides = {}) {
  const config = {
    ...DEFAULT_WALKING_CONFIG,
    initialCandidateRadiusMeters: positiveNumber(
      process.env.PAMANA_WALK_INITIAL_RADIUS_METERS,
      DEFAULT_WALKING_CONFIG.initialCandidateRadiusMeters
    ),
    maximumCandidateRadiusMeters: positiveNumber(
      process.env.PAMANA_WALK_MAX_RADIUS_METERS,
      DEFAULT_WALKING_CONFIG.maximumCandidateRadiusMeters
    ),
    maxCandidateCount: Math.floor(positiveNumber(
      process.env.PAMANA_WALK_MAX_CANDIDATES,
      DEFAULT_WALKING_CONFIG.maxCandidateCount
    )),
    maxConcurrentRequests: Math.floor(positiveNumber(
      process.env.PAMANA_WALK_CONCURRENCY,
      DEFAULT_WALKING_CONFIG.maxConcurrentRequests
    )),
    requestTimeoutMs: positiveNumber(
      process.env.PAMANA_WALK_TIMEOUT_MS,
      DEFAULT_WALKING_CONFIG.requestTimeoutMs
    ),
    ...overrides,
  };
  config.maximumCandidateRadiusMeters = Math.max(
    config.initialCandidateRadiusMeters,
    config.maximumCandidateRadiusMeters
  );
  return Object.freeze(config);
}

module.exports = {
  DEFAULT_WALKING_CONFIG,
  walkingConfig,
};
