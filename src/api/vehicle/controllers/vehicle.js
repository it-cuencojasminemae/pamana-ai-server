'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { occupancyForCount } = require('../../../services/driver-trip/driver-trip-policy');
const { ROLE, enforceRole, normalizedRoleName } = require('../../../services/security/access-control');
const { consumeRateLimit, validateDataEnvelope } = require('../../../services/security/request-guard');

module.exports = createCoreController('api::vehicle.vehicle', ({ strapi }) => ({
  async update(ctx) {
    if (!enforceRole(ctx, [ROLE.DRIVER, ROLE.ADMINISTRATOR])) return;
    const userId = ctx.state.user?.id;
    const driver = userId ? await strapi.documents('api::driver.driver').findFirst({
      filters: { user: { id: userId } }, populate: ['vehicle'],
    }) : null;

    // Administrator behavior remains governed by Strapi permissions and the
    // core controller. Driver writes use the restricted branch below.
    if (!driver) return normalizedRoleName(ctx.state.user) === ROLE.ADMINISTRATOR ? super.update(ctx) : ctx.forbidden();
    if (!driver.vehicle || driver.vehicle.documentId !== ctx.params.id) return ctx.notFound();
    if (!consumeRateLimit(ctx, 'driver-occupancy', { limit: 30, windowMs: 60_000 })) return;
    const envelope = validateDataEnvelope(ctx.request.body, { allowedFields: ['current_occupancy'], maxBytes: 1024 });
    if (!envelope.ok) return ctx.badRequest('Occupancy update contains unsupported or oversized data.');

    const activeTrip = await strapi.documents('api::trip.trip').findFirst({
      filters: {
        driver: { id: driver.id },
        vehicle: { id: driver.vehicle.id },
        trip_status: 'active',
      },
      populate: ['route_variant'],
    });
    if (!activeTrip?.route_variant) return ctx.badRequest('Start a directional trip before updating occupancy.');

    const occupancy = occupancyForCount(envelope.data.current_occupancy, driver.vehicle.capacity);
    if (!occupancy.valid) return ctx.badRequest('Occupancy must be a whole number within vehicle capacity.');

    const updated = await strapi.documents('api::vehicle.vehicle').update({
      documentId: driver.vehicle.documentId,
      data: {
        current_occupancy: occupancy.count,
        occupancy_level: occupancy.level,
        vehicle_status: occupancy.normalized === 'FULL' ? 'full' : 'in_transit',
      },
    });
    ctx.body = {
      data: {
        documentId: updated.documentId,
        current_occupancy: updated.current_occupancy,
        occupancy_level: updated.occupancy_level,
        vehicle_status: updated.vehicle_status,
      },
      meta: { occupancy: occupancy.normalized },
    };
  },
}));
