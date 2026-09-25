'use strict';

const { unwrapRecord } = require('./graph-builder');
const { evaluateLocationFreshness, latestFreshness, FRESHNESS_STATUS } = require('./vehicle-freshness');

const OCCUPANCY_STATUS = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  NEAR_FULL: 'NEAR_FULL',
  FULL: 'FULL',
  UNKNOWN: 'UNKNOWN',
});

const identity = (record) => {
  const value = unwrapRecord(record);
  return value?.documentId || value?.document_id || (value?.id == null ? null : String(value.id));
};

function relationMatches(relation, legVariantId) {
  const record = unwrapRecord(relation);
  return Boolean(record && [identity(record), record.variant_code].filter(Boolean).includes(legVariantId));
}

function occupancyFor(record, freshness) {
  const vehicle = unwrapRecord(record?.vehicle);
  if (!vehicle || freshness.status !== FRESHNESS_STATUS.FRESH) return OCCUPANCY_STATUS.UNKNOWN;
  if (vehicle.vehicle_status === 'full' || vehicle.occupancy_level === 'full') return OCCUPANCY_STATUS.FULL;
  if (vehicle.occupancy_level === 'near_full') return OCCUPANCY_STATUS.NEAR_FULL;
  if (['empty', 'low', 'moderate'].includes(vehicle.occupancy_level)) return OCCUPANCY_STATUS.AVAILABLE;
  // current_occupancy defaults to zero in the schema and has no observation
  // timestamp, so it cannot independently prove that seats are available.
  return OCCUPANCY_STATUS.UNKNOWN;
}

function isOperationallyActive(record, legVariantId) {
  const vehicle = unwrapRecord(record?.vehicle);
  const trip = unwrapRecord(record?.trip);
  if (!vehicle || vehicle.vehicle_status === 'offline') return false;
  const assigned = relationMatches(vehicle.active_route_variant, legVariantId);
  const activeTrip = trip?.trip_status === 'active'
    && trip?.is_simulated !== true
    && relationMatches(trip.route_variant, legVariantId);
  return assigned || activeTrip;
}

function isAllowedMode(record, allowSimulated) {
  const values = [record?.vehicle, record?.trip, record?.location]
    .map(unwrapRecord)
    .filter(Boolean)
    .map((item) => item.data_mode);
  if (!allowSimulated && unwrapRecord(record?.trip)?.is_simulated === true) return false;
  if (allowSimulated) return values.every((mode) => mode === 'REAL' || mode === 'SIMULATED');
  return values.length > 0 && values.every((mode) => mode === 'REAL');
}

function resolveLiveVehicles(leg, {
  operationalRecords = [],
  now = new Date(),
  config = {},
  allowSimulated = false,
} = {}) {
  const records = [];
  for (const rawRecord of Array.isArray(operationalRecords) ? operationalRecords : []) {
    const vehicle = unwrapRecord(rawRecord?.vehicle);
    if (!vehicle || !isAllowedMode(rawRecord, allowSimulated)) continue;
    const assigned = relationMatches(vehicle.active_route_variant, leg?.routeVariantId)
      || relationMatches(rawRecord?.trip?.route_variant, leg?.routeVariantId);
    if (!assigned) continue;
    const freshness = evaluateLocationFreshness(rawRecord.location, { now, config });
    const active = isOperationallyActive(rawRecord, leg.routeVariantId);
    const live = active && freshness.status === FRESHNESS_STATUS.FRESH;
    const occupancy = occupancyFor(rawRecord, freshness);
    records.push(Object.freeze({
      vehicleId: identity(vehicle),
      assigned: true,
      live,
      occupancy,
      boardable: live && [OCCUPANCY_STATUS.AVAILABLE, OCCUPANCY_STATUS.NEAR_FULL].includes(occupancy),
      dataFreshness: freshness,
    }));
  }
  const live = records.filter((record) => record.live);
  return Object.freeze({
    assignedVehicleCount: records.length,
    activeVehicleCount: live.length,
    boardableVehicleCount: live.filter((record) => record.boardable).length,
    unknownOccupancyVehicleCount: live.filter((record) => record.occupancy === OCCUPANCY_STATUS.UNKNOWN).length,
    fullVehicleCount: live.filter((record) => record.occupancy === OCCUPANCY_STATUS.FULL).length,
    dataFreshness: latestFreshness(records.map((record) => record.dataFreshness)),
    vehicles: Object.freeze(records),
  });
}

module.exports = {
  OCCUPANCY_STATUS,
  occupancyFor,
  relationMatches,
  resolveLiveVehicles,
};
