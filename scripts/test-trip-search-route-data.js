'use strict';

/**
 * LEGACY REGRESSION AUDIT for the former San Luis demo records.
 *
 * This is read-only. It deliberately checks the database relations that feed
 * /api/trip-search so a transfer stop or stop row cannot accidentally leak
 * into the direct-route result unnoticed.
 *
 * Usage: node --env-file=.env scripts/test-trip-search-route-data.js
 */

const assert = require('assert');
const { Client } = require('pg');

const REQUIRED_ROUTES = ['SL-SF-01', 'SL-SF-02'];

async function main() {
  const client = new Client({
    host: process.env.DATABASE_HOST || '127.0.0.1',
    port: Number(process.env.DATABASE_PORT || 5432),
    database: process.env.DATABASE_NAME || 'pamana-db',
    user: process.env.DATABASE_USERNAME || 'postgres',
    password: process.env.DATABASE_PASSWORD,
  });

  await client.connect();
  try {
    const routeResult = await client.query(
      "SELECT id, document_id, route_code, route_name, origin, destination, base_fare, estimated_travel_time, route_status FROM routes WHERE route_code IN ('SL-SF-01', 'SL-SF-02') ORDER BY route_code"
    );
    assert.deepStrictEqual(routeResult.rows.map((route) => route.route_code), REQUIRED_ROUTES);

    const stopResult = await client.query(
      "SELECT r.route_code, s.id, s.document_id, s.name, s.sequence, s.latitude, s.longitude, s.stop_type FROM routes r JOIN route_stops_route_lnk link ON link.route_id = r.id JOIN route_stops s ON s.id = link.route_stop_id WHERE r.route_code IN ('SL-SF-01', 'SL-SF-02') ORDER BY r.route_code, s.sequence"
    );
    const vehicleResult = await client.query(
      "SELECT r.route_code, v.id, v.document_id, v.vehicle_number, v.plate_number, v.vehicle_type, v.vehicle_status, v.occupancy_level FROM routes r JOIN vehicles_route_lnk link ON link.route_id = r.id JOIN vehicles v ON v.id = link.vehicle_id WHERE r.route_code IN ('SL-SF-01', 'SL-SF-02') ORDER BY r.route_code, v.vehicle_number"
    );

    const byRoute = Object.groupBy(stopResult.rows, (stop) => stop.route_code);
    const directStops = byRoute['SL-SF-01'] || [];
    const transferStops = byRoute['SL-SF-02'] || [];

    assert.deepStrictEqual(
      directStops.map((stop) => [stop.sequence, stop.name]),
      [
        [1, 'San Luis Public Market'],
        [2, 'Robinsons Starmills Transport Terminal'],
        [3, 'SM City Pampanga Transport Terminal 2'],
      ],
      'The direct route must retain its own ordered reference anchor stops.'
    );
    assert.ok(
      directStops.every((stop) => !/transfer/i.test(stop.name)),
      'The direct route must not contain a transfer-marked stop.'
    );
    assert.deepStrictEqual(
      transferStops.map((stop) => [stop.sequence, stop.name]),
      [
        [1, 'San Luis Public Market'],
        [2, 'Santo Tomas Transfer Point'],
        [3, 'SM City Pampanga Transport Terminal 2'],
      ],
      'The demo transfer route must retain its own ordered stops.'
    );
    assert.strictEqual(
      transferStops.filter((stop) => /transfer/i.test(stop.name)).length,
      1,
      'The demo transfer route must have exactly one explicit transfer stop.'
    );

    const directIds = new Set(directStops.map((stop) => stop.id));
    assert.ok(
      transferStops.every((stop) => !directIds.has(stop.id)),
      'No Route Stop row may be linked to both pilot routes.'
    );
    assert.ok(
      [...directStops, ...transferStops].every(
        (stop) => Number.isFinite(Number(stop.latitude)) && Number.isFinite(Number(stop.longitude))
      ),
      'Every stored pilot stop needs usable map coordinates.'
    );
    assert.deepStrictEqual(
      directStops.map((stop) => [Number(stop.latitude), Number(stop.longitude)]),
      [
        [15.03906, 120.78964],
        [15.04905, 120.69942],
        [15.05154, 120.69744],
      ],
      'The direct route must use only the agreed reference map anchors.'
    );

    // Exercise the real controller with the audited records and an empty
    // observed-trip/location history. That intentionally makes wait time a
    // fallback, while proving each comparison card retains its own stop list.
    const vehiclesByRoute = Object.groupBy(vehicleResult.rows, (vehicle) => vehicle.route_code);
    const controllerRoutes = routeResult.rows.map((route) => ({
      id: route.id,
      documentId: route.document_id,
      route_code: route.route_code,
      route_name: route.route_name,
      origin: route.origin,
      destination: route.destination,
      base_fare: Number(route.base_fare),
      estimated_travel_time: route.estimated_travel_time,
      route_status: route.route_status,
      route_stops: (byRoute[route.route_code] || []).map((stop) => ({
        id: stop.id,
        documentId: stop.document_id,
        name: stop.name,
        sequence: stop.sequence,
        latitude: Number(stop.latitude),
        longitude: Number(stop.longitude),
        stop_type: stop.stop_type,
      })),
      vehicles: (vehiclesByRoute[route.route_code] || []).map((vehicle) => ({
        id: vehicle.id,
        documentId: vehicle.document_id,
        vehicle_number: vehicle.vehicle_number,
        plate_number: vehicle.plate_number,
        vehicle_type: vehicle.vehicle_type,
        vehicle_status: vehicle.vehicle_status,
        occupancy_level: vehicle.occupancy_level,
      })),
    }));

    global.strapi = {
      documents(uid) {
        if (uid === 'api::route.route') return { findMany: async () => controllerRoutes };
        return { findMany: async () => [], findFirst: async () => null };
      },
    };
    const controller = require('../src/api/trip-search/controllers/trip-search');
    const ctx = {
      query: { origin: 'San Luis, Pampanga', destination: 'City of San Fernando, Pampanga' },
      badRequest: (message) => { throw new Error(message); },
    };
    await controller.search(ctx);

    const options = ctx.body.data.options;
    const optionFor = (field) => options.find((option) => option[field]);
    const cheapest = optionFor('is_cheapest');
    const fastest = optionFor('is_fastest');
    const mostReliable = optionFor('is_most_reliable');
    assert.strictEqual(cheapest.route_code, 'SL-SF-02');
    assert.strictEqual(fastest.route_code, 'SL-SF-01');
    assert.strictEqual(mostReliable.route_code, 'SL-SF-01');
    assert.strictEqual(mostReliable.vehicle.vehicle_number, 'SL-SF-JEEP-03');
    assert.strictEqual(mostReliable.transfer_count, 0);
    assert.ok(mostReliable.stops.every((stop) => !/transfer/i.test(stop.name)));
    assert.deepStrictEqual(
      mostReliable.stops.map((stop) => [stop.documentId, stop.latitude, stop.longitude]),
      directStops.map((stop) => [stop.document_id, Number(stop.latitude), Number(stop.longitude)])
    );
    assert.strictEqual(cheapest.transfer_count, 1);
    assert.ok(cheapest.stops.some((stop) => /transfer/i.test(stop.name)));
    assert.ok(
      !fastest.stops.some((stop) => stop.documentId === cheapest.transfer_stop.documentId),
      'Fastest map stops must not leak the Cheapest transfer stop.'
    );

    console.log('ok - direct route uses three non-transfer reference anchors in sequence');
    console.log('ok - simulated transfer route uses its own explicit transfer stop');
    console.log('ok - direct and transfer routes do not share Route Stop rows');
    console.log('ok - every pilot stop has finite map coordinates');
    console.log('ok - direct route coordinates match the agreed reference anchors');
    console.log('ok - Cheapest/Fastest/Most Reliable controller results retain their own route-stop coordinates');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exit(1);
});
