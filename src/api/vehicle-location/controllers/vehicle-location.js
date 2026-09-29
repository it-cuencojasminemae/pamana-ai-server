'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const {
  validateCoordinates,
  validateRecordedAt,
} = require('../../../services/driver-trip/driver-trip-policy');
const { ROLE, enforceRole } = require('../../../services/security/access-control');
const { consumeRateLimit, validateDataEnvelope } = require('../../../services/security/request-guard');

const GPS_FIELDS = ['latitude', 'longitude', 'speed', 'heading', 'recorded_at'];

module.exports = createCoreController('api::vehicle-location.vehicle-location', ({ strapi }) => ({
  async create(ctx) {
    if (!enforceRole(ctx, [ROLE.DRIVER])) return;
    if (!consumeRateLimit(ctx, 'driver-gps', { limit: 120, windowMs: 60_000 })) return;
    const envelope = validateDataEnvelope(ctx.request.body, { allowedFields: GPS_FIELDS, maxBytes: 4096 });
    if (!envelope.ok) return ctx.badRequest('GPS update contains unsupported or oversized data.');
    const userId = ctx.state.user?.id;
    if (!userId) return ctx.unauthorized('Authentication is required.');
    const driver = await strapi.documents('api::driver.driver').findFirst({
      filters: { user: { id: userId } },
      populate: ['vehicle'],
    });
    if (!driver) return ctx.badRequest('No driver profile linked to this account.');

    const activeTrip = await strapi.documents('api::trip.trip').findFirst({
      filters: { driver: { id: driver.id }, trip_status: 'active' },
      populate: { vehicle: { populate: ['active_route_variant'] }, route_variant: true },
    });
    if (!activeTrip?.vehicle || !activeTrip.route_variant) {
      return ctx.badRequest('No directional active trip. Start a route variant before sending GPS updates.');
    }
    if (!driver.vehicle || activeTrip.vehicle.id !== driver.vehicle.id) {
      return ctx.forbidden('The active trip does not belong to this driver vehicle.');
    }
    if (!activeTrip.vehicle.active_route_variant || activeTrip.vehicle.active_route_variant.id !== activeTrip.route_variant.id) {
      return ctx.forbidden('The active vehicle route variant does not match this trip.');
    }

    const { latitude, longitude, speed, heading, recorded_at } = envelope.data;
    const coordinates = validateCoordinates(latitude, longitude);
    if (!coordinates.valid) return ctx.badRequest('A valid non-zero latitude and longitude are required.');
    const timestamp = validateRecordedAt(recorded_at, { tripStartedAt: activeTrip.started_at });
    if (!timestamp.valid) return ctx.badRequest('The GPS timestamp is invalid for this active trip.');

    const numericSpeed = speed == null ? null : Number(speed);
    const numericHeading = heading == null ? null : Number(heading);
    if (numericSpeed != null && (!Number.isFinite(numericSpeed) || numericSpeed < 0)) {
      return ctx.badRequest('"speed" must be a non-negative number.');
    }
    if (numericHeading != null && (!Number.isFinite(numericHeading) || numericHeading < 0 || numericHeading > 360)) {
      return ctx.badRequest('"heading" must be between 0 and 360.');
    }
    const modes = [activeTrip.data_mode, activeTrip.vehicle.data_mode, activeTrip.route_variant.data_mode];
    if (new Set(modes).size !== 1) return ctx.forbidden('Trip, vehicle, and route variant data modes do not match.');

    const created = await strapi.documents('api::vehicle-location.vehicle-location').create({
      data: {
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        speed: numericSpeed,
        heading: numericHeading,
        recorded_at: timestamp.recordedAt,
        data_mode: activeTrip.data_mode,
        trip: activeTrip.id,
        vehicle: activeTrip.vehicle.id,
      },
    });
    ctx.status = 201;
    ctx.body = { data: {
      documentId: created.documentId,
      latitude: created.latitude,
      longitude: created.longitude,
      recorded_at: created.recorded_at,
      data_mode: created.data_mode,
    } };
  },
}));
