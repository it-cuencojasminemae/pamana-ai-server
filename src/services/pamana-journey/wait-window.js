'use strict';

const { WINDOW_STATUS } = require('./service-pattern-engine');

const WAIT_STATUS = Object.freeze({
  ESTIMATED_WINDOW: 'ESTIMATED_WINDOW',
  SERVICE_INTERVAL_ONLY: 'SERVICE_INTERVAL_ONLY',
  UNKNOWN: 'UNKNOWN',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
});

const WAIT_BASIS = Object.freeze({
  LIVE_OPERATIONAL: 'LIVE_OPERATIONAL',
  VERIFIED_HEADWAY: 'VERIFIED_HEADWAY',
  VERIFIED_SCHEDULE: 'VERIFIED_SCHEDULE',
});

function waitResult(status, lowMinutes = null, highMinutes = null, basis = null) {
  return Object.freeze({ status, lowMinutes, highMinutes, basis });
}

function waitForService(service, { applicable = true } = {}) {
  if (!applicable || service?.windowStatus === WINDOW_STATUS.OUTSIDE) {
    return waitResult(WAIT_STATUS.NOT_APPLICABLE);
  }
  if (service?.operatingMode === 'FREQUENCY_BASED'
    && Number.isFinite(service?.headwayMinutes?.maximum)) {
    // For an unsynchronised passenger arrival, the only defensible derived
    // range is 0 through the verified maximum service interval. It is not an
    // ETA or a claim that a vehicle will arrive within that range.
    return waitResult(
      WAIT_STATUS.SERVICE_INTERVAL_ONLY,
      0,
      service.headwayMinutes.maximum,
      WAIT_BASIS.VERIFIED_HEADWAY
    );
  }
  return waitResult(WAIT_STATUS.UNKNOWN);
}

module.exports = {
  WAIT_BASIS,
  WAIT_STATUS,
  waitForService,
  waitResult,
};
