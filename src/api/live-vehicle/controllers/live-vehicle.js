'use strict';

const { DATA_MODE } = require('../../../services/transport-data/planning-eligibility');
const { ROLE, enforceRole } = require('../../../services/security/access-control');
const { loadLatestLocations, locationKey } = require('../../../services/pamana-journey/latest-location-loader');

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
    if (!enforceRole(ctx, [ROLE.PASSENGER, ROLE.LGU, ROLE.ADMINISTRATOR])) return;
    const { route } = ctx.query;
    if (Object.keys(ctx.query || {}).some((key) => key !== 'route')
      || (route !== undefined && (typeof route !== 'string' || !/^[A-Za-z0-9_-]{8,80}$/.test(route)))) {
      return ctx.badRequest('Live vehicle query is invalid.');
    }

    const filters = { trip_status: 'active' };

    if (route) {
      filters.route = { documentId: route };
    }

    const activeTrips = await strapi.documents('api::trip.trip').findMany({
      filters,
      populate: { vehicle: true, route: true, route_variant: true },
    });

    const latest = await loadLatestLocations({
      strapiInstance: strapi, allowSimulated: true, populateTrip: false,
      pairs: activeTrips.filter(trip => trip.vehicle && trip.route && trip.route_variant)
        .map(trip => ({ tripId: trip.documentId, vehicleId: trip.vehicle.documentId })),
    });
    const results = activeTrips.map((trip) => {
        if (!trip.vehicle || !trip.route || !trip.route_variant) {
          return null;
        }

        const location = latest.get(locationKey(trip.documentId, trip.vehicle.documentId));

        if (!location) {
          return null;
        }

        const dataMode = [trip.data_mode, trip.vehicle.data_mode, trip.route_variant.data_mode, location.data_mode]
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
          route_variant: {
            documentId: trip.route_variant.documentId,
            variant_code: trip.route_variant.variant_code,
            display_name: trip.route_variant.display_name,
            direction: trip.route_variant.direction,
            data_mode: trip.route_variant.data_mode,
          },
          latitude: location.latitude,
          longitude: location.longitude,
          speed: location.speed,
          heading: location.heading,
          recorded_at: location.recorded_at,
        };
      });

    ctx.body = { data: results.filter(Boolean) };
  },
};
