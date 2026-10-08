'use strict';

const { STATUSES, availabilityForTrip } = require('./policy');
const TRIP_UID = 'api::trip.trip';
const fail = (code) => { throw new Error(code); };

async function lockTrip(strapi, trx, documentId) {
  const table = strapi.db.metadata.get(TRIP_UID).tableName;
  await trx(table).where({ document_id: documentId }).forUpdate().select('id');
}

async function reportAvailability(strapi, { userId, tripId, status }) {
  if (!STATUSES.includes(status)) fail('INVALID_STATUS');
  return strapi.db.transaction(async ({ trx }) => {
    // Serialize reports and trip ending; no audit is written after a trip ends.
    await lockTrip(strapi, trx, tripId);
    const trip = await strapi.documents(TRIP_UID).findOne({
      documentId: tripId, populate: { driver: true, vehicle: { populate: ['active_route_variant'] }, route: true, route_variant: true },
    });
    let driver = await strapi.documents('api::driver.driver').findFirst({
      filters: { user: { id: userId } }, populate: ['vehicle'],
    });
    if (driver && trip?.vehicle) {
      await trx(strapi.db.metadata.get('api::driver.driver').tableName).where({ id: driver.id }).forUpdate().select('id');
      await trx(strapi.db.metadata.get('api::vehicle.vehicle').tableName).where({ id: trip.vehicle.id }).forUpdate().select('id');
      driver = await strapi.documents('api::driver.driver').findFirst({ filters: { user: { id: userId } }, populate: ['vehicle'] });
    }
    if (!trip || !driver || trip.driver?.id !== driver.id || !trip.vehicle
      || driver.vehicle?.id !== trip.vehicle.id) fail('NOT_OWN_TRIP');
    if (trip.trip_status !== 'active' || !trip.route_variant || driver.driver_status !== 'active') fail('INACTIVE_TRIP');
    if (trip.vehicle.active_route_variant?.documentId !== trip.route_variant.documentId) fail('INACTIVE_TRIP');
    const modes = [driver, trip, trip.vehicle, trip.route, trip.route_variant].map(record => record?.data_mode);
    if (!['REAL', 'SIMULATED'].includes(trip.data_mode) || modes.some(mode => mode !== trip.data_mode)
      || (trip.data_mode === 'REAL' && trip.is_simulated === true)) fail('MODE_MISMATCH');
    const now = new Date();
    const previous = availabilityForTrip(trip, { now });
    if (previous.reportedAt && !previous.stale && previous.status === status) {
      return { availability: previous, duplicate: true };
    }
    const data = {
      availability_status: status,
      availability_source: trip.data_mode === 'SIMULATED' ? 'SIMULATION' : 'DRIVER',
      availability_reported_at: now.toISOString(),
    };
    await strapi.documents('api::vehicle-availability-report.vehicle-availability-report').create({
      data: { status, source: data.availability_source, reported_at: data.availability_reported_at,
        data_mode: trip.data_mode, trip: trip.id, vehicle: trip.vehicle.id, driver: driver.id },
    });
    await strapi.documents(TRIP_UID).update({ documentId: tripId, data });
    return { availability: availabilityForTrip({ ...trip, ...data }, { now }), duplicate: false };
  });
}

module.exports = { lockTrip, reportAvailability };
