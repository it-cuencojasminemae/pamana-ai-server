'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connect, snapshot } = require('./seed-phase5b-transfer-research');
const { findAccessNodes } = require('../src/services/pamana-journey/access-node-finder');

const EXPECTED_PHASE_10_DIGEST = require('./helpers/pilot-geometry-expectations').EXPECTED_DIGEST;
const PROTECTED_NODE_CODES = [
  'RCH-PSU-MEXICO-FRONT',
  'RCH-MEXICO-BAYAN-STA-MONICA-TRANSFER',
  'RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF',
  'RCH-ROB-STARMILLS-ARAYAT-GATE-LOAD',
];
const PROTECTED_VARIANT_CODES = ['RCH-SJ-SMROB-OUT', 'RCH-SJ-SMROB-IN'];

async function main() {
  const client = await connect();
  try {
    await client.query('begin read only');
    const eligibleNodes = (await client.query(`
      select id, document_id as "documentId", node_code, name, node_type,
             latitude, longitude, planning_enabled, verification_status,
             data_mode, verified_at, source_name, source_url, source_reference
      from transport_nodes
      where planning_enabled is true
        and data_mode = 'REAL'
        and verification_status in ('AUTHORITATIVE_CURRENT', 'FIELD_VERIFIED')
        and latitude is not null
        and longitude is not null
      order by node_code`)).rows;
    assert.equal(eligibleNodes.length, 4);

    const discovery = await findAccessNodes({
      point: { lat: 14.6, lng: 120.98 },
      nodes: eligibleNodes,
      router: { routeWalk: async () => { throw new Error('No routing call is expected outside the pilot radius'); } },
    });
    assert.deepEqual(discovery.candidates, []);
    assert.deepEqual(discovery.failures, []);

    const protectedNodes = (await client.query(`
      select node_code, latitude, longitude, planning_enabled, verification_status, data_mode
      from transport_nodes
      where node_code = any($1::text[])
      order by node_code`, [PROTECTED_NODE_CODES])).rows;
    assert.equal(protectedNodes.length, PROTECTED_NODE_CODES.length);
    for (const record of protectedNodes) {
      assert.notEqual(record.latitude, null);
      assert.notEqual(record.longitude, null);
      assert.equal(record.planning_enabled, true);
      assert.equal(record.verification_status, 'FIELD_VERIFIED');
      assert.equal(record.data_mode, 'REAL');
    }

    const protectedVariants = (await client.query(`
      select variant_code, planning_enabled, verification_status, operating_status,
             encoded_polyline, geometry_geojson
      from route_variants
      where variant_code = any($1::text[])
      order by variant_code`, [PROTECTED_VARIANT_CODES])).rows;
    assert.equal(protectedVariants.length, PROTECTED_VARIANT_CODES.length);
    for (const record of protectedVariants) {
      assert.equal(record.planning_enabled, true);
      assert.equal(record.verification_status, 'FIELD_VERIFIED');
      assert.equal(record.operating_status, 'ACTIVE');
      assert.equal(record.encoded_polyline, null);
      require('./helpers/pilot-geometry-expectations').assertPilotGeometry(record);
    }

    const state = await snapshot(client);
    const digest = crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex');
    assert.equal(digest, EXPECTED_PHASE_10_DIGEST, 'Phase 11 must not modify PostgreSQL transport rows');
    console.log('ok - current PostgreSQL data has exactly four eligible coordinate-bearing pilot access nodes');
    console.log('ok - approved variants are active and geometry matches the application checkpoint');
    console.log(`Transport row digest: ${digest}`);
  } finally {
    await client.query('rollback');
    await client.end();
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
