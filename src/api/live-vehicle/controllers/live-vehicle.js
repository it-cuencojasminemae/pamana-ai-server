'use strict';

const { DATA_MODE } = require('../../../services/transport-data/planning-eligibility');

/**
 * live-vehicle controller
 *
 * Stage 11.1 MVP polling endpoint: returns the current position of every
 * vehicle currently on an active trip, for passengers/LGU to poll every
 * few seconds. A vehicle only appears once its driver has sent at least
 * one GPS ping - an active trip with no location yet is not a "live"
 * vehicle.
 */

module.exports = {
  async list(ctx) {
    const { route } = ctx.query;

    const filters = { trip_status: 'active' };

    if (route) {
      filters.route = { documentId: route };
    }

    const activeTrips = await strapi.documents('api::trip.trip').findMany({
      filters,
      populate: { vehicle: true, route: true },
    });

    const results = await Promise.all(
      activeTrips.map(async (trip) => {
        if (!trip.vehicle || !trip.route) {
          return null;
        }

        const location = await strapi.documents('api::vehicle-location.vehicle-location').findFirst({
          filters: { trip: { id: trip.id } },
          sort: ['recorded_at:desc'],
        });

        if (!location) {
          return null;
        }

        const dataMode = [trip.data_mode, trip.vehicle.data_mode, location.data_mode]
          .every((mode) => mode === DATA_MODE.REAL)
          ? DATA_MODE.REAL
          : DATA_MODE.SIMULATED;

        return {
          vehicle_id: trip.vehicle.id,
          documentId: trip.vehicle.documentId,
          vehicle_number: trip.vehicle.vehicle_number,
          plate_number: trip.vehicle.plate_number,
          vehicle_type: trip.vehicle.vehicle_type,
          vehicle_status: trip.vehicle.vehicle_status,
          occupancy_level: trip.vehicle.occupancy_level,
          wheelchair_accessible: trip.vehicle.wheelchair_accessible,
          low_floor: trip.vehicle.low_floor,
          data_mode: dataMode,
          trip_data_mode: trip.data_mode ?? DATA_MODE.SIMULATED,
          vehicle_data_mode: trip.vehicle.data_mode ?? DATA_MODE.SIMULATED,
          location_data_mode: location.data_mode ?? DATA_MODE.SIMULATED,
          route: {
            id: trip.route.id,
            route_name: trip.route.route_name,
            route_code: trip.route.route_code,
          },
          direction: trip.direction,
          latitude: location.latitude,
          longitude: location.longitude,
          speed: location.speed,
          heading: location.heading,
          recorded_at: location.recorded_at,
        };
      })
    );

    ctx.body = { data: results.filter(Boolean) };
  },
};
