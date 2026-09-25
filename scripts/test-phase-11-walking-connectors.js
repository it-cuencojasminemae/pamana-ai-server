'use strict';

const assert = require('node:assert/strict');
const { buildTransportGraph } = require('../src/services/pamana-journey/graph-builder');
const {
  accessNodeQuery,
  findAccessNodes,
  haversineMeters,
  loadEligibleCoordinateNodes,
  normalizeEligibleNode,
} = require('../src/services/pamana-journey/access-node-finder');
const {
  WALKING_ERROR,
  createWalkingRouter,
  normalizeGeoapifyResponse,
} = require('../src/services/pamana-journey/walking-router');
const {
  planJourneysWithWalkingCandidates,
} = require('../src/services/pamana-journey/walking-journey-service');
const { DEFAULT_WALKING_CONFIG } = require('../src/services/pamana-journey/walking-config');
const { node } = require('./fixtures/phase10-synthetic-network');
const {
  directWalkingFixture,
  transferWalkingFixture,
  withCoordinates,
} = require('./fixtures/phase11-synthetic-network');

const API_KEY = 'unit-test-secret-key';
const geometry = Object.freeze({
  type: 'MultiLineString',
  coordinates: [[[120.9794, 14.5994], [120.9800, 14.6000]]],
});

function payload({ distance = 135, time = 105, routeGeometry = geometry } = {}) {
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {
        distance,
        time,
        legs: [{ steps: [{
          distance: 80,
          time: 60,
          instruction: { text: 'Walk toward the stop' },
        }] }],
      },
      geometry: routeGeometry,
    }],
  };
}

const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const routeValue = (from, to, distanceMeters = 100) => ({
  ok: true,
  value: Object.freeze({
    type: 'WALK',
    from,
    to,
    distanceMeters,
    durationSeconds: Math.round(distanceMeters / 1.2),
    geometry,
    instructions: Object.freeze([]),
    source: 'GEOAPIFY',
    calculatedAt: '2026-09-25T00:00:00.000Z',
  }),
});

