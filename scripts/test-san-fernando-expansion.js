'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { node, route, variant, stop } = require('./fixtures/phase10-synthetic-network');
const { buildTransportGraph } = require('../src/services/pamana-journey/graph-builder');
const { planJourneys } = require('../src/services/pamana-journey/journey-planner');
const { planJourneysWithWalkingCandidates } = require('../src/services/pamana-journey/walking-journey-service');
const { applyDisruptionConstraints } = require('../src/services/pamana-journey/disruption-engine');
const { orchestrateTripPlan, distinctRidePatterns } = require('../src/services/pamana-journey/trip-plan-orchestrator');
const { estimateJourneyTime } = require('../src/services/pamana-journey/travel-time');
const { validateTripPlanRequest } = require('../src/services/pamana-journey/trip-plan-request-validator');
const { getLandmarks } = require('../src/services/pamana-journey/pilot-landmarks');
const { expansionSettings, filterExpansionGraphData, validateReviewedManifest } = require('../src/services/pamana-journey/pilot-expansion');
const { evaluateFareForLeg, summarizeJourneyFares } = require('../src/services/pamana-journey/fare-engine');
const { safePassengerGuide } = require('../src/services/pamana-ai/passenger-guide');
const { ROLE_PERMISSION_MATRIX } = require('../src/services/security/access-control');
const { activate, reportManifest } = require('./activate-san-fernando-expansion');
const manifest = require('./data/san-fernando-expansion.json');
const catalog = require('../src/services/pamana-journey/data/san-fernando-landmarks.json');
const link = { id: 'SM-WALK-TEST', fromNodeCode: 'SM', toNodeCode: 'TERMINAL', status: 'VERIFIED' };
const router = { routeWalk: async ({ from, to }) => ({ ok: true, value: { type: 'WALK', from, to, distanceMeters: 200, durationSeconds: 120,
  geometry: { type: 'LineString', coordinates: [[from.lng, from.lat], [to.lng, to.lat]] }, instructions: [{ text: 'Follow the approved pedestrian connection.', distanceMeters: 200, durationSeconds: 120 }], source: 'GEOAPIFY', calculatedAt: '2026-10-07T00:00:00Z' } }) };
function fixture() {
  const coords = { A: [15.128, 120.698], MEXICO: [15.06433, 120.72025], SM: [15.051585, 120.698855], TERMINAL: [15.051273, 120.697005], CITY: [15.029097, 120.692405] };
  const nodes = Object.fromEntries(Object.entries(coords).map(([code, [latitude, longitude]]) => [code, node(code, { latitude, longitude })]));
  const ride = (code, from, to, mode = 'PUJ_TRADITIONAL') => variant(code, 'OUTBOUND', route(code, mode), [
    stop(code, nodes[from], 1, { dropoff_allowed: false, transfer_allowed: true }),
    stop(code, nodes[to], 2, { pickup_allowed: false, transfer_allowed: true })
  ], { geometry_source: 'MANUAL_VERIFIED', geometry_geojson: { type: 'LineString', coordinates: [[nodes[from].longitude, nodes[from].latitude], [nodes[to].longitude, nodes[to].latitude]] } });
  return { nodes, variants: [ride('LOCAL-OUT', 'A', 'MEXICO'), ride('MEXICO-SM', 'MEXICO', 'SM'), ride('DIRECT-SM', 'A', 'SM'),
    ride('CSF-MEXICO-SFELAPCO-OUT', 'MEXICO', 'CITY'), ride('CSF-MEXICO-MARKET-OUT', 'MEXICO', 'CITY'), ride('CSF-SM-PALENGKE-OUT', 'TERMINAL', 'CITY')] };
}
const search = (graph, origin = 'A', destination = 'CITY', options = {}) => planJourneys(graph, { candidateBoardingNodeIds: [origin], candidateDestinationNodeIds: [destination], maxTransfers: 2, transferConnections: [link], ...options });
const point = n => ({ lat: n.latitude, lng: n.longitude, label: n.name });

