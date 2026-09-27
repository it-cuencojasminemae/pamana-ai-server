'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const {
  driverVariantEligibility,
  endTripData,
  startTripData,
} = require('../../../services/driver-trip/driver-trip-policy');

const ownDriver = (strapi, userId) => strapi.documents('api::driver.driver').findFirst({
  filters: { user: { id: userId } },
  populate: { vehicle: { populate: ['route'] } },
});

const activeTripForDriver = (strapi, driverId) => strapi.documents('api::trip.trip').findFirst({
  filters: { driver: { id: driverId }, trip_status: 'active' },
  populate: ['vehicle', 'route', 'route_variant'],
});

const endpointLabel = (node, fallback) => node?.name || node?.node_name || fallback || 'Endpoint not verified';

module.exports = createCoreController('api::trip.trip', ({ strapi }) => ({
  async active(ctx) {
    const userId = ctx.state.user?.id;
    if (!userId) return ctx.unauthorized('Authentication is required.');
    const driver = await ownDriver(strapi, userId);
    if (!driver) return ctx.badRequest('No driver profile linked to this account.');
    const trip = await strapi.documents('api::trip.trip').findFirst({
      filters: { driver: { id: driver.id }, trip_status: 'active' },
      populate: {
        vehicle: true,
        route: true,
        route_variant: {
          populate: { route_variant_stops: { populate: ['transport_node'] } },
        },
      },
    });
    if (!trip) {
      ctx.body = { data: null };
      return;
    }
    ctx.body = {
      data: {
        documentId: trip.documentId,
        direction: trip.direction,
        data_mode: trip.data_mode,
        started_at: trip.started_at,
        route: trip.route ? {
          documentId: trip.route.documentId,
          route_code: trip.route.route_code,
          route_name: trip.route.route_name,
          origin: trip.route.origin,
          destination: trip.route.destination,
        } : null,
        vehicle: trip.vehicle ? {
          documentId: trip.vehicle.documentId,
          vehicle_number: trip.vehicle.vehicle_number,
          plate_number: trip.vehicle.plate_number,
          capacity: trip.vehicle.capacity ?? null,
          current_occupancy: trip.vehicle.current_occupancy ?? null,
          occupancy_level: trip.vehicle.occupancy_level ?? null,
        } : null,
        route_variant: trip.route_variant ? {
          documentId: trip.route_variant.documentId,
          variant_code: trip.route_variant.variant_code,
          display_name: trip.route_variant.display_name,
          direction: trip.route_variant.direction,
          signboard_text: trip.route_variant.signboard_text || null,
          geometry_geojson: trip.route_variant.geometry_geojson || null,
          route_variant_stops: (trip.route_variant.route_variant_stops || []).map((stop) => ({
            documentId: stop.documentId,
            sequence: stop.sequence,
            pickup_allowed: stop.pickup_allowed,
            dropoff_allowed: stop.dropoff_allowed,
            transfer_allowed: stop.transfer_allowed,
            transport_node: stop.transport_node ? {
              documentId: stop.transport_node.documentId,
              name: stop.transport_node.name,
              node_code: stop.transport_node.node_code,
              latitude: stop.transport_node.latitude ?? null,
              longitude: stop.transport_node.longitude ?? null,
              node_type: stop.transport_node.node_type,
              data_mode: stop.transport_node.data_mode,
              verification_status: stop.transport_node.verification_status,
              planning_enabled: stop.transport_node.planning_enabled,
            } : null,
          })),
        } : null,
      },
    };
  },

  async options(ctx) {
    const userId = ctx.state.user?.id;
    if (!userId) return ctx.unauthorized('Authentication is required.');
    const driver = await ownDriver(strapi, userId);
    if (!driver) return ctx.badRequest('No driver profile linked to this account.');

    const vehicle = driver.vehicle;
    if (!vehicle) {
      ctx.body = { data: { vehicle: null, routes: [], emptyReason: 'NO_ASSIGNED_VEHICLE' } };
      return;
    }
    const route = vehicle.route;
    if (!route) {
      ctx.body = {
        data: {
          vehicle: { documentId: vehicle.documentId, vehicleNumber: vehicle.vehicle_number, plateNumber: vehicle.plate_number },
          routes: [], emptyReason: 'NO_ASSIGNED_ROUTE',
        },
      };
      return;
    }

    const candidates = await strapi.documents('api::route-variant.route-variant').findMany({
      filters: { route: { id: route.id } },
      populate: ['route', 'start_node', 'end_node'],
      sort: ['direction:asc', 'display_name:asc'],
    });
    const variants = candidates.filter((variant) => driverVariantEligibility({ driver, vehicle, route, variant }).eligible);
    const activeTrip = await activeTripForDriver(strapi, driver.id);
    ctx.body = {
      data: {
        vehicle: {
          documentId: vehicle.documentId,
          vehicleNumber: vehicle.vehicle_number,
          plateNumber: vehicle.plate_number,
          capacity: vehicle.capacity ?? null,
          dataMode: vehicle.data_mode,
        },
        routes: [{
          documentId: route.documentId,
          routeCode: route.route_code,
          routeName: route.route_name,
          origin: route.origin,
          destination: route.destination,
          variants: variants.map((variant) => ({
            documentId: variant.documentId,
            variantCode: variant.variant_code,
            displayName: variant.display_name,
            direction: variant.direction,
            origin: endpointLabel(variant.start_node, route.origin),
            destination: endpointLabel(variant.end_node, route.destination),
            signboard: variant.signboard_text || null,
            operatingStatus: variant.operating_status,
            dataMode: variant.data_mode,
          })),
        }],
        activeTripDocumentId: activeTrip?.documentId || null,
        emptyReason: variants.length ? null : 'NO_ELIGIBLE_VARIANTS',
      },
    };
  },

  async create(ctx) {
    const userId = ctx.state.user?.id;
    if (!userId) return ctx.unauthorized('Authentication is required.');
    const driver = await ownDriver(strapi, userId);
    if (!driver) return ctx.badRequest('No driver profile linked to this account.');
    if (!driver.vehicle) return ctx.badRequest('No vehicle assigned to this driver.');

    const routeVariantDocumentId = ctx.request.body?.data?.route_variant;
    if (typeof routeVariantDocumentId !== 'string' || !routeVariantDocumentId.trim()) {
      return ctx.badRequest('A directional "route_variant" is required.');
    }

    const [driverConflict, vehicleConflict, variant] = await Promise.all([
      activeTripForDriver(strapi, driver.id),
      strapi.documents('api::trip.trip').findFirst({
        filters: { vehicle: { id: driver.vehicle.id }, trip_status: 'active' },
      }),
      strapi.documents('api::route-variant.route-variant').findOne({
        documentId: routeVariantDocumentId,
        populate: ['route', 'start_node', 'end_node'],
      }),
    ]);
    if (driverConflict || vehicleConflict) {
      return ctx.badRequest('This driver or vehicle already has an active trip. End it before starting another one.');
    }

    const route = variant?.route;
    const start = startTripData({ driver, vehicle: driver.vehicle, route, variant });
    if (!start.valid) {
      return ctx.badRequest('The selected directional route variant is not available for this driver and vehicle.');
    }

    const created = await strapi.documents('api::trip.trip').create({
      data: start.data,
      populate: ['vehicle', 'route', 'route_variant'],
    });

    await strapi.documents('api::vehicle.vehicle').update({
      documentId: driver.vehicle.documentId,
      data: { vehicle_status: 'in_transit', active_route_variant: variant.id },
    });
    const sanitized = await this.sanitizeOutput(created, ctx);
    ctx.status = 201;
    return this.transformResponse(sanitized);
  },

  async update(ctx) {
    const userId = ctx.state.user?.id;
    if (!userId) return ctx.unauthorized('Authentication is required.');
    const driver = await ownDriver(strapi, userId);
    if (!driver) return ctx.notFound();
    const trip = await strapi.documents('api::trip.trip').findOne({
      documentId: ctx.params.id,
      populate: ['driver', 'vehicle', 'route_variant'],
    });
    if (!trip || trip.driver?.id !== driver.id) return ctx.notFound();
    if (trip.trip_status !== 'active') return ctx.badRequest('Only an active trip can be ended.');

    const ending = endTripData(ctx.request.body?.data?.trip_status);
    if (!ending.valid) {
      return ctx.badRequest('"trip_status" must be "completed" or "cancelled".');
    }
    const updated = await strapi.documents('api::trip.trip').update({
      documentId: trip.documentId,
      data: ending.data,
      populate: ['vehicle', 'route', 'route_variant'],
    });
    if (trip.vehicle) {
      await strapi.documents('api::vehicle.vehicle').update({
        documentId: trip.vehicle.documentId,
        data: { vehicle_status: 'available', active_route_variant: null },
      });
    }
    const sanitized = await this.sanitizeOutput(updated, ctx);
    return this.transformResponse(sanitized);
  },

  async find(ctx) {
    const driver = ctx.state.user?.id ? await ownDriver(strapi, ctx.state.user.id) : null;
    if (driver) {
      const ownTrips = await strapi.documents('api::trip.trip').findMany({
        filters: { driver: { id: driver.id } }, fields: ['id'],
      });
      const ownIds = ownTrips.map((trip) => trip.id);
      ctx.query = { ...ctx.query, filters: { ...(ctx.query.filters || {}), id: { $in: ownIds.length ? ownIds : [-1] } } };
    }
    return super.find(ctx);
  },

  async findOne(ctx) {
    const driver = ctx.state.user?.id ? await ownDriver(strapi, ctx.state.user.id) : null;
    if (driver) {
      const trip = await strapi.documents('api::trip.trip').findOne({ documentId: ctx.params.id, populate: ['driver'] });
      if (!trip || trip.driver?.id !== driver.id) return ctx.notFound();
    }
    return super.findOne(ctx);
  },
}));

module.exports.ownDriver = ownDriver;
module.exports.activeTripForDriver = activeTripForDriver;
