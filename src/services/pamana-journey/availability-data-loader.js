'use strict';

const { unwrapRecord } = require('./graph-builder');
const { latestLocationQuery, loadLatestLocations, locationKey } = require('./latest-location-loader');

const unique = (values) => [...new Set(values.filter(Boolean))];
const identity = (record) => {
  const value = unwrapRecord(record);
  return value?.documentId || value?.document_id || (value?.id == null ? null : String(value.id));
};

function operationalTripQuery({ variantIds = [], allowSimulated = false } = {}) {
  return {
    filters: {
      trip_status: 'active',
      route_variant: { documentId: { $in: variantIds } },
      ...(allowSimulated ? {} : { is_simulated: false, data_mode: 'REAL' }),
    },
    fields: ['trip_status', 'is_simulated', 'data_mode', 'started_at'],
    populate: {
      route_variant: { fields: ['variant_code'] },
      vehicle: {
        fields: ['vehicle_status', 'occupancy_level', 'current_occupancy', 'capacity', 'data_mode'],
        populate: { active_route_variant: { fields: ['variant_code'] } },
      },
    },
    sort: ['id:asc'],
  };
}

function assignedVehicleQuery({ variantIds = [], allowSimulated = false } = {}) {
  return {
    filters: {
      active_route_variant: { documentId: { $in: variantIds } },
      vehicle_status: { $ne: 'offline' },
      ...(allowSimulated ? {} : { data_mode: 'REAL' }),
    },
    fields: ['vehicle_status', 'occupancy_level', 'current_occupancy', 'capacity', 'data_mode'],
    populate: { active_route_variant: { fields: ['variant_code'] } },
    sort: ['id:asc'],
  };
}

async function loadOperationalData({
  journey,
  strapiInstance = global.strapi,
  allowSimulated = false,
} = {}) {
  if (!strapiInstance?.documents) throw new Error('STRAPI_DOCUMENT_SERVICE_UNAVAILABLE');
  const variantIds = unique((Array.isArray(journey?.legs) ? journey.legs : [])
    .filter((leg) => leg.type === 'TRANSIT')
    .map((leg) => leg.routeVariantId));
  if (!variantIds.length) return Object.freeze({ operationalRecords: Object.freeze([]) });

  const [trips, vehicles] = await Promise.all([
    strapiInstance.documents('api::trip.trip').findMany(operationalTripQuery({ variantIds, allowSimulated })),
    strapiInstance.documents('api::vehicle.vehicle').findMany(assignedVehicleQuery({ variantIds, allowSimulated })),
  ]);
  const byVehicle = new Map();
  for (const rawTrip of Array.isArray(trips) ? trips : []) {
    const trip = unwrapRecord(rawTrip);
    const vehicle = unwrapRecord(trip?.vehicle);
    const vehicleId = identity(vehicle);
    if (vehicleId) byVehicle.set(vehicleId, { vehicle, trip });
  }
  for (const rawVehicle of Array.isArray(vehicles) ? vehicles : []) {
    const vehicle = unwrapRecord(rawVehicle);
    const vehicleId = identity(vehicle);
    if (vehicleId && !byVehicle.has(vehicleId)) byVehicle.set(vehicleId, { vehicle, trip: null });
  }

  const latest = await loadLatestLocations({
    strapiInstance, allowSimulated,
    pairs: [...byVehicle.entries()].map(([vehicleId, record]) => ({ vehicleId, tripId: identity(record.trip) })),
  });
  const records = [...byVehicle.entries()].map(([vehicleId, record]) => {
    const tripId = identity(record.trip);
    const location = tripId ? latest.get(locationKey(tripId, vehicleId)) : null;
    const unwrappedLocation = unwrapRecord(location);
    return Object.freeze({
      ...record,
      // The location's trip is authoritative for the ping when available.
      trip: unwrapRecord(unwrappedLocation?.trip) || record.trip,
      location: unwrappedLocation,
    });
  });
  return Object.freeze({ operationalRecords: Object.freeze(records) });
}

module.exports = {
  assignedVehicleQuery,
  latestLocationQuery,
  loadOperationalData,
  operationalTripQuery,
};
