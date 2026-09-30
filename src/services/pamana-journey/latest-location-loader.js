'use strict';

const { mapWithConcurrency } = require('./access-node-finder');
const locationKey = (tripId, vehicleId) => JSON.stringify([tripId, vehicleId]);

function latestLocationQuery({ vehicleId, tripId, allowSimulated = false, populateTrip = true } = {}) {
  return {
    filters: {
      vehicle: { documentId: vehicleId }, trip: { documentId: tripId },
      ...(allowSimulated ? {} : { data_mode: 'REAL' }),
    },
    fields: ['recorded_at', 'latitude', 'longitude', 'speed', 'heading', 'data_mode'],
    ...(populateTrip ? { populate: { trip: {
      fields: ['trip_status', 'is_simulated', 'data_mode'],
      populate: { route_variant: { fields: ['variant_code'] } },
    } } } : {}),
    sort: ['recorded_at:desc', 'id:desc'],
  };
}

// PostgreSQL selects only one ID for each exact requested trip/vehicle pair.
// Histories stay in the DB; normal Strapi document hydration follows once.
function latestLocationIdsQuery(connection, pairs, { allowSimulated = false } = {}) {
  const query = connection('vehicle_locations as location')
    .join('vehicle_locations_trip_lnk as trip_link', 'trip_link.vehicle_location_id', 'location.id')
    .join('trips as trip', 'trip.id', 'trip_link.trip_id')
    .join('vehicle_locations_vehicle_lnk as vehicle_link', 'vehicle_link.vehicle_location_id', 'location.id')
    .join('vehicles as vehicle', 'vehicle.id', 'vehicle_link.vehicle_id')
    .distinctOn(['trip.document_id', 'vehicle.document_id'])
    .select({ tripId: 'trip.document_id', vehicleId: 'vehicle.document_id', locationId: 'location.document_id' })
    .where(function exactPairs() {
      for (const pair of pairs) this.orWhere({ 'trip.document_id': pair.tripId, 'vehicle.document_id': pair.vehicleId });
    })
    .orderBy('trip.document_id').orderBy('vehicle.document_id')
    .orderBy('location.recorded_at', 'desc').orderBy('location.id', 'desc');
  if (!allowSimulated) query.where('location.data_mode', 'REAL');
  return query;
}

async function loadLatestLocations({
  strapiInstance = global.strapi, pairs = [], allowSimulated = false, populateTrip = true,
} = {}) {
  const unique = [...new Map(pairs.filter(pair => pair.tripId && pair.vehicleId)
    .map(pair => [locationKey(pair.tripId, pair.vehicleId), pair])).values()];
  if (!unique.length) return new Map();
  const connection = strapiInstance?.db?.connection;
  if (!connection || !['pg', 'postgres', 'postgresql'].includes(connection.client?.config?.client)) {
    // Preserve portable/non-PostgreSQL adapters and injected document-only tests.
    const locations = await mapWithConcurrency(unique, 4, async pair => [
      locationKey(pair.tripId, pair.vehicleId),
      await strapiInstance.documents('api::vehicle-location.vehicle-location')
        .findFirst(latestLocationQuery({ ...pair, allowSimulated, populateTrip })),
    ]);
    return new Map(locations);
  }
  const selected = await latestLocationIdsQuery(connection, unique, { allowSimulated });
  if (!selected.length) return new Map();
  const { fields, populate } = latestLocationQuery({ populateTrip });
  const locations = await strapiInstance.documents('api::vehicle-location.vehicle-location').findMany({
    filters: { documentId: { $in: selected.map(row => row.locationId) }, ...(allowSimulated ? {} : { data_mode: 'REAL' }) },
    fields, ...(populate ? { populate } : {}),
  });
  const byId = new Map(locations.map(location => [location.documentId, location]));
  return new Map(selected.map(row => [locationKey(row.tripId, row.vehicleId), byId.get(row.locationId) || null]));
}

module.exports = { latestLocationIdsQuery, latestLocationQuery, loadLatestLocations, locationKey };
