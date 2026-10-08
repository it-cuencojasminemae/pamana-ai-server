'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { containsPoint, getPinArea } = require('../src/services/pamana-journey/pin-area');
const { validateTripPlanRequest } = require('../src/services/pamana-journey/trip-plan-request-validator');
const { clipCorridor, corridorMatches, createRoadTimeRouter, estimateJourneyTime } = require('../src/services/pamana-journey/travel-time');
const { createTravelTimeHandler } = require('../src/api/pamana-ai/controllers/travel-time');
const { ROLE_PERMISSION_MATRIX } = require('../src/services/security/access-control');
const { resetRateLimits } = require('../src/services/security/request-guard');
const line = [[120.698, 15.128], [120.698, 15.125], [120.701, 15.125]];
const node = p => ({ lng: p[0], lat: p[1] });
const ride = { type: 'TRANSIT', boardAt: node(line[0]), alightAt: node(line.at(-1)), geometry: { type: 'LineString', coordinates: line } };
const journey = { id: 'test-real-journey', legs: [{ type: 'WALK', durationSeconds: 120 }, ride], dataQuality: { planningEligible: true, dataModes: ['REAL'] } };
const request = { origin: { lat: 15.128026422211173, lng: 120.69826461388278, source: 'MAP_PIN' }, destination: { lat: 15.05158, lng: 120.69885, source: 'GEOAPIFY' }, departureAt: '2026-10-07T02:00:00Z', passengerCategory: 'STUDENT' };
const polygon = { type: 'Polygon', coordinates: [[[120, 15], [121, 15], [121, 16], [120, 16], [120, 15]], [[120.3, 15.3], [120.7, 15.3], [120.7, 15.7], [120.3, 15.7], [120.3, 15.3]]] };
function ctx(body, role = 'Passenger') {
  return { state: role ? { user: { id: 'pin-tests', role: { name: role } } } : {}, request: { body }, set() {},
    unauthorized() { this.status = 401; }, forbidden() { this.status = 403; } };
}

test('sourced San Juan identity and existing field reference points validate, with independent rollout gates', () => {
  const area = getPinArea({ enabled: true });
  assert.equal(area.verified, true); assert.equal(area.enabled, true);
  assert.equal(area.boundary.properties.psgc_10d, '0305413031');
  const refs = require('../src/services/pamana-journey/data/san-juan-boundary-verification.json');
  for (const ref of refs.referencePoints) assert.equal(containsPoint(area.boundary.geometry, ref), ref.expectedInside, ref.name);
  assert.equal(getPinArea({ enabled: false }).enabled, false);
  assert.match(area.notice, /indicative/);
});

test('missing or corrupted boundary data disables pins without breaking module initialization', () => {
  for (const readFileSync of [() => { throw new Error('missing data'); }, () => 'invalid-json']) {
    const sandbox = { module: { exports: {} }, __dirname: __dirname, structuredClone,
      process: { env: { PAMANA_MAP_PINS_ENABLED: 'true', PAMANA_TRAVEL_TIME_ENABLED: 'true' } },
      require: name => name === 'node:fs' ? { readFileSync } : require(name) };
    vm.runInNewContext(fs.readFileSync(require.resolve('../src/services/pamana-journey/pin-area'), 'utf8'), sandbox);
    const area = sandbox.module.exports.getPinArea();
    assert.equal(area.enabled, false); assert.equal(area.reason, 'BOUNDARY_UNVERIFIED'); assert.equal(area.travelTimeEnabled, true);
  }
});

test('geofence includes outer edges and vertices but excludes holes, hole edges, invalid coordinates and other polygons', () => {
  assert.equal(containsPoint(polygon, { lng: 120.1, lat: 15.1 }), true);
  assert.equal(containsPoint(polygon, { lng: 120, lat: 15.4 }), true);
  assert.equal(containsPoint(polygon, { lng: 120, lat: 15 }), true);
  assert.equal(containsPoint(polygon, { lng: 120.5, lat: 15.5 }), false);
  assert.equal(containsPoint(polygon, { lng: 120.3, lat: 15.5 }), false);
  assert.equal(containsPoint(polygon, { lng: NaN, lat: 15 }), false);
  assert.equal(containsPoint(polygon, { lng: 122, lat: 15 }), false);
  assert.equal(containsPoint({ type: 'MultiPolygon', coordinates: [polygon.coordinates] }, { lng: 120.1, lat: 15.1 }), true);
  assert.equal(containsPoint({ type: 'Polygon', coordinates: [] }, { lng: 120, lat: 15 }), false);
});