async function testResponseNormalization() {
  let requestedUrl;
  const router = createWalkingRouter({
    apiKey: API_KEY,
    now: () => new Date('2026-09-25T00:00:00.000Z'),
    fetcher: async (url) => { requestedUrl = new URL(url); return response(200, payload()); },
  });
  const result = await router.routeWalk({
    from: { lat: 14.5994, lng: 120.9794, label: 'Origin' },
    to: { lat: 14.6000, lng: 120.9800, label: 'Node A' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.type, 'WALK');
  assert.equal(result.value.distanceMeters, 135);
  assert.equal(result.value.durationSeconds, 105);
  assert.deepEqual(result.value.geometry, geometry);
  assert.deepEqual(result.value.instructions, [{
    text: 'Walk toward the stop', distanceMeters: 80, durationSeconds: 60,
  }]);
  assert.equal(result.value.source, 'GEOAPIFY');
  assert.equal(result.value.calculatedAt, '2026-09-25T00:00:00.000Z');
  assert.equal(requestedUrl.pathname, '/v1/routing');
  assert.equal(requestedUrl.searchParams.get('waypoints'), '14.5994,120.9794|14.6,120.98');
  assert.equal(requestedUrl.searchParams.get('mode'), 'walk');
  assert.equal(requestedUrl.searchParams.get('format'), 'geojson');
  assert.equal(requestedUrl.searchParams.get('apiKey'), API_KEY);
  const line = normalizeGeoapifyResponse(payload({
    routeGeometry: { type: 'LineString', coordinates: [[120.9794, 14.5994], [120.9800, 14.6000]] },
  }), {
    from: { lat: 14.5994, lng: 120.9794 },
    to: { lat: 14.6000, lng: 120.9800 },
    calculatedAt: '2026-09-25T00:00:00.000Z',
  });
  assert.equal(line.value.geometry.type, 'LineString');
  console.log('ok - Geoapify GeoJSON, metrics and instructions normalize to a provider-neutral WALK leg');
}

async function testEmptyMalformedAndCache() {
  const empty = normalizeGeoapifyResponse({ type: 'FeatureCollection', features: [] }, {
    from: { lat: 1, lng: 2 }, to: { lat: 3, lng: 4 }, calculatedAt: '2026-09-25T00:00:00.000Z',
  });
  assert.equal(empty.ok, true);
  assert.equal(empty.value.distanceMeters, null);
  assert.equal(empty.value.durationSeconds, null);
  assert.equal(empty.value.geometry, null);
  assert.notEqual(empty.value.distanceMeters, 0);
  assert.equal(normalizeGeoapifyResponse({}, {}).error.code, WALKING_ERROR.INVALID_RESPONSE);
  assert.equal(normalizeGeoapifyResponse({ type: 'FeatureCollection', features: [{}] }, {}).error.code, WALKING_ERROR.INVALID_RESPONSE);

  let calls = 0;
  const router = createWalkingRouter({
    apiKey: API_KEY,
    fetcher: async () => { calls += 1; return response(200, payload()); },
  });
  const request = { from: { lat: 1, lng: 2 }, to: { lat: 3, lng: 4 } };
  await router.routeWalk(request);
  await router.routeWalk(request);
  assert.equal(calls, 1, 'identical normalized walk requests use the bounded TTL cache');
  console.log('ok - unavailable routes preserve null uncertainty and identical requests are cached');
}

async function testProviderFailures() {
  const missing = await createWalkingRouter({ apiKey: '' }).routeWalk({
    from: { lat: 1, lng: 2 }, to: { lat: 3, lng: 4 },
  });
  assert.equal(missing.error.code, WALKING_ERROR.NOT_CONFIGURED);

  for (const [status, expected] of [
    [401, WALKING_ERROR.PROVIDER_AUTHORIZATION],
    [403, WALKING_ERROR.PROVIDER_AUTHORIZATION],
    [429, WALKING_ERROR.RATE_LIMITED],
    [500, WALKING_ERROR.PROVIDER_UNAVAILABLE],
    [503, WALKING_ERROR.PROVIDER_UNAVAILABLE],
  ]) {
    const result = await createWalkingRouter({
      apiKey: API_KEY,
      fetcher: async () => response(status, { message: `provider leaked ${API_KEY}` }),
    }).routeWalk({ from: { lat: 1, lng: 2 }, to: { lat: 3, lng: 4 } });
    assert.equal(result.error.code, expected);
    assert.equal(JSON.stringify(result).includes(API_KEY), false);
  }

  const network = await createWalkingRouter({
    apiKey: API_KEY,
    fetcher: async () => { throw new Error(`request failed: apiKey=${API_KEY}`); },
  }).routeWalk({ from: { lat: 1, lng: 2 }, to: { lat: 3, lng: 4 } });
  assert.equal(network.error.code, WALKING_ERROR.NETWORK);
  assert.equal(JSON.stringify(network).includes(API_KEY), false);

  const timeout = await createWalkingRouter({
    apiKey: API_KEY,
    config: { requestTimeoutMs: 5 },
    fetcher: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error(`timeout ${API_KEY}`)), { once: true });
    }),
  }).routeWalk({ from: { lat: 1, lng: 2 }, to: { lat: 3, lng: 4 } });
  assert.equal(timeout.error.code, WALKING_ERROR.TIMEOUT);

  const controller = new AbortController();
  const cancellationPromise = createWalkingRouter({
    apiKey: API_KEY,
    fetcher: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
    }),
  }).routeWalk({ from: { lat: 1, lng: 2 }, to: { lat: 3, lng: 4 }, signal: controller.signal });
  controller.abort();
  assert.equal((await cancellationPromise).error.code, WALKING_ERROR.CANCELLED);
  console.log('ok - missing key, cancellation, timeout and provider failures are controlled and sanitized');
}

