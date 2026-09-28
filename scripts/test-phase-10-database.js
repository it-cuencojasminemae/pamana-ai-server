'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connect, snapshot } = require('./seed-phase5b-transfer-research');
const { loadVariant, manifest } = require('./activate-pilot-field-verified');
const { buildTransportGraph } = require('../src/services/pamana-journey/graph-builder');
const { planJourneys } = require('../src/services/pamana-journey/journey-planner');

async function main() {
  const client = await connect();
  try {
    await client.query('begin read only');
    const variantCodes = manifest.variants.map((item) => item.variant_code).sort();
    const variants = [];
    for (const code of variantCodes) variants.push(await loadVariant(client, code));
    assert.equal(variants.length, variantCodes.length);
    assert.ok(variants.every((item) => item.planning_enabled === true));
    assert.ok(variants.every((item) => item.verification_status === 'FIELD_VERIFIED'));
    assert.ok(variants.every((item) => item.operating_status === 'ACTIVE'));

    const graph = buildTransportGraph({ variants }, { serviceDate: new Date('2026-09-28T00:00:00Z') });
    assert.equal(graph.variants.size, 4);
    assert.equal(graph.nodes.size, 4);
    assert.ok(graph.outgoing.size >= 3);
    assert.equal(graph.excludedVariants.length, 0);

    const endpointCodes = manifest.nodes.map((item) => item.node_code);
    const endpoints = (await client.query(`
      select document_id, node_code, latitude, longitude, planning_enabled,
             verification_status, data_mode
      from transport_nodes
      where node_code = any($1::text[])
      order by node_code`, [endpointCodes])).rows;
    assert.equal(endpoints.length, endpointCodes.length);
    for (const endpoint of endpoints) {
      assert.notEqual(endpoint.latitude, null);
      assert.notEqual(endpoint.longitude, null);
      assert.equal(endpoint.planning_enabled, true);
      assert.equal(endpoint.verification_status, 'FIELD_VERIFIED');
      assert.equal(endpoint.data_mode, 'REAL');
    }

    const journeys = planJourneys(graph, {
      candidateBoardingNodeIds: ['RCH-PSU-MEXICO-FRONT'],
      candidateDestinationNodeIds: ['RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF'],
    });
    assert.ok(journeys.some((journey) => journey.transferCount === 0));
    assert.ok(journeys.some((journey) => journey.transferCount === 1));

    const eligibleCounts = (await client.query(`
      select
        (select count(*)::int from transport_nodes where planning_enabled is true) as nodes,
        (select count(*)::int from route_variants where planning_enabled is true) as variants,
        (select count(*)::int from route_variant_stops) as variant_stops`)).rows[0];
    assert.deepEqual(eligibleCounts, { nodes: 4, variants: 4, variant_stops: 8 });

    const state = await snapshot(client);
    const digest = crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex');
    console.log('ok - approved pilot rows form a production-eligible directional graph');
    console.log('ok - activated PostgreSQL records return direct and one-transfer deterministic journeys');
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
