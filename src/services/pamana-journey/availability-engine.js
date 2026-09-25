'use strict';

const { LEG_TYPE } = require('./types');
const { SERVICE_STATUS, WINDOW_STATUS } = require('./service-pattern-engine');
const { resolveLiveVehicles } = require('./live-vehicle-resolver');
const { unknownFreshness } = require('./vehicle-freshness');
const { WAIT_STATUS, waitForService, waitResult } = require('./wait-window');

const AVAILABILITY_STATUS = Object.freeze({
  LIVE_ACTIVE: 'LIVE_ACTIVE',
  SERVICE_EXPECTED: 'SERVICE_EXPECTED',
  LIMITED: 'LIMITED',
  OUTSIDE_SERVICE: 'OUTSIDE_SERVICE',
  UNKNOWN: 'UNKNOWN',
});

const JOURNEY_AVAILABILITY_STATUS = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  PARTIAL: 'PARTIAL',
  UNAVAILABLE: 'UNAVAILABLE',
  UNKNOWN: 'UNKNOWN',
});

function notApplicableAvailability() {
  return Object.freeze({
    status: AVAILABILITY_STATUS.UNKNOWN,
    wait: waitResult(WAIT_STATUS.NOT_APPLICABLE),
    activeVehicleCount: null,
    boardableVehicleCount: null,
    dataFreshness: unknownFreshness(),
    sourceSummary: null,
    warnings: Object.freeze([]),
  });
}

function availabilityForLeg(leg, {
  service,
  operationalRecords = [],
  now = new Date(),
  config = {},
  allowSimulated = false,
} = {}) {
  if (leg?.type !== LEG_TYPE.TRANSIT) return notApplicableAvailability();
  const resolved = resolveLiveVehicles(leg, { operationalRecords, now, config, allowSimulated });
  const warnings = [];
  let status = AVAILABILITY_STATUS.UNKNOWN;

  if (service?.windowStatus === WINDOW_STATUS.OUTSIDE) {
    status = AVAILABILITY_STATUS.OUTSIDE_SERVICE;
    if (resolved.activeVehicleCount) warnings.push('LIVE_ACTIVITY_OUTSIDE_VERIFIED_SERVICE_WINDOW');
  } else if (resolved.activeVehicleCount > 0) {
    status = AVAILABILITY_STATUS.LIVE_ACTIVE;
    warnings.push('LIVE_VEHICLE_ETA_UNAVAILABLE');
  } else if (service?.limitedService === true) {
    status = AVAILABILITY_STATUS.LIMITED;
  } else if ([SERVICE_STATUS.KNOWN, SERVICE_STATUS.PARTIAL].includes(service?.status)
    && service?.windowStatus === WINDOW_STATUS.WITHIN) {
    status = AVAILABILITY_STATUS.SERVICE_EXPECTED;
  }

  if (resolved.assignedVehicleCount > 0 && resolved.activeVehicleCount === 0) {
    warnings.push(resolved.dataFreshness.status === 'STALE'
      ? 'STALE_OPERATIONAL_DATA'
      : 'ASSIGNED_VEHICLE_NOT_LIVE');
  }
  if (resolved.unknownOccupancyVehicleCount > 0) warnings.push('LIVE_VEHICLE_OCCUPANCY_UNKNOWN');
  if (resolved.fullVehicleCount > 0) warnings.push('FULL_VEHICLE_NOT_BOARDABLE');
  if (status === AVAILABILITY_STATUS.UNKNOWN) warnings.push('AVAILABILITY_EVIDENCE_INSUFFICIENT');

  const sourceLabels = [];
  if (resolved.activeVehicleCount > 0) sourceLabels.push('LIVE_OPERATIONAL');
  if (service?.appliedPatternId) sourceLabels.push('VERIFIED_SERVICE_PATTERN');
  return Object.freeze({
    status,
    wait: waitForService(service, { applicable: status !== AVAILABILITY_STATUS.OUTSIDE_SERVICE }),
    activeVehicleCount: resolved.activeVehicleCount,
    boardableVehicleCount: resolved.boardableVehicleCount,
    dataFreshness: resolved.dataFreshness,
    sourceSummary: sourceLabels.length ? sourceLabels.join(' + ') : null,
    warnings: Object.freeze([...new Set(warnings)]),
  });
}

function summarizeJourneyAvailability(legs) {
  const transit = (Array.isArray(legs) ? legs : []).filter((leg) => leg.type === LEG_TYPE.TRANSIT);
  if (!transit.length) return Object.freeze({
    status: JOURNEY_AVAILABILITY_STATUS.UNKNOWN,
    transitLegsKnown: 0,
    transitLegsUnknown: 0,
    warnings: Object.freeze([]),
  });
  const statuses = transit.map((leg) => leg.availability?.status || AVAILABILITY_STATUS.UNKNOWN);
  const transitLegsUnknown = statuses.filter((status) => status === AVAILABILITY_STATUS.UNKNOWN).length;
  const transitLegsKnown = statuses.length - transitLegsUnknown;
  let status;
  if (statuses.includes(AVAILABILITY_STATUS.OUTSIDE_SERVICE)) {
    status = JOURNEY_AVAILABILITY_STATUS.UNAVAILABLE;
  } else if (transit.every((leg) => leg.availability?.status === AVAILABILITY_STATUS.SERVICE_EXPECTED
    || (leg.availability?.status === AVAILABILITY_STATUS.LIVE_ACTIVE
      && Number(leg.availability?.boardableVehicleCount) > 0))) {
    status = JOURNEY_AVAILABILITY_STATUS.AVAILABLE;
  } else if (transitLegsKnown > 0) {
    status = JOURNEY_AVAILABILITY_STATUS.PARTIAL;
  } else {
    status = JOURNEY_AVAILABILITY_STATUS.UNKNOWN;
  }
  return Object.freeze({
    status,
    transitLegsKnown,
    transitLegsUnknown,
    warnings: Object.freeze([...new Set(transit.flatMap((leg) => leg.availability?.warnings || []))]),
  });
}

module.exports = {
  AVAILABILITY_STATUS,
  JOURNEY_AVAILABILITY_STATUS,
  availabilityForLeg,
  notApplicableAvailability,
  summarizeJourneyAvailability,
};