async function testCandidateDiscovery() {
  const point = { lat: 14.6000, lng: 120.9800 };
  const goodNear = withCoordinates(node('GOOD-NEAR'), 14.6005, 120.9800);
  const goodFarther = withCoordinates(node('GOOD-FARTHER'), 14.6020, 120.9800);
  const cappedEligible = withCoordinates(node('CAPPED'), 14.6030, 120.9800);
  const research = withCoordinates(node('RESEARCH', {
    planning_enabled: false,
    verification_status: 'CORROBORATED_RESEARCH',
  }), 14.6002, 120.9800);
  const missingCoordinate = node('MISSING');
  const fallbackCoordinate = withCoordinates(node('ZERO-FALLBACK'), 0, 0);
  const outside = withCoordinates(node('OUTSIDE'), 14.6400, 120.9800);
  const requested = [];
  const router = {
    async routeWalk({ from, to }) {
      requested.push({ from, to });
      return routeValue(from, to, to.nodeCode === 'GOOD-NEAR' ? 350 : 220);
    },
  };
  const result = await findAccessNodes({
    point,
    nodes: [goodNear, goodFarther, cappedEligible, research, missingCoordinate, fallbackCoordinate, outside],
    router,
    config: {
      initialCandidateRadiusMeters: 100,
      maximumCandidateRadiusMeters: 500,
      maxCandidateCount: 2,
      proximityThresholdMeters: 5,
    },
  });
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(result.candidates.map((item) => item.node.nodeCode), ['GOOD-FARTHER', 'GOOD-NEAR'], 'provider walking distance refines ordering');
  assert.equal(requested.length, 2);
  assert.ok(result.candidates.every((item) => item.straightLineDistanceMeters <= 500));
  assert.equal(normalizeEligibleNode(research), null);
  assert.equal(normalizeEligibleNode(missingCoordinate), null);
  assert.equal(normalizeEligibleNode(fallbackCoordinate), null);
  assert.ok(haversineMeters(point, { lat: goodNear.latitude, lng: goodNear.longitude })
    < haversineMeters(point, { lat: goodFarther.latitude, lng: goodFarther.longitude }));

  const exact = await findAccessNodes({
    point,
    nodes: [withCoordinates(node('EXACT'), point.lat, point.lng)],
    router: { routeWalk: async () => { throw new Error('must not route within threshold'); } },
  });
  assert.equal(exact.candidates.length, 1);
  assert.equal(exact.candidates[0].walkingLeg, null);
  assert.equal(exact.candidates[0].walkingDistanceMeters, null);
  assert.equal(exact.candidates[0].withinProximityThreshold, true);

  const thrownProvider = await findAccessNodes({
    point,
    nodes: [goodNear],
    router: { routeWalk: async () => { throw new Error(`provider leaked ${API_KEY}`); } },
    config: { proximityThresholdMeters: 5 },
  });
  assert.deepEqual(thrownProvider.candidates, []);
  assert.equal(thrownProvider.failures[0].code, WALKING_ERROR.PROVIDER_UNAVAILABLE);
  assert.equal(JSON.stringify(thrownProvider).includes(API_KEY), false);

  const query = accessNodeQuery();
  assert.equal(query.filters.planning_enabled, true);
  assert.equal(query.filters.data_mode, 'REAL');
  assert.deepEqual(query.filters.latitude, { $notNull: true });
  let loaderQuery;
  const loaded = await loadEligibleCoordinateNodes({ strapiInstance: { documents: () => ({
    findMany: async (value) => { loaderQuery = value; return [goodNear, research, missingCoordinate]; },
  }) } });
  assert.equal(loaded.length, 1);
  assert.deepEqual(loaderQuery, query);
  assert.equal(DEFAULT_WALKING_CONFIG.maxCandidateCount, 5);
  assert.equal(DEFAULT_WALKING_CONFIG.maxConcurrentRequests, 2);
  console.log('ok - trust, coordinates, Haversine radius, candidate cap and proximity handling protect routing quota');
}

