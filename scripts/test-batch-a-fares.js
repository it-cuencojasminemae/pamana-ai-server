'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateFareForLeg, summarizeJourneyFares } = require('../src/services/pamana-journey/fare-engine');
const { DEMO_TRICYCLE, rawJeepneyFare } = require('../src/services/pamana-journey/fare-policy');
const { countVehicleTransfers } = require('../src/services/pamana-journey/transfer-count');
const { enrichJourneyInformation } = require('../src/services/pamana-journey/journey-information-enricher');
const { buildTransportGraph } = require('../src/services/pamana-journey/graph-builder');
const { planJourneys } = require('../src/services/pamana-journey/journey-planner');
const { composeWalkingJourneys } = require('../src/services/pamana-journey/walking-journey-composer');
const { normalizeJourney } = require('../src/services/pamana-journey/trip-plan-orchestrator');
const { decodePolyline, roadLine } = require('../src/services/pamana-journey/route-distance');
const { sanitizeJourneyExplanationRequest, SYSTEM_PROMPT } = require('../src/services/pamana-ai/journey-explanation');
const { buildTripRecommendationPrompt } = require('../src/services/pamana-ai/explain');
const { node, route, stop, variant } = require('./fixtures/phase10-synthetic-network');
const { fareRule } = require('./fixtures/phase12-synthetic-information');
const { expansionPlan, evidence, manifest } = require('./seed-batch-a-research');
const DATE = '2026-10-04T08:00:00+08:00';

function jeep(distance, mode = 'PUJ_TRADITIONAL', overrides = {}) {
  return { type: 'TRANSIT', transportMode: mode, segmentDistanceMeters: distance,
    roadDistanceSource: 'STORED_ROUTE_STOP_DISTANCE', verificationStatus: 'FIELD_VERIFIED', dataMode: 'REAL', ...overrides };
}
function fare(leg, options = {}) { return evaluateFareForLeg(leg, { requestedDate: DATE, ...options }); }
function demo(overrides = {}) {
  return jeep(null, 'TRICYCLE', { routeCode: DEMO_TRICYCLE.routeCode, variantCode: DEMO_TRICYCLE.variantCode,
    boardAt: { nodeCode: DEMO_TRICYCLE.from }, alightAt: { nodeCode: DEMO_TRICYCLE.to }, ...overrides });
}

test('traditional jeep base and succeeding distance use PHP 14 / first 4km / PHP 2', () => {
  for (const meters of [0, 2000, 4000]) assert.equal(fare(jeep(meters)).payableFare, 14);
  assert.equal(fare(jeep(6000)).payableFare, 18);
  assert.equal(rawJeepneyFare('PUJ_TRADITIONAL', 5000), 16);
});

test('modern jeep base and succeeding distance use PHP 17 / first 4km / PHP 2.40', () => {
  for (const meters of [0, 2000, 4000]) assert.equal(fare(jeep(meters, 'PUJ_MODERN')).payableFare, 17);
  assert.equal(fare(jeep(6000, 'PUJ_MODERN')).payableFare, 22);
  assert.equal(rawJeepneyFare('PUJ_MODERN', 8450), 27.68);
});

test('passenger amounts use Math.round and serialize as numeric whole pesos', () => {
  for (const [raw, expected] of [[27.68, 28], [33.42, 33], [22.14, 22], [26.73, 27], [27.5, 28]]) {
    const meters = 4000 + (raw - 17) / 2.4 * 1000;
    const result = fare(jeep(meters, 'PUJ_MODERN'));
    assert.equal(result.regularFare, expected);
    assert.equal(result.payableFare, expected);
    assert.ok(Number.isInteger(result.discountedFare));
    assert.match(JSON.stringify({ estimated_fare: result.payableFare }), /"estimated_fare":\d+}/);
  }
});

test('20 percent discount rounds the raw fare, and REGULAR never silently selects it', () => {
  const leg = jeep(4000 + (33.42 - 17) / 2.4 * 1000, 'PUJ_MODERN');
  const regular = fare(leg);
  assert.deepEqual([regular.regularFare, regular.discountedFare, regular.payableFare, regular.discountType], [33, 27, 33, null]);
  for (const passengerCategory of ['STUDENT', 'SENIOR', 'PWD']) {
    const result = fare(leg, { passengerCategory });
    assert.equal(result.payableFare, 27, 'discounting rounded 33 would incorrectly produce 26');
    assert.equal(result.discountType, passengerCategory);
  }
});

