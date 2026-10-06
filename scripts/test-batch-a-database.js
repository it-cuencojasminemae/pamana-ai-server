'use strict';

const assert = require('node:assert/strict');
const { connect } = require('./seed-phase5b-transfer-research');
const { digest, counts, loadVariant, manifest: pilot } = require('./activate-pilot-field-verified');
const { seed, inventory, manifest } = require('./seed-batch-a-research');
const { buildTransportGraph } = require('../src/services/pamana-journey/graph-builder');
const { planJourneys } = require('../src/services/pamana-journey/journey-planner');
const { enrichJourneyInformation } = require('../src/services/pamana-journey/journey-information-enricher');

async function main() {
  const client = await connect();
  try {
    const before = { digest: await digest(client), counts: await counts(client) };
    await client.query('begin');
    const initial = await inventory(client);
    const dryRun = await seed(client);
    assert.equal(dryRun.filter(a => a.entity === 'route' && a.action === 'CREATE_RESEARCH').length, 1);
    assert.equal(dryRun.filter(a => a.entity === 'variant' && a.action === 'CREATE_RESEARCH').length, 3);
    assert.equal(await digest(client), before.digest);
    await seed(client, { apply: true });
    const once = { digest: await digest(client), counts: await counts(client) };
    const second = await seed(client, { apply: true });
    assert.ok(second.every(a => a.action === 'UNCHANGED'));
    assert.equal(await digest(client), once.digest, 'idempotent second run performs no writes');
    assert.equal(once.counts.routes - before.counts.routes, 1);
    assert.equal(once.counts.route_variants - before.counts.route_variants, 3);
    assert.equal(once.counts.route_variant_stops - before.counts.route_variant_stops, 6);
    assert.equal(once.counts.transport_nodes, before.counts.transport_nodes);
    assert.equal(once.counts.fare_rules, before.counts.fare_rules);
    assert.equal(once.counts.planning_routes, before.counts.planning_routes);
    assert.equal(once.counts.planning_variants, before.counts.planning_variants);
    const after = await inventory(client);
    for (const entity of ['routes', 'variants', 'nodes']) {
      for (const row of initial[entity]) assert.deepEqual(after[entity].find(r => r.id === row.id), row, 'existing evidence is unchanged');
    }
    for (const wanted of manifest.variants) {
      const variant = await loadVariant(client, wanted.variant_code);
      assert.equal(variant.planning_enabled, false);
      assert.equal(variant.verification_status, 'RESEARCH_CANDIDATE');
      assert.equal(variant.data_mode, 'REAL');
      assert.equal(variant.geometry_geojson, null);
      assert.equal(buildTransportGraph({ variants: [variant] }).variants.size, 0);
    }
    const variants = [];
    for (const wanted of pilot.variants) variants.push(await loadVariant(client, wanted.variant_code));
    const graph = buildTransportGraph({ variants });
    const journeys = planJourneys(graph, { candidateBoardingNodeIds: ['RCH-PSU-MEXICO-FRONT'],
      candidateDestinationNodeIds: ['RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF'] });
    assert.equal(journeys.length, 2);
    const enriched = journeys.map(j => enrichJourneyInformation(j, { requestedDeparture: '2026-10-04T08:00:00+08:00' }));
    const direct = enriched.find(j => j.transferCount === 0);
    const transfer = enriched.find(j => j.transferCount === 1);
    assert.equal(direct.legs[0].fare.status, 'KNOWN');
    assert.equal(direct.legs[0].fare.payableFare,27);
    assert.equal(transfer.legs[0].fare.payableFare, 100);
    assert.equal(transfer.legs[0].fare.sourceType, 'DEMO_ESTIMATE');
    assert.equal(transfer.legs[1].fare.payableFare, 14);
    assert.equal(transfer.fareSummary.knownSubtotal, 114);
    assert.equal(transfer.fareSummary.totalFare, 114);
    console.log('ok - audited live records; research seed adds 1 route / 3 variants / 6 stops with no duplicates or promotion');
    console.log('ok - two seed runs are idempotent; every existing route, node and variant is preserved');
    console.log('ok - existing direct and transfer journeys survive; approved road distances give calculated fares and a complete PHP 114 transfer total');
    await client.query('rollback');
    assert.equal(await digest(client), before.digest);
    assert.deepEqual(await counts(client), before.counts);
    console.log(`ok - rollback restored all transport rows; digest ${before.digest}`);
  } finally {
    await client.query('rollback');
    await client.end();
  }
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; });
