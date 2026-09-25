'use strict';

// The passenger map polls every 15 seconds. Four missed polls (60 seconds)
// is a conservative boundary after which a position is diagnostic history,
// not current live evidence. Keep this policy centralized.
const DEFAULT_AVAILABILITY_CONFIG = Object.freeze({
  locationMaxAgeSeconds: 60,
  maximumFutureClockSkewSeconds: 30,
});

function availabilityConfig(overrides = {}) {
  const locationMaxAgeSeconds = Number(overrides.locationMaxAgeSeconds);
  const maximumFutureClockSkewSeconds = Number(overrides.maximumFutureClockSkewSeconds);
  return Object.freeze({
    locationMaxAgeSeconds: Number.isFinite(locationMaxAgeSeconds) && locationMaxAgeSeconds > 0
      ? locationMaxAgeSeconds
      : DEFAULT_AVAILABILITY_CONFIG.locationMaxAgeSeconds,
    maximumFutureClockSkewSeconds:
      Number.isFinite(maximumFutureClockSkewSeconds) && maximumFutureClockSkewSeconds >= 0
        ? maximumFutureClockSkewSeconds
        : DEFAULT_AVAILABILITY_CONFIG.maximumFutureClockSkewSeconds,
  });
}

module.exports = {
  DEFAULT_AVAILABILITY_CONFIG,
  availabilityConfig,
};