test('demo tricycle is exactly PHP 100 for the explicit outbound pilot leg only', () => {
  const result = fare(demo());
  assert.deepEqual([result.regularFare, result.payableFare, result.sourceType], [100, 100, 'DEMO_ESTIMATE']);
  assert.equal(result.verificationStatus, null);
  assert.equal(result.isDemoEstimate, true);
  assert.equal(result.isCalculated, false);
  assert.equal(fare(demo(), { passengerCategory: 'STUDENT' }).payableFare, 100, 'no invented demo discount');
  for (const changes of [
    { boardAt: { nodeCode: DEMO_TRICYCLE.to }, alightAt: { nodeCode: DEMO_TRICYCLE.from } },
    { variantCode: 'OTHER' }, { routeCode: 'OTHER' }, { alightAt: { nodeCode: 'OTHER' } },
    { transportMode: 'BUS' },
  ]) assert.equal(fare(demo(changes)).payableFare, null);
});

test('walking costs zero and contributes no boarding, base fare or transfer', () => {
  const walk = { type: 'WALK' };
  assert.equal(fare(walk).payableFare, 0);
  const result = enrichJourneyInformation({ legs: [walk, jeep(6000), walk] }, { requestedDeparture: DATE });
  assert.equal(result.transferCount, 0);
  assert.equal(result.fareSummary.totalFare, 18);
  assert.equal(summarizeJourneyFares([{ ...walk, fare: fare(walk) }]).totalFare, 0);
  assert.equal(fare({ type: 'TRANSFER' }).payableFare, null);
});

test('one / two / three vehicle legs count zero / one / two transfers across all composition boundaries', () => {
  for (const [count, expected] of [[1, 0], [2, 1], [3, 2]]) {
    const legs = Array.from({ length: count }, () => jeep(5000)).flatMap(leg => [{ type: 'WALK' }, leg, { type: 'TRANSFER' }]);
    assert.equal(countVehicleTransfers(legs), expected);
    const result = enrichJourneyInformation({ transferCount: 99, legs }, { requestedDeparture: DATE });
    assert.equal(result.transferCount, expected);
    assert.equal(normalizeJourney(result).transferCount, expected);
  }
  const journey = { legs: [jeep(5000)], transferCount: 99, originNode: { nodeId: 'a' }, destinationNode: { nodeId: 'b' } };
  const composed = composeWalkingJourneys([journey], {
    accessCandidates: [{ node: { nodeId: 'a' }, walkingLeg: { type: 'WALK' } }],
    egressCandidates: [{ node: { nodeId: 'b' }, walkingLeg: { type: 'WALK' } }],
  })[0];
  assert.equal(composed.transferCount, 0);
});

test('journey totals sum independently rounded boardings and remain partial with a missing distance', () => {
  const result = enrichJourneyInformation({ legs: [demo(), { type: 'WALK' }, jeep(6000), jeep(6000, 'PUJ_MODERN')] }, { requestedDeparture: DATE });
  assert.deepEqual(result.legs.map(l => l.fare.payableFare), [100, 0, 18, 22]);
  assert.equal(result.fareSummary.totalFare, 140);
  assert.equal(result.transferCount, 2);
  const twoJeep = enrichJourneyInformation({ legs: [jeep(3000), { type: 'WALK' }, jeep(3000)] }, { requestedDeparture: DATE });
  assert.equal(twoJeep.fareSummary.totalFare, 28);
  const partial = enrichJourneyInformation({ legs: [demo(), jeep(null)] }, { requestedDeparture: DATE });
  assert.equal(partial.fareSummary.totalFare, null);
  assert.equal(partial.fareSummary.knownSubtotal, 100);
  assert.equal(partial.fareSummary.totalStatus, 'PARTIAL');
});

test('missing, invalid or straight-line distance cannot fabricate a jeepney fare, even with a historical flat rule', () => {
  for (const distance of [null, undefined, -1, NaN, Infinity]) {
    const result = fare(jeep(distance));
    assert.equal(result.status, 'FARE_DISTANCE_UNAVAILABLE');
    assert.equal(result.payableFare, null);
  }
  for (const roadDistanceSource of [undefined, 'HAVERSINE', 'STRAIGHT_LINE']) {
    assert.equal(fare(jeep(6000, 'PUJ_TRADITIONAL', { roadDistanceSource })).payableFare, null);
  }
  const leg = jeep(null, 'PUJ_TRADITIONAL', { routeVariantId: 'v' });
  const historical = fareRule('old-flat', { variantRecord: { documentId: 'v' }, regularFare: 30 });
  assert.equal(fare(leg, { fareRules: [historical] }).status, 'FARE_DISTANCE_UNAVAILABLE');
});