test('eleven exact building locations and testimony remain separate from vehicle stops', () => {
  assert.equal(catalog.landmarks.length, 13); assert.equal(catalog.source.observedAt, null); assert.equal(catalog.source.transportStopVerified, false);
  assert.equal(catalog.landmarks.find(l => l.id === 'csf-jbl').lat, 15.03462448939258);
  assert.ok(manifest.nodes.filter(n => n.landmarkId).every(n => n.latitude === null));
  assert.equal(manifest.nodes.find(n => n.node_code === 'CSF-MARKET-ALIGHT').latitude, 15.030460442970819);
  assert.notEqual(manifest.nodes.find(n => n.node_code === 'CSF-PALENGKE-ALIGHT').latitude, 15.030460442970819);
});
test('pending verification and an enabled environment flag cannot expose new variants or links', () => {
  assert.equal(expansionSettings({ enabled: true }).enabled, false);
  assert.deepEqual(expansionSettings({ enabled: true }).connections, []);
  assert.ok(filterExpansionGraphData(fixture()).variants.every(v => !v.variant_code.startsWith('CSF-')));
  assert.ok(validateReviewedManifest(manifest).length > 0);
  assert.equal(reportManifest(manifest).status, 'VERIFICATION_REQUIRED');
});
test('dry-run/apply verification rejection happens before any database statement', async () => {
  let queries = 0;
  await assert.rejects(activate({ query() { queries++; } }, manifest), /verification is incomplete/i);
  assert.equal(queries, 0);
});
test('new route patterns retain both City Proper termini, same through-service aliases, and no Makabali POI', () => {
  assert.equal(manifest.variants.length, 3);
  assert.deepEqual(manifest.variants[2].signboardAliases, ['Palengke', 'JBL', 'Makabali', 'SM Downtown']);
  assert.ok(!catalog.landmarks.some(l => /Makabali/i.test(l.name)));
  assert.notEqual(manifest.variants[0].stops.at(-1), manifest.variants[1].stops.at(-1));
  assert.ok(manifest.variants.every(v => v.direction === 'OUTBOUND'));
});
test('direct City Proper, direct SM transfer and via Mexico three rides are distinct', () => {
  const journeys = search(buildTransportGraph(fixture()));
  assert.equal(journeys.length, 4);
  assert.deepEqual(journeys.map(j => j.transferCount).sort(), [1, 1, 1, 2]);
  const triple = journeys.find(j => j.transferCount === 2);
  assert.deepEqual(triple.legs.map(l => l.variantCode), ['LOCAL-OUT', 'MEXICO-SM', 'CSF-SM-PALENGKE-OUT']);
  assert.equal(triple.transferConnections[1].id, link.id);
});
test('Mexico origins have zero-transfer direct options and one-transfer SM connection', () => {
  const journeys = search(buildTransportGraph(fixture()), 'MEXICO');
  assert.deepEqual(journeys.map(j => j.transferCount).sort(), [0, 0, 1]);
});
test('legacy limits and IDs remain stable without an approved pedestrian connection', () => {
  const graph = buildTransportGraph(fixture());
  assert.equal(search(graph, 'A', 'CITY', { maxTransfers: 1 }).length, 3);
  assert.equal(search(graph, 'A', 'CITY', { transferConnections: [] }).length, 2);
  const a = search(graph, 'A', 'SM', { maxTransfers: 1, transferConnections: [] });
  const b = search(graph, 'A', 'SM');
  assert.deepEqual(a.map(j => j.id), b.map(j => j.id));
  assert.equal(search(graph, 'A', 'CITY', { maxTransfers: 3 }).length, 0);
});
test('nearby nodes, reversed links, and pending links never imply a transfer', () => {
  const graph = buildTransportGraph(fixture());
  for (const connections of [[], [{ ...link, status: 'PENDING' }], [{ ...link, fromNodeCode: 'TERMINAL', toNodeCode: 'SM' }]]) {
    assert.equal(search(graph, 'A', 'CITY', { transferConnections: connections }).length, 2);
  }
  assert.equal(search(graph, 'CITY', 'A').length, 0);
});
test('closures and blocked permissions at either end suppress the exact walking transfer', () => {
  const data = fixture();
  for (const code of ['SM', 'TERMINAL']) for (const effect of ['TRANSFER_BLOCKED', 'NODE_CLOSED', code === 'SM' ? 'ALIGHTING_CLOSED' : 'BOARDING_CLOSED']) {
    const constrained = applyDisruptionConstraints(data, [{ effect, nodeId: data.nodes[code].id }]);
    assert.equal(search(buildTransportGraph(constrained.graphData)).length, 2);
  }
});
test('three-ride traversal never revisits a boarded variant or endpoint', () => {
  const data = fixture();
  data.variants.push(variant('BACK', 'OUTBOUND', route('BACK'), [stop('BACK', data.nodes.MEXICO, 1, { transfer_allowed: true }), stop('BACK', data.nodes.A, 2, { transfer_allowed: true })]));
  assert.ok(search(buildTransportGraph(data)).every(j => new Set(j.legs.map(l => l.routeVariantId)).size === j.legs.length && j.legs.every(l => l.alightAt.nodeCode !== 'A')));
});
test('approved transfer is a real intermediate WALK with ordered boarding confirmations', async () => {
  const data = fixture();
  const result = await planJourneysWithWalkingCandidates({ origin: point(data.nodes.A), destination: point(data.nodes.CITY), nodes: Object.values(data.nodes), graph: buildTransportGraph(data), router, maxTransfers: 2, transferConnections: [link] });
  const triple = result.journeys.find(j => j.transferCount === 2);
  assert.ok(triple);
  assert.deepEqual(triple.legs.map(l => l.type), ['TRANSIT', 'TRANSFER', 'TRANSIT', 'TRANSFER', 'WALK', 'TRANSIT']);
  assert.equal(triple.legs[4].purpose, 'TRANSFER'); assert.equal(triple.legs[3].to.nodeCode, 'TERMINAL');
  assert.ok(triple.legs.at(-1).boardingInstructions.some(t => /ask the driver/i.test(t)));
});
test('required walk failure, empty geometry and cancellation suppress dependent journeys only', async () => {
  const data = fixture();
  for (const walkRouter of [{ routeWalk: async () => ({ ok: false, error: { code: 'ROUTING_TIMEOUT' } }) }, { routeWalk: async () => ({ ok: true, value: { geometry: null } }) }, { routeWalk: async () => { throw new Error('network'); } }]) {
    const result = await planJourneysWithWalkingCandidates({ origin: point(data.nodes.A), destination: point(data.nodes.CITY), nodes: Object.values(data.nodes), graph: buildTransportGraph(data), router: walkRouter, maxTransfers: 2, transferConnections: [link] });
    assert.equal(result.journeys.length, 2); assert.ok(result.failures.length);
  }
  const abort = new AbortController(); abort.abort();
  const result = await planJourneysWithWalkingCandidates({ origin: point(data.nodes.A), destination: point(data.nodes.CITY), nodes: Object.values(data.nodes), graph: buildTransportGraph(data), router, maxTransfers: 2, transferConnections: [link], signal: abort.signal });
  assert.equal(result.journeys.length, 0);
});
test('catalog API is independently gated and role permissions deny Driver and public callers', () => {
  assert.equal(getLandmarks({ available: false }).landmarks.length, 0);
  assert.equal(getLandmarks({ available: true }).landmarks.length, 13);
  const handler = require('../src/api/pamana-ai/controllers/landmarks').find;
  for (const user of [null, { role: { name: 'Driver' } }]) {
    let denied = false; const ctx = { state: { user }, unauthorized() { denied = true; }, forbidden() { denied = true; } }; handler(ctx); assert.equal(denied, true); assert.equal(ctx.body, undefined);
  }
  for (const role of ['Passenger', 'LGU', 'Administrator']) assert.ok(ROLE_PERMISSION_MATRIX[role].includes('api::pamana-ai.landmarks.find'));
  assert.ok(!ROLE_PERMISSION_MATRIX.Driver.includes('api::pamana-ai.landmarks.find'));
});
test('landmark requests use canonical labels/coordinates and reject tampering or disabled catalog', () => {
  const previous = process.env.PAMANA_PILOT_LANDMARKS_ENABLED;
  try {
    process.env.PAMANA_PILOT_LANDMARKS_ENABLED = 'true';
    const l = catalog.landmarks[4]; const request = { origin: { lat: 15.128, lng: 120.698 }, destination: { lat: l.lat, lng: l.lng, label: 'Untrusted text', source: 'PILOT_LANDMARK', landmarkId: l.id } };
    const checked = validateTripPlanRequest(request); assert.equal(checked.ok, true); assert.equal(checked.value.destination.label, 'JBL');
    for (const patch of [{ landmarkId: 'unknown' }, { lat: l.lat + 0.001 }, { source: 'GEOAPIFY' }]) assert.equal(validateTripPlanRequest({ ...request, destination: { ...request.destination, ...patch } }).ok, false);
    process.env.PAMANA_PILOT_LANDMARKS_ENABLED = 'false'; assert.equal(validateTripPlanRequest(request).ok, false);
  } finally { if (previous === undefined) delete process.env.PAMANA_PILOT_LANDMARKS_ENABLED; else process.env.PAMANA_PILOT_LANDMARKS_ENABLED = previous; }
});
test('distinct ride patterns retain the nearest walking representative and stable ties', () => {
  const j = search(buildTransportGraph(fixture()))[0];
  const withWalk = (id, meters) => ({ ...j, id, legs: [...j.legs, { type: 'WALK', distanceMeters: meters }] });
  const grouped = distinctRidePatterns([withWalk('far', 500), withWalk('near', 30), ...search(buildTransportGraph(fixture())).slice(1)]);
  assert.equal(grouped.length, 4); assert.ok(grouped.some(j => j.id === 'near')); assert.ok(!grouped.some(j => j.id === 'far'));
});
test('each of three boardings gets its own fare/discount; transfer walks are free', () => {
  const triple = search(buildTransportGraph(fixture())).find(j => j.transferCount === 2);
  const legs = [...triple.legs, { type: 'WALK' }];
  for (const category of ['REGULAR', 'STUDENT', 'SENIOR', 'PWD']) {
    const priced = legs.map(l => ({ ...l, fare: evaluateFareForLeg(l, { passengerCategory: category, requestedDate: '2026-10-07' }) }));
    assert.equal(priced.at(-1).fare.payableFare, 0);
    const summary = summarizeJourneyFares(priced); assert.equal(summary.totalStatus, 'KNOWN');
    assert.equal(summary.totalFare, priced.slice(0, 3).reduce((sum, l) => sum + l.fare.payableFare, 0));
  }
});
test('moving estimates sum three rides and the transfer walk; incomplete components stay partial', async () => {
  const journey = { id: 'test-three', legs: [...search(buildTransportGraph(fixture())).find(j => j.transferCount === 2).legs.map(l => ({ ...l, geometry: { type: 'LineString', coordinates: [[l.boardAt.lng, l.boardAt.lat], [l.alightAt.lng, l.alightAt.lat]] } })), { type: 'WALK', purpose: 'TRANSFER', durationSeconds: 120 }] };
  let calls = 0;
  const complete = await estimateJourneyTime(journey, { router: { route: async () => { calls++; return { ok: true, seconds: 60 }; } } });
  assert.equal(calls, 3); assert.equal(complete.movingSeconds, 300); assert.equal(complete.rideCount, 3);
  let index = 0;
  const partial = await estimateJourneyTime(journey, { router: { route: async () => ++index === 2 ? { ok: false, reason: 'CORRIDOR_MISMATCH' } : { ok: true, seconds: 60 } } });
  assert.equal(partial.status, 'PARTIAL'); assert.equal(partial.movingSeconds, null); assert.equal(partial.knownRideCount, 2);
});
test('three-ride guide permits six sentences while short-journey limits and ETA rejection remain', () => {
  const facts = { rides: Array.from({ length: 3 }, () => ({ mode: 'Jeep' })), transfers: 2 };
  const text = 'Take a Jeep. Transfer to a Jeep. Transfer to a Jeep. Walk to the destination. This trip has two transfers.';
  assert.equal(safePassengerGuide(text, facts), true);
  assert.equal(safePassengerGuide(text, { ...facts, rides: facts.rides.slice(0, 2) }), false);
  assert.equal(safePassengerGuide(text + ' ETA is soon.', facts), false);
});
test('server orchestration applies the gate before search and keeps legacy options when disabled', async () => {
  const data = fixture();
  const services = { loadEligibleCoordinateNodes: async () => Object.values(data.nodes), loadEligibleTransportGraphData: async () => data, loadEligibleDisruptions: async () => [], loadFareAndServiceData: async () => ({}), loadOperationalData: async () => ({}) };
  const request = { origin: point(data.nodes.A), destination: point(data.nodes.CITY), departureAt: '2026-10-07T00:00:00Z', passengerCategory: 'REGULAR' };
  const disabled = await orchestrateTripPlan(request, { services, router, expansion: { enabled: false, connections: [], maxTransfers: 1 } });
  assert.equal(disabled.journeys.length, 0);
  const enabled = await orchestrateTripPlan(request, { services, router, expansion: { enabled: true, connections: [link], maxTransfers: 2 } });
  assert.equal(enabled.journeys.length, 4); assert.ok(enabled.journeys.some(j => j.transferCount === 2));
  const legacy = await orchestrateTripPlan({ ...request, destination: point(data.nodes.SM) }, { services, router, expansion: { enabled: false, connections: [], maxTransfers: 1 } });
  assert.equal(legacy.journeys.length, 2);
});
