'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connect, manifest, snapshot } = require('./seed-phase5b-transfer-research');
const { buildTransportGraph } = require('../src/services/pamana-journey/graph-builder');
const { planJourneys } = require('../src/services/pamana-journey/journey-planner');

async function main() {
  const client = await connect();
  try {
    await client.query('begin read only');
    const variantCodes = manifest.variants.map((item) => item.variant_code);
    const variants = (await client.query(`
      select v.*, to_jsonb(r.*) as route, '[]'::jsonb as route_variant_stops
      from route_variants v
      left join route_variants_route_lnk link on link.route_variant_id = v.id
      left join routes r on r.id = link.route_id
      where v.variant_code = any($1::text[])
      order by v.variant_code`, [variantCodes])).rows;
    assert.equal(variants.length, variantCodes.length);
    assert.ok(variants.every((item) => item.planning_enabled === false));
    assert.ok(variants.every((item) => item.verification_status === 'CORROBORATED_RESEARCH'));
    assert.ok(variants.every((item) => item.operating_status === 'UNKNOWN'));

    const graph = buildTransportGraph({ variants }, { serviceDate: new Date('2026-09-25T00:00:00Z') });
    assert.equal(graph.variants.size, 0);
    assert.equal(graph.nodes.size, 0);
    assert.equal(graph.outgoing.size, 0);
    assert.equal(graph.excludedVariants.length, variantCodes.length);

    const endpointCodes = manifest.nodes.map((item) => item.node_code);
    const endpoints = (await client.query(`
      select document_id, node_code, latitude, longitude, planning_enabled,
             verification_status, data_mode
      from transport_nodes
      where node_code = any($1::text[])
      order by node_code`, [endpointCodes])).rows;
    assert.equal(endpoints.length, endpointCodes.length);
    for (const endpoint of endpoints) {
      assert.equal(endpoint.latitude, null);
      assert.equal(endpoint.longitude, null);
      assert.equal(endpoint.planning_enabled, false);
      assert.equal(endpoint.verification_status, 'CORROBORATED_RESEARCH');
      assert.equal(endpoint.data_mode, 'REAL');
    }

    const journeys = planJourneys(graph, {
      candidateBoardingNodeIds: [endpoints[0].document_id],
      candidateDestinationNodeIds: [endpoints[1].document_id],
    });
    assert.deepEqual(journeys, []);

    const eligibleCounts = (await client.query(`
      select
        (select count(*)::int from transport_nodes where planning_enabled is true) as nodes,
        (select count(*)::int from route_variants where planning_enabled is true) as variants,
        (select count(*)::int from route_variant_stops) as variant_stops`)).rows[0];
    assert.deepEqual(eligibleCounts, { nodes: 0, variants: 0, variant_stops: 0 });

    const state = await snapshot(client);
    const digest = crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex');
    console.log('ok - current Phase 5B PostgreSQL graph has zero production-eligible nodes, variants and variant stops');
    console.log('ok - unresolved research corridor returns zero deterministic journeys');
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