function geometryFixture(overrides = {}) {
  const nodes = [node('G-A', { latitude: 15, longitude: 120 }),
    node('G-B', { latitude: 15.03, longitude: 120 }), node('G-C', { latitude: 15, longitude: 120.04 })];
  const v = variant('GEOMETRY-OUT', 'OUTBOUND', route('GEOMETRY'), nodes.map((n, i) => stop('GEOMETRY-OUT', n, i + 1)), {
    geometry_source: 'FIELD_GPS', geometry_geojson: { type: 'LineString', coordinates: [[120, 15], [120, 15.03], [120.04, 15.03], [120.04, 15]] }, ...overrides,
  });
  return { nodes, variants: [v] };
}
function planned(fixture, from = 0, to = 2) {
  return planJourneys(buildTransportGraph(fixture, { serviceDate: DATE }), {
    candidateBoardingNodeIds: [fixture.nodes[from].id], candidateDestinationNodeIds: [fixture.nodes[to].id],
  });
}

test('stored road geometry measures the traveled polyline, including partial rides', () => {
  const fixture = geometryFixture();
  const leg = planned(fixture)[0].legs[0];
  assert.equal(leg.roadDistanceSource, 'STORED_ROAD_GEOMETRY');
  assert.ok(leg.segmentDistanceMeters > 10900 && leg.segmentDistanceMeters < 11100, 'road detour is about 11km, not the 4.3km chord');
  assert.equal(fare(leg).payableFare, 28);
  const partial = planned(fixture, 0, 1)[0].legs[0];
  assert.ok(partial.segmentDistanceMeters > 3300 && partial.segmentDistanceMeters < 3400);
  assert.equal(fare(partial).payableFare, 14);
});

test('existing cumulative road stop distances take precedence and remain leg-specific', () => {
  const fixture = geometryFixture();
  fixture.variants[0].route_variant_stops.forEach((s, i) => { s.distance_from_variant_start_m = [0, 2000, 5000][i]; });
  const leg = planned(fixture)[0].legs[0];
  assert.equal(leg.segmentDistanceMeters, 5000);
  assert.equal(leg.roadDistanceSource, 'STORED_ROUTE_STOP_DISTANCE');
  assert.equal(fare(leg).payableFare, 16);
  assert.equal(planned(fixture, 1, 2)[0].legs[0].segmentDistanceMeters, 3000);
});

test('unknown, disconnected, off-route, ambiguous and reversed geometry are never used as fare distances', () => {
  const fixtures = [geometryFixture({ geometry_source: 'UNKNOWN' }),
    geometryFixture({ geometry_source: 'SIMULATED' }),
    geometryFixture({ geometry_geojson: { type: 'MultiLineString', coordinates: [[[120, 15], [120, 15.03]], [[120.04, 15.03], [120.04, 15]]] } }),
    geometryFixture({ geometry_geojson: { type: 'LineString', coordinates: [[120.04, 15], [120.04, 15.03], [120, 15.03], [120, 15]] } }),
    geometryFixture({ geometry_geojson: { type: 'LineString', coordinates: [[120, 15], [120, 15.03], [120, 15], [120.04, 15]] } }),
  ];
  const offRoute = geometryFixture(); offRoute.nodes[1].latitude = 16; fixtures.push(offRoute);
  for (const fixture of fixtures) assert.equal(planned(fixture)[0].legs[0].segmentDistanceMeters, null);
  const reversedCumulative = geometryFixture({ geometry_source: 'UNKNOWN' });
  reversedCumulative.variants[0].route_variant_stops.forEach((s, i) => { s.distance_from_variant_start_m = [1000, 3000, 2000][i]; });
  assert.equal(planned(reversedCumulative)[0].legs[0].segmentDistanceMeters, null);
});

