'use strict';

const {
  DATA_MODE,
  planningEligibilityFor,
} = require('../transport-data/planning-eligibility');

const DRIVER_DIRECTIONS = Object.freeze({
  OUTBOUND: 'outbound',
  INBOUND: 'inbound',
});

const OPERATING_VARIANT_STATUSES = new Set(['ACTIVE', 'LIMITED']);
const VEHICLE_START_STATUSES = new Set(['available']);
const OCCUPANCY_LEVELS = new Set(['empty', 'low', 'moderate', 'near_full', 'full']);
const FUTURE_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

const relationId = (record) => record?.documentId || record?.id || null;

function datesAllowService(variant, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  if (variant?.effective_from && variant.effective_from > day) return false;
  if (variant?.effective_to && variant.effective_to < day) return false;
  return true;
}

function driverVariantEligibility({ driver, vehicle, route, variant, now = new Date() }) {
  const reasons = [];
  if (!driver) reasons.push('DRIVER_MISSING');
  if (driver?.driver_status !== 'active') reasons.push('DRIVER_INACTIVE');
  if (!vehicle) reasons.push('VEHICLE_MISSING');
  if (vehicle && !VEHICLE_START_STATUSES.has(vehicle.vehicle_status)) reasons.push('VEHICLE_UNAVAILABLE');
  if (!route) reasons.push('ROUTE_MISSING');
  if (!variant) reasons.push('ROUTE_VARIANT_MISSING');

  if (vehicle && route && relationId(vehicle.route) !== relationId(route)) {
    reasons.push('ROUTE_NOT_ASSIGNED_TO_VEHICLE');
  }
  if (variant && route && relationId(variant.route) !== relationId(route)) {
    reasons.push('VARIANT_ROUTE_MISMATCH');
  }
  if (variant && !DRIVER_DIRECTIONS[variant.direction]) reasons.push('DIRECTION_NOT_SUPPORTED');
  if (variant && !OPERATING_VARIANT_STATUSES.has(variant.operating_status)) reasons.push('VARIANT_NOT_ACTIVE');
  if (variant && !datesAllowService(variant, now)) reasons.push('VARIANT_OUTSIDE_EFFECTIVE_DATES');

  const modes = [driver?.data_mode, vehicle?.data_mode, route?.data_mode, variant?.data_mode].filter(Boolean);
  if (modes.length && new Set(modes).size !== 1) reasons.push('DATA_MODE_MISMATCH');

  const allowSimulated = modes.length === 4 && modes.every((mode) => mode === DATA_MODE.SIMULATED);
  if (route) {
    const result = planningEligibilityFor(route, { requireActive: true, allowSimulated });
    reasons.push(...result.reasons.map((reason) => `ROUTE_${reason}`));
  }
  if (variant) {
    const result = planningEligibilityFor(variant, { allowSimulated });
    reasons.push(...result.reasons.map((reason) => `VARIANT_${reason}`));
  }

  return { eligible: reasons.length === 0, reasons, allowSimulated };
}

function validateCoordinates(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { valid: false, reason: 'COORDINATES_NOT_NUMERIC' };
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return { valid: false, reason: 'COORDINATES_OUT_OF_RANGE' };
  if (lat === 0 && lng === 0) return { valid: false, reason: 'NULL_ISLAND_REJECTED' };
  return { valid: true, latitude: lat, longitude: lng };
}

function validateRecordedAt(value, { tripStartedAt, now = new Date() } = {}) {
  const recordedAt = value ? new Date(value) : now;
  const time = recordedAt.getTime();
  if (!Number.isFinite(time)) return { valid: false, reason: 'TIMESTAMP_INVALID' };
  if (time > now.getTime() + FUTURE_TIMESTAMP_TOLERANCE_MS) return { valid: false, reason: 'TIMESTAMP_IN_FUTURE' };
  const started = tripStartedAt ? new Date(tripStartedAt).getTime() : NaN;
  if (Number.isFinite(started) && time < started) return { valid: false, reason: 'TIMESTAMP_BEFORE_TRIP' };
  return { valid: true, recordedAt: recordedAt.toISOString() };
}

function occupancyForCount(value, capacity) {
  const count = Number(value);
  const seats = Number(capacity);
  if (!Number.isInteger(count) || count < 0) return { valid: false, reason: 'OCCUPANCY_INVALID' };
  if (!Number.isInteger(seats) || seats < 1) return { valid: false, reason: 'CAPACITY_INVALID' };
  if (count > seats) return { valid: false, reason: 'OCCUPANCY_EXCEEDS_CAPACITY' };
  const ratio = count / seats;
  const level = count === 0 ? 'empty' : ratio <= 0.4 ? 'low' : ratio <= 0.65 ? 'moderate' : ratio <= 0.9 ? 'near_full' : 'full';
  return {
    valid: true,
    count,
    level,
    normalized: level === 'full' ? 'FULL' : level === 'near_full' ? 'NEAR_FULL' : 'AVAILABLE',
  };
}

function normalizeOccupancyLevel(level) {
  if (level == null) return 'UNKNOWN';
  if (!OCCUPANCY_LEVELS.has(level)) return 'UNKNOWN';
  if (level === 'full') return 'FULL';
  if (level === 'near_full') return 'NEAR_FULL';
  return 'AVAILABLE';
}

function startTripData({ driver, vehicle, route, variant, now = new Date() }) {
  const eligibility = driverVariantEligibility({ driver, vehicle, route, variant, now });
  if (!eligibility.eligible) return { valid: false, reasons: eligibility.reasons };
  return {
    valid: true,
    data: {
      route: route.id,
      route_variant: variant.id,
      direction: DRIVER_DIRECTIONS[variant.direction],
      driver: driver.id,
      vehicle: vehicle.id,
      trip_status: 'active',
      started_at: now.toISOString(),
      data_mode: variant.data_mode,
      is_simulated: variant.data_mode === DATA_MODE.SIMULATED,
    },
  };
}

function endTripData(status, now = new Date()) {
  if (!['completed', 'cancelled'].includes(status)) return { valid: false };
  return { valid: true, data: { trip_status: status, ended_at: now.toISOString() } };
}

module.exports = {
  DRIVER_DIRECTIONS,
  FUTURE_TIMESTAMP_TOLERANCE_MS,
  OPERATING_VARIANT_STATUSES,
  datesAllowService,
  driverVariantEligibility,
  normalizeOccupancyLevel,
  occupancyForCount,
  startTripData,
  endTripData,
  relationId,
  validateCoordinates,
  validateRecordedAt,
};
