'use strict';

/**
 * One-off migration for the `is_simulated` field added to
 * src/api/trip/content-types/trip/schema.json. No migrations/ file is used
 * in this project (database/migrations/ is empty) - schema changes are
 * normally picked up by Strapi's own dev-mode DB sync on next boot, but this
 * applies the matching column directly so the fix is effective immediately
 * without requiring a server restart first. Idempotent (IF NOT EXISTS) -
 * safe to re-run, and safe if Strapi's own sync later finds the column
 * already matches the schema.
 *
 * Why this field exists: predictWaitTime() (services/pamana-ai/wait-time.js)
 * averages ALL completed Trip.started_at intervals with no filter. Once
 * Phase 21 (Simulation Engine, not yet built) starts writing demo Trips,
 * this field lets that prediction exclude them - see the accompanying
 * change to wait-time.js.
 *
 * Usage: node --env-file=.env scripts/migrate-add-trip-is-simulated.js
 */

const { Client } = require('pg');

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
    await client.query(
      `ALTER TABLE trips ADD COLUMN IF NOT EXISTS is_simulated boolean NOT NULL DEFAULT false`
    );
    console.log('trips.is_simulated column present (added, or already existed).');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('MIGRATE-ADD-TRIP-IS-SIMULATED FAILED:', error.message);
  process.exit(1);
});
