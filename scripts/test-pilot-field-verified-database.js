'use strict';

const assert = require('node:assert/strict');
const { connect } = require('./seed-phase5b-transfer-research');
const { counts, digest, loadVariant, manifest } = require('./activate-pilot-field-verified');
const { buildTransportGraph, routeVariantPlanningEligibilityFor } = require('../src/services/pamana-journey/graph-builder');
const { planJourneys } = require('../src/services/pamana-journey/journey-planner');
const { evaluateFareForLeg } = require('../src/services/pamana-journey/fare-engine');
const { orchestrateTripPlan, TRIP_PLAN_STATUS } = require('../src/services/pamana-journey/trip-plan-orchestrator');
const { validateTripPlanRequest } = require('../src/services/pamana-journey/trip-plan-request-validator');

const EXPECTED_DIGEST = '3d63fcdb5d9581d71e2c68d54db9c00868510dcc9b91e6e38fcb893373af9139';
const NODE_CODES = manifest.nodes.map((item) => item.node_code).sort();
const ROUTE_CODES = manifest.routes.map((item) => item.route_code).sort();
const VARIANT_CODES = manifest.variants.map((item) => item.variant_code).sort();
const REQUESTED_AT = '2026-09-28T08:00:00+08:00';

async function loadFareRules(client) {
  return (await client.query(`
    select f.*, to_char(f.effective_from, 'YYYY-MM-DD') effective_from,
      to_char(f.effective_to, 'YYYY-MM-DD') effective_to, jsonb_build_object(
      'id', v.id, 'documentId', v.document_id, 'variant_code', v.variant_code
    ) route_variant
    from fare_rules f
    join fare_rules_route_variant_lnk l on l.fare_rule_id = f.id
    join route_variants v on v.id = l.route_variant_id
    order by v.variant_code`)).rows;
}

function transitLeg(journey, variantCode) {
  return journey.legs.find((leg) => leg.type === 'TRANSIT' && leg.variantCode === variantCode);
}

function walkingRouter() {
  return {
    async routeWalk({ from, to }) {
      return {
        ok: true,
        value: {
          type: 'WALK', from, to, distanceMeters: 35, durationSeconds: 30,
          geometry: { type: 'LineString', coordinates: [[from.lng, from.lat], [to.lng, to.lat]] },
          instructions: [], source: 'GEOAPIFY', calculatedAt: '2026-09-28T00:00:00.000Z',
        },
      };
    },
  };
}

