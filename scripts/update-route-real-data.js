'use strict';

/**
 * Updates the pilot corridor only after a project member has field-verified
 * a current fare. The earlier default of PHP38 was based on a proposed March
 * 2026 fare increase that was suspended before implementation, so this script
 * deliberately has no hard-coded "real" fare anymore.
 *
 * Only SL-SF-01 (the direct "San Luis - City of San Fernando" route) is
 * touched. SL-SF-02 ("...via Santo Tomas Transfer") is left alone - the
 * report has no data specific to that synthetic transfer routing, and its
 * lower fare / higher time relative to SL-SF-01 looks like a deliberate
 * "cheaper but slower, more transfers" demo alternative (matching the
 * concept paper's Option A vs Option B framing), not a data error to fix.
 * See documentation/ai-data-dictionary.md for the full reasoning and the
 * ₱21 vs ~₱38 fare discrepancy this intentionally does NOT resolve by
 * picking one value - both are documented, only the computed one is stored.
 *
 * Usage example after verifying the posted matrix or conducting a field
 * survey:
 *   CONFIRMED_BASE_FARE=21 npm run update:route-real-data
 *
 * Usage: npm run update:route-real-data
 */

const { Client } = require('pg');

const ROUTE_CODE = 'SL-SF-01';
const BASE_FARE = Number(process.env.CONFIRMED_BASE_FARE);

async function main() {
  if (!Number.isFinite(BASE_FARE) || BASE_FARE < 0) {
    throw new Error(
      'A field-verified fare is required. Set CONFIRMED_BASE_FARE before running this script; do not use a proposed fare matrix as live data.'
    );
  }

  const client = new Client({
    host: process.env.DATABASE_HOST || '127.0.0.1',
    port: Number(process.env.DATABASE_PORT || 5432),
    database: process.env.DATABASE_NAME || 'pamana-db',
    user: process.env.DATABASE_USERNAME || 'postgres',
    password: process.env.DATABASE_PASSWORD,
  });

  await client.connect();

  try {
    const before = await client.query(
      'SELECT id, base_fare FROM routes WHERE route_code = $1',
      [ROUTE_CODE]
    );

    if (before.rows.length === 0) {
      console.error(`UPDATE-ROUTE-REAL-DATA: no route found with route_code "${ROUTE_CODE}". Nothing changed.`);
      process.exit(1);
    }

    const { id, base_fare: beforeFare } = before.rows[0];

    await client.query(
      `UPDATE routes
       SET base_fare = $1, updated_at = now()
       WHERE id = $3`,
      [BASE_FARE, id]
    );

    console.log(`Route ${ROUTE_CODE} (id ${id}) updated:`);
    console.log(`  base_fare: ${beforeFare} -> ${BASE_FARE}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('UPDATE-ROUTE-REAL-DATA FAILED:', error.message);
  process.exit(1);
});
