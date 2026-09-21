'use strict';

/**
 * Applies the agreed reference anchors to the two San Luis pilot routes.
 *
 * The direct route is intentionally an approximate corridor between stored
 * reference stops, not a claim of verified jeepney road geometry. The only
 * simulated location retained is the explicitly named Santo Tomas transfer
 * point on SL-SF-02. This script updates links in one transaction and leaves
 * unlinked legacy Route Stop rows intact for auditability.
 *
 * Usage: node --env-file=.env scripts/update-pilot-corridor-reference-anchors.js
 */

const crypto = require('crypto');
const { Client } = require('pg');

const DIRECT_STOPS = [
  { name: 'San Luis Public Market', sequence: 1, latitude: 15.03906, longitude: 120.78964, stop_type: 'terminal', covered_waiting_area: true },
  { name: 'Robinsons Starmills Transport Terminal', legacyNames: ['Santo Tomas Stop'], sequence: 2, latitude: 15.04905, longitude: 120.69942, stop_type: 'both', covered_waiting_area: true },
  { name: 'SM City Pampanga Transport Terminal 2', legacyNames: ['SM City San Fernando'], sequence: 3, latitude: 15.05154, longitude: 120.69744, stop_type: 'terminal', covered_waiting_area: true },
];

const TRANSFER_STOPS = [
  { name: 'San Luis Public Market', sequence: 1, latitude: 15.03906, longitude: 120.78964, stop_type: 'terminal', covered_waiting_area: true },
  // This coordinate remains a deliberately simulated transfer point until a
  // verified source is supplied. It is never used by the direct route.
  { name: 'Santo Tomas Transfer Point', sequence: 2, latitude: 15.1206, longitude: 120.7188, stop_type: 'both', covered_waiting_area: false },
  { name: 'SM City Pampanga Transport Terminal 2', legacyNames: ['SM City San Fernando'], sequence: 3, latitude: 15.05154, longitude: 120.69744, stop_type: 'terminal', covered_waiting_area: true },
];

const documentId = () => crypto.randomBytes(16).toString('hex').slice(0, 24);

async function updateRouteStops(client, routeCode, desiredStops) {
  const route = await client.query('SELECT id FROM routes WHERE route_code = $1 LIMIT 1', [routeCode]);
  if (!route.rows.length) throw new Error(`Route ${routeCode} was not found.`);
  const routeId = route.rows[0].id;
  const current = await client.query(
    `SELECT s.id, s.name FROM route_stops s
     JOIN route_stops_route_lnk link ON link.route_stop_id = s.id
     WHERE link.route_id = $1`,
    [routeId]
  );
  const selectedIds = [];

  for (const stop of desiredStops) {
    const acceptedNames = new Set([stop.name, ...(stop.legacyNames || [])]);
    const existing = current.rows.find((row) => acceptedNames.has(row.name));
    let stopId;
    if (existing) {
      stopId = existing.id;
      await client.query(
        `UPDATE route_stops SET name = $1, sequence = $2, latitude = $3, longitude = $4,
         stop_type = $5, covered_waiting_area = $6, accessible_toilet_nearby = false,
         updated_at = now() WHERE id = $7`,
        [stop.name, stop.sequence, stop.latitude, stop.longitude, stop.stop_type, stop.covered_waiting_area, stopId]
      );
    } else {
      const inserted = await client.query(
        `INSERT INTO route_stops (document_id, name, sequence, latitude, longitude, stop_type,
         covered_waiting_area, accessible_toilet_nearby, created_at, updated_at, published_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, false, now(), now(), now()) RETURNING id`,
        [documentId(), stop.name, stop.sequence, stop.latitude, stop.longitude, stop.stop_type, stop.covered_waiting_area]
      );
      stopId = inserted.rows[0].id;
      await client.query('INSERT INTO route_stops_route_lnk (route_stop_id, route_id) VALUES ($1, $2)', [stopId, routeId]);
    }
    selectedIds.push(stopId);
  }

  // Do not delete legacy records; only remove obsolete route membership so
  // the Trip Planner cannot render old OGC/Santo Tomas direct-route stops.
  await client.query(
    'DELETE FROM route_stops_route_lnk WHERE route_id = $1 AND NOT (route_stop_id = ANY($2::int[]))',
    [routeId, selectedIds]
  );
}

async function main() {
  const client = new Client({
    host: process.env.DATABASE_HOST || '127.0.0.1', port: Number(process.env.DATABASE_PORT || 5432),
    database: process.env.DATABASE_NAME || 'pamana-db', user: process.env.DATABASE_USERNAME || 'postgres',
    password: process.env.DATABASE_PASSWORD,
  });
  await client.connect();
  await client.query('BEGIN');
  try {
    await updateRouteStops(client, 'SL-SF-01', DIRECT_STOPS);
    await updateRouteStops(client, 'SL-SF-02', TRANSFER_STOPS);
    await client.query('COMMIT');
    console.log('Pilot reference anchors applied. Direct route is now a 3-stop approximate corridor.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`PILOT CORRIDOR UPDATE FAILED: ${error.message}`);
  process.exit(1);
});
