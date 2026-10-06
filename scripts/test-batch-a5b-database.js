'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { connect } = require('./seed-phase5b-transfer-research');
const { digest, counts } = require('./activate-pilot-field-verified');
const { manifest, loadCandidateArtifacts, loadTargets, planVariant, databaseSnapshot } = require('./apply-batch-a5b-approved-geometry');
const { EXPECTED_DIGEST, COUNTS } = require('./fixtures/approved-pilot-geometry');
const { segmentLength, assertNoSecrets } = require('./generate-batch-a5-candidates');
const { buildTransportGraph } = require('../src/services/pamana-journey/graph-builder');
const { planJourneys } = require('../src/services/pamana-journey/journey-planner');
const { enrichJourneyInformation } = require('../src/services/pamana-journey/journey-information-enricher');
const { rawJeepneyFare } = require('../src/services/pamana-journey/fare-policy');
async function main() {
  const client = await connect();
  try {
    await client.query('begin isolation level repeatable read read only');
    const baseline = await databaseSnapshot(client);
    assert.equal(await digest(client), EXPECTED_DIGEST); assert.deepEqual(await counts(client), COUNTS);
    const candidates = loadCandidateArtifacts(), variants = await loadTargets(client, candidates);
    variants.forEach((v, i) => {
      const p = planVariant(v, candidates[i]); assert.equal(p.action, 'UNCHANGED');
      assert.deepEqual(v.geometry_geojson, candidates[i].geometry); assert.equal(v.geometry_source, 'MANUAL_VERIFIED');
      assert.equal(v.verification_status, 'FIELD_VERIFIED'); assert.equal(v.data_mode, 'REAL'); assert.equal(v.planning_enabled, true);
      assert.deepEqual(v.route_variant_stops.map(s => s.distance_from_variant_start_m), [0, p.stored_road_distance_m]);
      const chord = segmentLength(candidates[i].definition.origin_coordinates, candidates[i].definition.destination_coordinates);
      assert.ok(Math.abs(p.stored_road_distance_m - chord) > 100, 'Fare distance must follow road bends, not endpoint chord');
      assertNoSecrets(JSON.stringify({ geometry: v.geometry_geojson, notes: v.notes }), process.env.GEOAPIFY_SERVER_API_KEY);
    });
    const graph = buildTransportGraph({ variants });
    const journeys = (from, to, category = 'REGULAR') => planJourneys(graph, { candidateBoardingNodeIds: [from], candidateDestinationNodeIds: [to] })
      .map(j => enrichJourneyInformation(j, { requestedDeparture: '2026-10-05T08:00:00+08:00', passengerCategory: category }));
    const psu = manifest.approved[0].origin_node_code, sm = manifest.approved[0].destination_node_code,
      rob = manifest.approved[1].origin_node_code, mexico = manifest.approved[2].origin_node_code;
    const summary = [];
    for (const category of ['REGULAR', 'STUDENT']) for (const [from, to] of [[psu, sm], [rob, psu], [mexico, sm], [psu, mexico]]) {
      const results = journeys(from, to, category); assert.ok(results.length);
      for (const journey of results) {
        const legs = journey.legs.filter(l => l.type === 'TRANSIT');
        assert.equal(journey.transferCount, legs.length - 1);
        let total = 0;
        for (const leg of legs) {
          assert.equal(leg.fare.status, 'KNOWN'); assert.ok(Number.isInteger(leg.fare.payableFare));
          assert.equal(leg.roadDistanceSource, 'STORED_ROUTE_STOP_DISTANCE');
          if (leg.transportMode === 'TRICYCLE') {
            assert.equal(leg.fare.payableFare, 100); assert.equal(leg.fare.sourceType, 'DEMO_ESTIMATE'); assert.equal(leg.fare.discountedFare, null);
          } else {
            const raw = rawJeepneyFare(leg.transportMode, leg.segmentDistanceMeters);
            assert.equal(leg.fare.sourceType, 'SYSTEM_CALCULATED'); assert.equal(leg.fare.regularFare, Math.round(raw));
            assert.equal(leg.fare.discountedFare, Math.round(raw * 0.8));
            assert.equal(leg.fare.payableFare, category === 'REGULAR' ? Math.round(raw) : Math.round(raw * 0.8));
          }
          total += leg.fare.payableFare;
        }
        assert.equal(journey.fareSummary.totalStatus, 'KNOWN'); assert.equal(journey.fareSummary.totalFare, total);
        assert.equal(journey.fareSummary.knownSubtotal, total);
        if (legs.length === 2) { assert.equal(journey.transferCount, 1); assert.equal(total, category === 'REGULAR' ? 114 : 111); }
        summary.push({ from, to, category, transfers: journey.transferCount, total_php: total,
          legs: legs.map(l => ({ variant: l.variantCode, mode: l.transportMode, distance_m: l.segmentDistanceMeters, road_source: l.roadDistanceSource, fare: l.fare })) });
      }
    }
    const direct = journeys(psu, sm).find(j => j.transferCount === 0), inbound = journeys(rob, psu)[0], onward = journeys(mexico, sm)[0];
    assert.deepEqual([direct.legs[0].fare.payableFare, inbound.legs[0].fare.payableFare, onward.legs[0].fare.payableFare], [27, 28, 14]);
    assert.equal(buildTransportGraph({ variants: variants.map(v => ({ ...v, data_mode: 'SIMULATED' })) }).variants.size, 0);
    const researchCodes = ['RCH-PSU-MEXICO-BAYAN-JEEP-OUT', 'RCH-MEX-CSF-SM-ROB-BAYAN-IN', 'RCH-MEX-CSF-SM-BAYAN-ROB-OUT'];
    assert.equal((await client.query('select count(*)::int n from route_variants where variant_code=any($1::text[])', [researchCodes])).rows[0].n, 0);
    assert.equal((await client.query("select count(*)::int n from routes where route_code='RCH-PSU-MEXICO-BAYAN-JEEP'")).rows[0].n, 0);
    // Fixed transport expectations protect parent routes/nodes/fares without
    // committing historical per-row hashes or database-wide sequence state.
    assert.equal(await digest(client), EXPECTED_DIGEST);
    const fallbackVariants = variants.map(v => ({ ...v, route_variant_stops: v.route_variant_stops.map(s => ({ ...s, distance_from_variant_start_m: null })) }));
    const fallbackGraph = buildTransportGraph({ variants: fallbackVariants });
    const fallback = planJourneys(fallbackGraph, { candidateBoardingNodeIds: [psu], candidateDestinationNodeIds: [sm] })[0];
    assert.equal(fallback.legs[0].roadDistanceSource, 'STORED_ROAD_GEOMETRY');
    assert.ok(fallback.legs[0].segmentDistanceMeters > 10000);
    assert.deepEqual(await databaseSnapshot(client), baseline);
    await client.query('rollback');
    fs.writeFileSync(require('node:path').join(__dirname, '../documentation/batch-a5b-production-fare-validation.json'), JSON.stringify({
      passed: true, checked_at: new Date().toISOString(), digest: EXPECTED_DIGEST, no_database_writes: true,
      remaining_pilot_distance_unavailable: 0, summaries: summary,
    }, null, 2) + '\n');
    console.log('PASS: approved geometry/source and ordered road-derived cumulative distances; preserved service fields, counts, modes and parent routes');
    console.log('PASS: all pilot regular/student fares known and integer; tricycle PHP 100 DEMO_ESTIMATE; totals PHP 114/111 with one transfer');
    console.log('PASS: geometry fallback, REAL/SIMULATED isolation, unapplied research and unchanged City Proper; no API keys or DB writes');
  } finally { await client.query('rollback'); await client.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