function fixtureRouter() {
  const calls = [];
  return {
    calls,
    async routeWalk({ from, to }) {
      calls.push({ from, to });
      return routeValue(from, to, from.label === 'Synthetic origin' ? 120 : 160);
    },
  };
}

async function testDirectComposition() {
  const fixture = directWalkingFixture();
  const graph = buildTransportGraph(fixture);
  const router = fixtureRouter();
  const result = await planJourneysWithWalkingCandidates({
    origin: fixture.origin,
    destination: fixture.destination,
    nodes: Object.values(fixture.nodes),
    graph,
    router,
    config: { initialCandidateRadiusMeters: 300, maximumCandidateRadiusMeters: 300, maxCandidateCount: 2 },
  });
  assert.equal(result.journeys.length, 1);
  assert.deepEqual(result.journeys[0].legs.map((leg) => leg.type), ['WALK', 'TRANSIT', 'WALK']);
  assert.deepEqual(result.journeys[0].legs.map((leg) => leg.sequence), [1, 2, 3]);
  assert.equal(result.journeys[0].legs[1].variantCode, 'WALK-DIRECT-OUT');
  assert.ok(result.journeys[0].legs[0].geometry);
  assert.ok(result.journeys[0].legs[2].geometry);
  assert.equal(JSON.stringify(result.journeys[0]).includes('fare'), false);
  assert.equal(JSON.stringify(result.journeys[0]).includes('recommendation'), false);
  assert.equal(router.calls.length, 2, 'only one usable boarding and one usable alighting node are routed');

  const noAccessRouter = fixtureRouter();
  const noAccess = await planJourneysWithWalkingCandidates({
    origin: fixture.origin,
    destination: fixture.destination,
    nodes: [fixture.nodes.B],
    graph,
    router: noAccessRouter,
    config: { initialCandidateRadiusMeters: 300, maximumCandidateRadiusMeters: 300 },
  });
  assert.deepEqual(noAccess.journeys, []);
  assert.equal(noAccessRouter.calls.length, 0, 'egress routing is skipped when no boarding candidate exists');
  console.log('ok - direct fixture composes WALK, TRANSIT, WALK without deferred estimates');
}

async function testTransferComposition() {
  const fixture = transferWalkingFixture();
  const result = await planJourneysWithWalkingCandidates({
    origin: fixture.origin,
    destination: fixture.destination,
    nodes: Object.values(fixture.nodes),
    graph: buildTransportGraph(fixture),
    router: fixtureRouter(),
    config: { initialCandidateRadiusMeters: 300, maximumCandidateRadiusMeters: 300, maxCandidateCount: 3 },
  });
  assert.equal(result.journeys.length, 1);
  assert.deepEqual(result.journeys[0].legs.map((leg) => leg.type), [
    'WALK', 'TRANSIT', 'TRANSFER', 'TRANSIT', 'WALK',
  ]);
  assert.equal(result.journeys[0].legs.filter((leg) => leg.type === 'WALK').length, 2);
  assert.equal(result.journeys[0].legs.filter((leg) => leg.type === 'TRANSFER').length, 1);
  assert.equal(result.journeys[0].legs[2].at.nodeCode, fixture.nodes.T.node_code);
  console.log('ok - one-transfer fixture has deterministic WALK, TRANSIT, TRANSFER, TRANSIT, WALK ordering');
}

async function main() {
  await testResponseNormalization();
  await testEmptyMalformedAndCache();
  await testProviderFailures();
  await testCandidateDiscovery();
  await testDirectComposition();
  await testTransferComposition();
  console.log('ok - Geoapify is only invoked with walking mode; PAMANA retains transport selection');
}

main().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