test('stored encoded polylines are supported and malformed input remains unavailable', () => {
  const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
  assert.deepEqual(decodePolyline(encoded), [[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]);
  assert.equal(decodePolyline('_'), null);
  assert.equal(decodePolyline('!!'), null);
  assert.equal(roadLine({ geometry_source: 'UNKNOWN', encoded_polyline: encoded }), null);
  const fixture = geometryFixture({ geometry_geojson: null, encoded_polyline: encoded });
  const coords = decodePolyline(encoded);
  fixture.nodes.forEach((n, i) => { n.latitude = coords[i][1]; n.longitude = coords[i][0]; });
  assert.ok(planned(fixture)[0].legs[0].segmentDistanceMeters > 700000);
});

test('research/demo/simulated exclusions and effective dates are preserved without changing records', () => {
  for (const verification_status of ['RESEARCH_CANDIDATE', 'CORROBORATED_RESEARCH', 'SIMULATED_DEMO']) {
    const fixture = geometryFixture({ verification_status, planning_enabled: true });
    const before = JSON.stringify(fixture);
    assert.deepEqual(planned(fixture), []);
    assert.equal(JSON.stringify(fixture), before);
    assert.equal(fare(jeep(5000, 'PUJ_TRADITIONAL', { verificationStatus: verification_status })).payableFare, null);
  }
  assert.deepEqual(planned(geometryFixture({ effective_to: '2026-10-03' })), []);
  assert.deepEqual(planned(geometryFixture({ planning_enabled: false })), []);
  assert.deepEqual(planned(geometryFixture({ data_mode: 'SIMULATED' })), []);
  const simulation = jeep(5000, 'PUJ_TRADITIONAL', { verificationStatus: 'SIMULATED_DEMO', dataMode: 'SIMULATED' });
  assert.equal(fare(simulation).payableFare, null);
  assert.equal(fare(simulation, { allowSimulated: true }).payableFare, 16);
  assert.equal(fare(demo({ verificationStatus: 'SIMULATED_DEMO', dataMode: 'SIMULATED' }), { allowSimulated: true }).payableFare, null);
});

test('existing eligible journeys and duplicate graph data remain deterministic', () => {
  const fixture = geometryFixture();
  assert.equal(planned(fixture).length, 1);
  fixture.variants.push(structuredClone(fixture.variants[0]));
  assert.equal(planned(fixture).length, 1);
  assert.equal(buildTransportGraph(fixture).variants.size, 1);
});

test('research expansion reuses equivalent records regardless of names and never promotes them', () => {
  const nodes = [...new Set(manifest.variants.flatMap(v => [v.from, v.to]))].map(node_code => ({ node_code }));
  const state = { nodes, routes: [{ route_code: 'RCH-MEX-CSF-SM' }], variants: [] };
  assert.equal(expansionPlan(state).filter(a => a.action === 'CREATE_RESEARCH').length, 4);
  const semanticVariant = { variant_code: 'EXISTING-DIFFERENT-NAME', route_code: 'EXISTING-LOCAL',
    transport_mode: 'PUJ_TRADITIONAL', from_code: DEMO_TRICYCLE.from, to_code: DEMO_TRICYCLE.to };
  state.routes.push({ route_code: 'EXISTING-LOCAL', transport_mode: 'PUJ_TRADITIONAL' });
  state.variants.push(semanticVariant);
  const plan = expansionPlan(state);
  assert.equal(plan[0].action, 'UNCHANGED');
  assert.equal(plan[3].action, 'UNCHANGED');
  assert.equal(plan[3].code, semanticVariant.variant_code);
  assert.equal(evidence.planning_enabled, false);
  assert.equal(evidence.verification_status, 'RESEARCH_CANDIDATE');
  assert.equal(evidence.verified_at, null);
});

test('the AI receives final fare facts and provenance with an explicit no-calculation instruction', () => {
  assert.match(SYSTEM_PROMPT, /Never calculate fares, discounts, totals, or fare distances/);
  const result = enrichJourneyInformation({ legs: [{ ...demo(), sequence: 1 }] }, { requestedDeparture: DATE });
  const normalized = normalizeJourney(result);
  const validation = sanitizeJourneyExplanationRequest({ originLabel: 'PSU', destinationLabel: 'Mexico Bayan', journey: {
    legs: normalized.legs, transferCount: 0, fareSummary: normalized.fareSummary,
  } });
  assert.equal(validation.ok, true);
  assert.equal(validation.value.legs[0].fare.payableFare, 100);
  assert.equal(validation.value.legs[0].fare.sourceType, 'DEMO_ESTIMATE');
  assert.equal(JSON.stringify(validation.value).includes('perKm'), false);
  const prompt = buildTripRecommendationPrompt({ fare: 28 });
  assert.match(prompt, /PHP 28\./);
  assert.doesNotMatch(prompt, /PHP 28\.00/);
  assert.match(prompt, /Never calculate fares/);
});
