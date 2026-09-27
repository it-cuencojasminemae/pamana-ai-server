'use strict';

const { createCoreController } = require('@strapi/strapi').factories;
const { occupancyForCount } = require('../../../services/driver-trip/driver-trip-policy');

module.exports = createCoreController('api::vehicle.vehicle', ({ strapi }) => ({
  async update(ctx) {
    const userId = ctx.state.user?.id;
    const driver = userId ? await strapi.documents('api::driver.driver').findFirst({
      filters: { user: { id: userId } }, populate: ['vehicle'],
    }) : null;

    // Administrator/LGU behavior remains governed by Strapi permissions and
    // the core controller. Driver writes use the restricted branch below.
    if (!driver) return super.update(ctx);
    if (!driver.vehicle || driver.vehicle.documentId !== ctx.params.id) return ctx.notFound();

    const activeTrip = await strapi.documents('api::trip.trip').findFirst({
      filters: {
        driver: { id: driver.id },
        vehicle: { id: driver.vehicle.id },
        trip_status: 'active',
      },
      populate: ['route_variant'],
    });
    if (!activeTrip?.route_variant) return ctx.badRequest('Start a directional trip before updating occupancy.');

    const occupancy = occupancyForCount(ctx.request.body?.data?.current_occupancy, driver.vehicle.capacity);
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