test('San Juan display boundary is independent of enabled San Fernando authorization', () => {
  const previous = process.env.PAMANA_CSF_MAP_PINS_ENABLED;
  try {
    process.env.PAMANA_CSF_MAP_PINS_ENABLED = 'true';
    const area = getPinArea({ enabled: true });
    const city = { lat: 15.039373960293801, lng: 120.68311389238005 };
    assert.equal(containsPoint(area.boundary.geometry, city), true);
    assert.equal(containsPoint(area.displayBoundary.geometry, city), false);
    assert.equal(area.displayBoundary.properties.brgy_name, 'San Juan');
    assert.equal(containsPoint(area.displayBoundary.geometry, { lat: 15.117429648993976, lng: 120.7024058913807 }), true);
    process.env.PAMANA_CSF_MAP_PINS_ENABLED = 'false';
    assert.deepEqual(getPinArea({ enabled: true }).boundary, getPinArea({ enabled: true }).displayBoundary);
  } finally { if (previous === undefined) delete process.env.PAMANA_CSF_MAP_PINS_ENABLED; else process.env.PAMANA_CSF_MAP_PINS_ENABLED = previous; }
});

test('backend accepts only enabled in-area pins while existing external search points stay valid', () => {
  const previous = process.env.PAMANA_MAP_PINS_ENABLED;
  try {
    process.env.PAMANA_MAP_PINS_ENABLED = 'true';
    assert.equal(validateTripPlanRequest(request).ok, true);
    assert.equal(validateTripPlanRequest({ ...request, origin: { ...request.destination, source: 'MAP_PIN' } }).ok, false);
    process.env.PAMANA_MAP_PINS_ENABLED = 'false';
    assert.equal(validateTripPlanRequest(request).ok, false);
    assert.equal(validateTripPlanRequest({ ...request, origin: { ...request.origin, source: 'USER_GPS' } }).ok, true);
  } finally { if (previous === undefined) delete process.env.PAMANA_MAP_PINS_ENABLED; else process.env.PAMANA_MAP_PINS_ENABLED = previous; }
});

test('ride corridor clips to boarding/alighting and rejects ambiguous or absent geometry', () => {
  assert.deepEqual(clipCorridor(ride), line);
  const partial = clipCorridor({ ...ride, boardAt: { lat: 15.1275, lng: 120.698 } });
  assert.ok(partial[0][1] < 15.128 && partial[0][1] > 15.127);
  assert.equal(clipCorridor({ ...ride, geometry: null }), null);
  assert.equal(clipCorridor({ ...ride, boardAt: ride.alightAt, alightAt: ride.boardAt }), null);
  assert.equal(clipCorridor({ ...ride, boardAt: { lat: 15, lng: 120 } }), null);
});

test('road estimates reject shortcuts, detours, reversed geometry and invalid provider coordinates', () => {
  assert.equal(corridorMatches(line, line), true);
  assert.equal(corridorMatches(line, [line[0], [120.71, 15.127], line.at(-1)]), false);
  assert.equal(corridorMatches(line, [line[0], line.at(-1)]), false);
  assert.equal(corridorMatches(line, [...line].reverse()), false);
  assert.equal(corridorMatches(line, [[NaN, 15], line.at(-1)]), false);
});

test('Geoapify traffic is approximated, exact corridor is cached for five minutes, key is never in the result', async () => {
  let calls = 0, timestamp = 1000000;
  const router = createRoadTimeRouter({ apiKey: 'server-test-key', now: () => timestamp, fetcher: async url => {
    calls++; const params = new URL(url).searchParams;
    assert.equal(params.get('mode'), 'drive'); assert.equal(params.get('traffic'), 'approximated');
    assert.match(params.get('waypoints'), /15.128,120.698/);
    return { ok: true, json: async () => ({ type: 'FeatureCollection', features: [{ geometry: { type: 'LineString', coordinates: line }, properties: { time: 240 } }] }) };
  } });
  const result = await router.route(line);
  assert.equal(result.seconds, 240); assert.doesNotMatch(JSON.stringify(result), /server-test-key|apiKey/);
  await router.route(line); assert.equal(calls, 1);
  timestamp += 300000; await router.route(line); assert.equal(calls, 2);
});

test('timeouts, cancellation, rate limits, invalid metrics and corridor mismatch fail safely', async () => {
  const timeout = createRoadTimeRouter({ apiKey: 'test', timeoutMs: 10, fetcher: () => new Promise(() => {}) });
  assert.equal((await timeout.route(line)).reason, 'PROVIDER_TIMEOUT');
  const cancelled = new AbortController(); cancelled.abort();
  assert.equal((await timeout.route(line, cancelled.signal)).reason, 'CANCELLED');
  for (const [response, reason] of [
    [{ ok: false, status: 429 }, 'PROVIDER_RATE_LIMITED'],
    [{ ok: true, json: async () => ({ type: 'FeatureCollection', features: [{ properties: { time: -1 }, geometry: ride.geometry }] }) }, 'INVALID_PROVIDER_RESPONSE'],
    [{ ok: true, json: async () => ({ type: 'FeatureCollection', features: [{ properties: { time: 10 }, geometry: { type: 'LineString', coordinates: [line[0], [120.72, 15.12], line.at(-1)] } }] }) }, 'CORRIDOR_MISMATCH'],
  ]) assert.equal((await createRoadTimeRouter({ apiKey: 'test', fetcher: async () => response }).route(line)).reason, reason);
});

