'use strict';

// Runs the actual HTTP controllers using short-lived application sessions.
// Removes only trips/locations created by this run and restores the demo vehicle.
const assert = require('node:assert/strict');
const { compileStrapi, createStrapi } = require('@strapi/strapi');
const { inspect, withEntryEvents, VEHICLE_NUMBER } = require('./seed-driver-demo');

async function main() {
  const username = process.argv.find(a => a.startsWith('--username='))?.slice(11) || 'driver';
  const app = await createStrapi(await compileStrapi()).load();
  const sessions = [], trips = [], locations = [];
  let vehicleBefore;
  try {
    const context = await inspect(app, username);
    assert.equal(context.driver?.vehicle?.vehicle_number, VEHICLE_NUMBER, 'Run seed-driver-demo.js --apply first.');
    vehicleBefore = await app.db.query('api::vehicle.vehicle').findOne({ where: { vehicle_number: VEHICLE_NUMBER } });
    assert.equal(vehicleBefore.vehicle_status, 'available', 'End the current demo trip before smoke testing.');
    assert.equal(await app.db.query('api::trip.trip').count({ where: { vehicle: { id: vehicleBefore.id }, trip_status: 'active' } }), 0);
    const observer = await app.db.query('plugin::users-permissions.user').findOne({ where: { blocked: false, role: { name: 'LGU' } } });
    assert.ok(observer, 'An LGU account is required to verify the observer live feed.');
    const manager = app.sessionManager('users-permissions');
    const tokenFor = async user => {
      const refresh = await manager.generateRefreshToken(String(user.id), undefined, { type: 'refresh', metadata: { purpose: 'simulated-driver-demo-smoke' } });
      sessions.push({ userId: String(user.id), id: refresh.sessionId });
      const access = await manager.generateAccessToken(refresh.token);
      assert.ok(!access.error);
      return access.token;
    };
    const driverToken = await tokenFor(context.user), observerToken = await tokenFor(observer);
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${app.server.httpServer.address().port}`;
    const request = async (path, { method = 'GET', data, token = driverToken, expected = 200, event, vehicleEvent = false } = {}) => {
      return withEntryEvents(app, async () => {
        const response = await fetch(`${base}${path}`, { method, signal: AbortSignal.timeout(15000), headers: {
          Authorization: `Bearer ${token}`, ...(data ? { 'Content-Type': 'application/json' } : {}),
        }, ...(data ? { body: JSON.stringify({ data }) } : {}) });
        const body = await response.json();
        assert.equal(response.status, expected, `${method} ${path}: ${body.error?.message || response.status}`);
        if (event === 'entry.create' && path === '/api/trips') trips.push(body.data.documentId);
        if (event === 'entry.create' && path === '/api/vehicle-locations') locations.push(body.data.documentId);
        return { body, events: [...(event ? [`${event}:${body.data.documentId}`] : []), ...(vehicleEvent ? [`entry.update:${vehicleBefore.documentId}`] : [])] };
      });
    };
    const options = (await request('/api/driver-trip-options')).body.data;
    assert.equal(options.emptyReason, null);
    assert.equal(options.vehicle.vehicleNumber, VEHICLE_NUMBER);
    const variants = options.routes.flatMap(r => r.variants);
    assert.deepEqual(variants.map(v => v.direction).sort(), ['INBOUND', 'OUTBOUND']);
    const position = { latitude: Number(context.nodes.PSU.latitude), longitude: Number(context.nodes.PSU.longitude) };
    await request('/api/vehicle-locations', { method: 'POST', data: position, expected: 400 });
    for (const direction of ['OUTBOUND', 'INBOUND']) {
      const variant = variants.find(v => v.direction === direction);
      const trip = (await request('/api/trips', { method: 'POST', data: { route_variant: variant.documentId }, expected: 201, event: 'entry.create', vehicleEvent: true })).body.data;
      assert.equal(trip.data_mode, 'SIMULATED');
      assert.equal(trip.is_simulated, true);
      const active = (await request('/api/driver-active-trip')).body.data;
      assert.equal(active.documentId, trip.documentId);
      assert.equal(active.vehicle.documentId, vehicleBefore.documentId);
      assert.equal(active.route_variant.documentId, variant.documentId);
      assert.equal(active.route_variant.route_variant_stops.length, 2);
      await request('/api/trips', { method: 'POST', data: { route_variant: variant.documentId }, expected: 400 });
      await request('/api/vehicle-locations', { method: 'POST', data: { latitude: 0, longitude: 0 }, expected: 400 });
      const gps = (await request('/api/vehicle-locations', { method: 'POST', data: { ...position, recorded_at: new Date().toISOString() }, expected: 201, event: 'entry.create' })).body.data;
      assert.equal(gps.data_mode, 'SIMULATED');
      for (const [count, state] of [[0, 'AVAILABLE'], [18, 'NEAR_FULL'], [20, 'FULL']]) {
        const occupancy = (await request(`/api/vehicles/${vehicleBefore.documentId}`, { method: 'PUT', data: { current_occupancy: count }, event: 'entry.update' })).body;
        assert.equal(occupancy.meta.occupancy, state);
        const feed = (await request('/api/live-vehicles', { token: observerToken })).body.data;
        const marker = feed.find(v => v.documentId === vehicleBefore.documentId);
        assert.ok(marker, 'LGU live feed includes demo vehicle after GPS.');
        assert.equal(marker.data_mode, 'SIMULATED');
        assert.equal(marker.route_variant.documentId, variant.documentId);
        assert.equal(marker.occupancy_level, count === 0 ? 'empty' : count === 18 ? 'near_full' : 'full');
      }
      await request(`/api/vehicles/${vehicleBefore.documentId}`, { method: 'PUT', data: { current_occupancy: 21 }, expected: 400 });
      await request(`/api/trips/${trip.documentId}`, { method: 'PUT', data: { trip_status: 'completed' }, event: 'entry.update', vehicleEvent: true });
      assert.equal((await request('/api/driver-active-trip')).body.data, null);
      assert.equal((await request('/api/live-vehicles', { token: observerToken })).body.data.some(v => v.documentId === vehicleBefore.documentId), false);
      const history = (await request('/api/trips?filters[trip_status][$eq]=completed')).body.data;
      assert.ok(history.some(t => t.documentId === trip.documentId));
      console.log(`PASS ${direction}: start, duplicate rejection, active assignment/stops, GPS, LGU live feed, occupancy bounds, end, history.`);
    }
  } finally {
    // Query-engine deletion avoids asynchronous document events during cleanup.
    for (const documentId of locations) await app.db.query('api::vehicle-location.vehicle-location').delete({ where: { documentId, data_mode: 'SIMULATED' } });
    for (const documentId of trips) await app.db.query('api::trip.trip').delete({ where: { documentId, data_mode: 'SIMULATED', vehicle: { vehicle_number: VEHICLE_NUMBER } } });
    if (vehicleBefore && trips.length) {
      await app.db.query('api::vehicle.vehicle').update({ where: { id: vehicleBefore.id }, data: {
        current_occupancy: vehicleBefore.current_occupancy, occupancy_level: vehicleBefore.occupancy_level,
        vehicle_status: vehicleBefore.vehicle_status, active_route_variant: null,
      } });
      await app.db.connection('vehicles').where({ id: vehicleBefore.id }).update({ updated_at: vehicleBefore.updatedAt });
    }
    for (const session of sessions) await app.sessionManager('users-permissions').revokeSessionById(session.userId, session.id);
    await app.destroy();
  }
  console.log('PASS cleanup: smoke trips, GPS records, and temporary sessions removed; demo vehicle ready. Phone GPS remains a manual test.');
}
main().catch(error => { console.error(`Driver demo smoke failed: ${error.message}`); process.exitCode = 1; });