async function main() {
  const client = await connect();
  try {
    await client.query('begin read only');
    assert.deepEqual(await counts(client), {
      transport_nodes: 10, routes: 8, route_variants: 4, route_variant_stops: 8,
      fare_rules: 2, service_patterns: 0,
      field_verified_nodes: 4, field_verified_routes: 3,
      field_verified_variants: 4, field_verified_fares: 2,
      planning_nodes: 4, planning_routes: 3, planning_variants: 4,
    });

    const precision = (await client.query(`
      select column_name, numeric_precision, numeric_scale
      from information_schema.columns
      where table_schema = current_schema() and table_name = 'transport_nodes'
        and column_name in ('latitude', 'longitude') order by column_name`)).rows;
    assert.deepEqual(precision, [
      { column_name: 'latitude', numeric_precision: 20, numeric_scale: 15 },
      { column_name: 'longitude', numeric_precision: 20, numeric_scale: 15 },
    ]);

    const nodes = (await client.query(`
      select *, latitude::text latitude_exact, longitude::text longitude_exact
      from transport_nodes where node_code = any($1::text[]) order by node_code`, [NODE_CODES])).rows;
    assert.equal(nodes.length, 4);
    const byNode = Object.fromEntries(nodes.map((node) => [node.node_code, node]));
    assert.deepEqual([byNode['RCH-PSU-MEXICO-FRONT'].latitude_exact, byNode['RCH-PSU-MEXICO-FRONT'].longitude_exact],
      ['15.128026422211173', '120.698264613882780']);
    assert.deepEqual([byNode['RCH-MEXICO-BAYAN-STA-MONICA-TRANSFER'].latitude_exact, byNode['RCH-MEXICO-BAYAN-STA-MONICA-TRANSFER'].longitude_exact],
      ['15.064333794084051', '120.720250220650260']);
    assert.deepEqual([byNode['RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF'].latitude_exact, byNode['RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF'].longitude_exact],
      ['15.051585209274610', '120.698854948988180']);
    assert.deepEqual([byNode['RCH-ROB-STARMILLS-ARAYAT-GATE-LOAD'].latitude_exact, byNode['RCH-ROB-STARMILLS-ARAYAT-GATE-LOAD'].longitude_exact],
      ['15.050605637995128', '120.697782032942440']);
    for (const node of nodes) {
      assert.equal(node.verification_status, 'FIELD_VERIFIED');
      assert.equal(node.data_mode, 'REAL');
      assert.equal(node.planning_enabled, true);
      assert.notEqual(node.verification_status, 'AUTHORITATIVE_CURRENT');
    }

    const routes = (await client.query(`select * from routes where route_code = any($1::text[]) order by route_code`, [ROUTE_CODES])).rows;
    assert.equal(routes.length, 3);
    for (const route of routes) {
      assert.equal(route.route_status, 'active');
      assert.equal(route.active, true);
      assert.equal(route.planning_enabled, true);
      assert.equal(route.verification_status, 'FIELD_VERIFIED');
      assert.equal(route.data_mode, 'REAL');
      assert.equal(route.base_fare, null);
      assert.equal(route.estimated_travel_time, null);
    }
    assert.equal(routes.find((route) => route.route_code === 'RCH-SJ-CSF-SM-ROB').transport_mode, 'PUJ_TRADITIONAL');
    assert.equal(routes.find((route) => route.route_code === 'PILOT-PSU-MEXICO-BAYAN-TRICYCLE').transport_mode, 'TRICYCLE');

    const variants = [];
    for (const code of VARIANT_CODES) variants.push(await loadVariant(client, code));
    assert.equal(variants.length, 4);
    for (const variant of variants) {
      assert.equal(variant.planning_enabled, true);
      assert.equal(variant.verification_status, 'FIELD_VERIFIED');
      assert.equal(variant.data_mode, 'REAL');
      assert.equal(variant.operating_status, 'ACTIVE');
      assert.equal(variant.geometry_source, 'UNKNOWN');
      assert.equal(variant.encoded_polyline, null);
      assert.equal(variant.geometry_geojson, null);
      assert.deepEqual(routeVariantPlanningEligibilityFor(variant, { serviceDate: new Date(REQUESTED_AT) }).reasons, []);
      assert.deepEqual(variant.route_variant_stops.map((stop) => stop.sequence), [1, 2]);
    }
    const byVariant = Object.fromEntries(variants.map((variant) => [variant.variant_code, variant]));
    assert.equal(byVariant['RCH-SJ-SMROB-OUT'].signboard_text, 'SM Pampanga');
    assert.equal(byVariant['RCH-SJ-SMROB-IN'].signboard_text, 'SAN JUAN');
    assert.deepEqual(byVariant['RCH-SJ-SMROB-IN'].route_variant_stops.map((stop) => stop.transport_node.node_code),
      ['RCH-ROB-STARMILLS-ARAYAT-GATE-LOAD', 'RCH-PSU-MEXICO-FRONT']);
    assert.notEqual(byVariant['RCH-SJ-SMROB-IN'].signboard_text, 'MAGALANG');
    assert.match(byVariant['RCH-SJ-SMROB-IN'].notes, /Magalang service is not a PSU Mexico return service/);
    const tricycleEnd = byVariant['PILOT-PSU-MEXICO-BAYAN-TRICYCLE-OUT'].route_variant_stops[1];
    const onwardStart = byVariant['PILOT-ARAYAT-SF-MEXICO-BAYAN-SM-OUT'].route_variant_stops[0];
    assert.equal(tricycleEnd.transport_node.node_code, 'RCH-MEXICO-BAYAN-STA-MONICA-TRANSFER');
    assert.equal(onwardStart.transport_node.node_code, tricycleEnd.transport_node.node_code);
    assert.equal(tricycleEnd.transfer_allowed, true);
    assert.equal(onwardStart.transfer_allowed, true);

    const graph = buildTransportGraph({ variants }, { serviceDate: new Date(REQUESTED_AT) });
    assert.equal(graph.excludedVariants.length, 0);
    const directCandidates = planJourneys(graph, {
      candidateBoardingNodeIds: ['RCH-PSU-MEXICO-FRONT'],
      candidateDestinationNodeIds: ['RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF'],
    });
    const direct = directCandidates.find((journey) => journey.transferCount === 0);
    const transfer = directCandidates.find((journey) => journey.transferCount === 1);
    const directLeg = transitLeg(direct, 'RCH-SJ-SMROB-OUT');
    assert.equal(directLeg.boardAt.nodeCode, 'RCH-PSU-MEXICO-FRONT');
    assert.equal(directLeg.alightAt.nodeCode, 'RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF');
    assert.deepEqual([directLeg.boardAt.lat, directLeg.boardAt.lng], [
      Number(byNode['RCH-PSU-MEXICO-FRONT'].latitude_exact),
      Number(byNode['RCH-PSU-MEXICO-FRONT'].longitude_exact),
    ]);
    assert.deepEqual([directLeg.alightAt.lat, directLeg.alightAt.lng], [
      Number(byNode['RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF'].latitude_exact),
      Number(byNode['RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF'].longitude_exact),
    ]);
    assert.deepEqual(transfer.legs.map((leg) => leg.variantCode), [
      'PILOT-PSU-MEXICO-BAYAN-TRICYCLE-OUT',
      'PILOT-ARAYAT-SF-MEXICO-BAYAN-SM-OUT',
    ]);
    const returns = planJourneys(graph, {
      candidateBoardingNodeIds: ['RCH-ROB-STARMILLS-ARAYAT-GATE-LOAD'],
      candidateDestinationNodeIds: ['RCH-PSU-MEXICO-FRONT'],
    });
    assert.equal(returns.length, 1);
    assert.equal(returns[0].legs[0].variantCode, 'RCH-SJ-SMROB-IN');
    assert.equal(returns[0].legs[0].signboard, 'SAN JUAN');
    assert.deepEqual([returns[0].legs[0].boardAt.lat, returns[0].legs[0].boardAt.lng], [
      Number(byNode['RCH-ROB-STARMILLS-ARAYAT-GATE-LOAD'].latitude_exact),
      Number(byNode['RCH-ROB-STARMILLS-ARAYAT-GATE-LOAD'].longitude_exact),
    ]);

    const fareRules = await loadFareRules(client);
    const directFare = evaluateFareForLeg(direct.legs[0], { fareRules, passengerCategory: 'REGULAR', requestedDate: REQUESTED_AT });
    assert.equal(directFare.status, 'KNOWN');
    assert.equal(directFare.payableFare, 30);
    const transferFare = evaluateFareForLeg(transfer.legs[1], { fareRules, passengerCategory: 'REGULAR', requestedDate: REQUESTED_AT });
    assert.equal(transferFare.status, 'KNOWN');
    assert.equal(transferFare.payableFare, 14);
    const approximateStudent = evaluateFareForLeg(direct.legs[0], { fareRules, passengerCategory: 'STUDENT', requestedDate: REQUESTED_AT });
    assert.equal(approximateStudent.status, 'PARTIAL');
    assert.equal(approximateStudent.regularFare, 30);
    assert.equal(approximateStudent.payableFare, null);
    const exactStudentEvidence = evaluateFareForLeg(transfer.legs[1], { fareRules, passengerCategory: 'STUDENT', requestedDate: REQUESTED_AT });
    assert.equal(exactStudentEvidence.status, 'PARTIAL');
    assert.equal(exactStudentEvidence.regularFare, 14);
    assert.equal(exactStudentEvidence.payableFare, null);
    assert.ok(fareRules.every((rule) => rule.student_discount_percent === null));
    assert.match(fareRules.find((rule) => Number(rule.regular_base_fare) === 14).notes, /PHP 11/);
    assert.equal((await client.query('select count(*)::int count from fare_rules f join fare_rules_route_variant_lnk l on l.fare_rule_id=f.id join route_variants v on v.id=l.route_variant_id where v.variant_code in ($$RCH-SJ-SMROB-IN$$,$$PILOT-PSU-MEXICO-BAYAN-TRICYCLE-OUT$$)')).rows[0].count, 0);

    const eligibleNodes = nodes;
    const serviceData = {
      loadEligibleCoordinateNodes: async () => eligibleNodes,
      loadEligibleTransportGraphData: async () => ({ variants }),
      loadEligibleDisruptions: async () => [],
      loadFareAndServiceData: async () => ({ fareRules, servicePatterns: [] }),
      loadOperationalData: async () => ({ operationalRecords: [] }),
    };
    const outboundRequest = validateTripPlanRequest({
      origin: { lat: 15.128226422211173, lng: 120.69826461388278, source: 'USER_GPS' },
      destination: { lat: 15.05138520927461, lng: 120.69885494898818, source: 'GEOAPIFY' },
      departureAt: REQUESTED_AT,
      passengerCategory: 'REGULAR',
    }).value;
    const outbound = await orchestrateTripPlan(outboundRequest, {
      router: walkingRouter(), now: () => new Date(REQUESTED_AT), services: serviceData,
    });
    assert.equal(outbound.status, TRIP_PLAN_STATUS.JOURNEYS_FOUND);
    assert.ok(outbound.journeys.some((journey) => journey.transferCount === 0
      && journey.legs.some((leg) => leg.type === 'TRANSIT' && leg.variant.code === 'RCH-SJ-SMROB-OUT')));
    assert.ok(outbound.journeys.some((journey) => journey.transferCount === 1));
    assert.ok(outbound.journeys.flatMap((journey) => journey.legs).some((leg) => leg.type === 'WALK' && leg.source === 'GEOAPIFY'));
    assert.ok(outbound.journeys.flatMap((journey) => journey.legs).filter((leg) => leg.type === 'TRANSIT').every((leg) => leg.geometry === null));
    const returnRequest = validateTripPlanRequest({
      origin: { lat: 15.050805637995128, lng: 120.69778203294244, source: 'GEOAPIFY' },
      destination: { lat: 15.127826422211173, lng: 120.69826461388278, source: 'GEOAPIFY' },
      departureAt: REQUESTED_AT,
    }).value;
    const returnPlan = await orchestrateTripPlan(returnRequest, {
      router: walkingRouter(), now: () => new Date(REQUESTED_AT), services: serviceData,
    });
    assert.equal(returnPlan.status, TRIP_PLAN_STATUS.JOURNEYS_FOUND);
    const returnTransit = returnPlan.journeys[0].legs.find((leg) => leg.type === 'TRANSIT');
    assert.equal(returnTransit.variant.code, 'RCH-SJ-SMROB-IN');
    assert.equal(returnTransit.signboard, 'SAN JUAN');
    assert.equal(returnTransit.fare.status, 'UNKNOWN');
    assert.equal(returnTransit.availability.status, 'UNKNOWN');

    const unrelated = (await client.query(`select
      (select array_agg(node_code order by node_code) from transport_nodes where verification_status='FIELD_VERIFIED') nodes,
      (select array_agg(route_code order by route_code) from routes where verification_status='FIELD_VERIFIED') routes,
      (select array_agg(variant_code order by variant_code) from route_variants where verification_status='FIELD_VERIFIED') variants,
      (select count(*)::int from service_patterns) service_patterns,
      (select count(*)::int from disruptions) disruptions,
      (select count(*)::int from transport_nodes where planning_enabled and data_mode <> 'REAL') synthetic_nodes`)).rows[0];
    assert.deepEqual(unrelated.nodes, NODE_CODES);
    assert.deepEqual(unrelated.routes, ROUTE_CODES);
    assert.deepEqual(unrelated.variants, VARIANT_CODES);
    assert.equal(unrelated.service_patterns, 0);
    assert.equal(unrelated.disruptions, 0);
    assert.equal(unrelated.synthetic_nodes, 0);

    assert.equal(await digest(client), EXPECTED_DIGEST);
    console.log('ok - exact field coordinates, trust metadata, ordered stops, null geometry and idempotent counts match');
    console.log('ok - production graph returns direct, SAN JUAN return and one-transfer REAL journeys');
    console.log('ok - fares preserve PHP 30/PHP 14 while unsupported student amounts remain uncomputed');
    console.log(`Transport row digest: ${EXPECTED_DIGEST}`);
  } finally {
    await client.query('rollback');
    await client.end();
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error.stack || error.message}`);
  process.exitCode = 1;
});
