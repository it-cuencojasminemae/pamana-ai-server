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
  // Deployment overrides can reduce quota use, but cannot remove the bounds.
  const boundedInteger = (value, fallback, maximum) => Math.min(maximum, Math.max(1,
    Math.floor(positiveNumber(value, fallback))));
  config.maxCandidateCount = boundedInteger(config.maxCandidateCount, DEFAULT_WALKING_CONFIG.maxCandidateCount, 5);
  config.maxConcurrentRequests = boundedInteger(config.maxConcurrentRequests, DEFAULT_WALKING_CONFIG.maxConcurrentRequests, 2);
  config.requestTimeoutMs = boundedInteger(config.requestTimeoutMs, DEFAULT_WALKING_CONFIG.requestTimeoutMs, 30000);
  config.cacheTtlMs = boundedInteger(config.cacheTtlMs, DEFAULT_WALKING_CONFIG.cacheTtlMs, 5 * 60 * 1000);
  config.cacheMaxEntries = boundedInteger(config.cacheMaxEntries, DEFAULT_WALKING_CONFIG.cacheMaxEntries, 100);
  return Object.freeze(config);
}

module.exports = {
  DEFAULT_WALKING_CONFIG,
  walkingConfig,
};