test('actual Geoapify connected MultiLineString shape is supported without inventing bridges', async () => {
  for (const [parts, expected] of [
    [[[line[0], line[1]], [line[1], line[2]]], true],
    [[[line[0], line[1]], [[120.71, 15.125], line[2]]], false],
  ]) {
    const router = createRoadTimeRouter({ apiKey: 'test', fetcher: async () => ({ ok: true, json: async () => ({
      type: 'FeatureCollection', features: [{ geometry: { type: 'MultiLineString', coordinates: parts }, properties: { time: 300 } }],
    }) }) });
    assert.equal((await router.route(line)).ok, expected);
  }
});

test('complete moving time excludes waits; missing ride or walking data remains explicitly partial', async () => {
  const before = JSON.stringify(journey);
  const router = { route: async () => ({ ok: true, seconds: 240 }) };
  const estimate = await estimateJourneyTime(journey, { router });
  assert.equal(estimate.status, 'COMPLETE'); assert.equal(estimate.movingSeconds, 360);
  assert.deepEqual(estimate.exclusions.slice(0, 3), ['WAITING', 'BOARDING', 'TRANSFER_DELAYS']);
  assert.equal(JSON.stringify(journey), before);
  const partial = await estimateJourneyTime({ ...journey, legs: [journey.legs[0], { ...ride, geometry: null }] }, { router });
  assert.equal(partial.status, 'PARTIAL'); assert.equal(partial.movingSeconds, null); assert.equal(partial.rideSeconds, null);
  const mixed = await estimateJourneyTime({ ...journey, legs: [journey.legs[0], ride, { ...ride, geometry: null }] }, { router });
  assert.equal(mixed.ridesComplete, false); assert.equal(mixed.knownRideCount, 1); assert.equal(mixed.rideSeconds, 240); assert.equal(mixed.movingSeconds, null);
  const missingWalk = await estimateJourneyTime({ ...journey, legs: [{ type: 'WALK', durationSeconds: null }, ride] }, { router });
  assert.equal(missingWalk.status, 'PARTIAL'); assert.equal(missingWalk.walkingSeconds, null); assert.equal(missingWalk.movingSeconds, null);
});

test('endpoint replans server-owned facts and rejects anonymous, cross-role, forged, unknown and simulated journeys', async () => {
  resetRateLimits(); let plans = 0, estimates = 0;
  const handler = createTravelTimeHandler({ enabled: () => true, validate: value => ({ ok: true, value }),
    orchestrate: async () => { plans++; return { journeys: [journey] }; }, estimate: async value => { estimates++; return { journeyId: value.id, status: 'PARTIAL' }; } });
  for (const [role, status] of [[null, 401], ['Driver', 403]]) {
    const context = ctx({ request, journeyId: journey.id }, role); await handler(context); assert.equal(context.status, status);
  }
  const forged = ctx({ request, journeyId: journey.id, seconds: 1 }); await handler(forged); assert.equal(forged.status, 400);
  assert.equal(plans, 0);
  const valid = ctx({ request, journeyId: journey.id }); await handler(valid); assert.equal(valid.body.journeyId, journey.id); assert.equal(estimates, 1);
  const stale = ctx({ request, journeyId: 'unknown' }); await handler(stale); assert.equal(stale.body.status, 'UNAVAILABLE'); assert.equal(estimates, 1);
  const simulated = createTravelTimeHandler({ enabled: () => true, validate: value => ({ ok: true, value }), orchestrate: async () => ({ journeys: [{ ...journey, dataQuality: { planningEligible: true, dataModes: ['SIMULATED'] } }] }), estimate: async () => { throw new Error('must not estimate'); } });
  const context = ctx({ request, journeyId: journey.id }); await simulated(context); assert.equal(context.body.status, 'UNAVAILABLE');
});

test('independent disabled gate avoids replanning; endpoint quota and permission matrix stay restricted', async () => {
  resetRateLimits();
  const handler = createTravelTimeHandler({ enabled: () => false, validate: value => ({ ok: true, value }), orchestrate: async () => { throw new Error('disabled endpoint must not replan'); } });
  const context = ctx({ request, journeyId: journey.id }); await handler(context); assert.equal(context.body.status, 'DISABLED');
  for (let i = 0; i < 30; i++) await handler(context);
  assert.equal(context.status, 429);
  for (const role of ['Passenger', 'LGU', 'Administrator']) assert.ok(ROLE_PERMISSION_MATRIX[role].includes('api::pamana-ai.travel-time.create'));
  assert.ok(!ROLE_PERMISSION_MATRIX.Driver.includes('api::pamana-ai.pin-area.find'));
});
