'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createWalkingRouter, getDefaultWalkingRouter } = require('../src/services/pamana-journey/walking-router');
const { walkingConfig } = require('../src/services/pamana-journey/walking-config');
const { findAccessNodes } = require('../src/services/pamana-journey/access-node-finder');
const { loadOperationalData } = require('../src/services/pamana-journey/availability-data-loader');
const { orchestrateTripPlan } = require('../src/services/pamana-journey/trip-plan-orchestrator');
const { directWalkingFixture, withCoordinates } = require('./fixtures/phase11-synthetic-network');
const { node } = require('./fixtures/phase10-synthetic-network');
const { operationalRecord } = require('./fixtures/phase13-synthetic-availability');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const from = { lat: 14.5994, lng: 120.9794, label: 'Synthetic start' };
const to = { lat: 14.6, lng: 120.98, label: 'Synthetic end' };
const key = 'synthetic-performance-only';
const reply = url => ({ ok: true, json: async () => ({ type: 'FeatureCollection', features: [{
  type: 'Feature', properties: { distance: 120, time: 90 }, geometry: {
    type: 'LineString', coordinates: new URL(url).searchParams.get('waypoints').split('|').map(point => point.split(',').map(Number).reverse()),
  },
}] }) });

async function sharedWalking() {
  let calls = 0, time = 0, underlying;
  const router = createWalkingRouter({ apiKey: key, now: () => new Date(time), config: { cacheTtlMs: 10, cacheMaxEntries: 2 },
    fetcher: async (url, options) => { calls++; underlying = options.signal; await wait(8); return reply(url); },
  });
  const cancel = new AbortController();
  const first = router.routeWalk({ from, to, signal: cancel.signal });
  const second = router.routeWalk({ from: { ...from, label: 'Second passenger' }, to });
  cancel.abort();
  assert.equal((await first).error.code, 'ROUTING_CANCELLED');
  assert.equal(underlying.aborted, false, 'one subscriber must not cancel another passenger');
  const result = await second;
  assert.equal(calls, 1);
  assert.equal(result.value.from.label, 'Second passenger');
  result.value.geometry.coordinates[0][0] = 0;
  const cached = await router.routeWalk({ from: { ...from, label: 'Third passenger' }, to });
  assert.equal(cached.value.from.label, 'Third passenger');
  assert.equal(cached.value.geometry.coordinates[0][0], from.lng);
  assert.equal(calls, 1);
  time = 11;
  await router.routeWalk({ from, to });
  assert.equal(calls, 2, 'expired walking geography must be refreshed');
  await router.routeWalk({ from: { ...from, lat: from.lat + 0.0000001 }, to });
  assert.equal(calls, 3, 'nearby coordinates must not share factual walking endpoints');
  const aborted = new AbortController(); aborted.abort();
  assert.equal((await router.routeWalk({ from, to, signal: aborted.signal })).error.code, 'ROUTING_CANCELLED');
  assert.equal(calls, 3);
  let failures = 0;
  const failing = createWalkingRouter({ apiKey: key, fetcher: async () => { failures++; return { ok: false, status: 429 }; } });
  await failing.routeWalk({ from, to }); await failing.routeWalk({ from, to });
  assert.equal(failures, 2, 'provider failures must not be cached');
  let providerAbort;
  const cancellable = createWalkingRouter({ apiKey: key, fetcher: (_, options) => {
    providerAbort = options.signal;
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
  } });
  const soloAbort = new AbortController();
  const solo = cancellable.routeWalk({ from, to, signal: soloAbort.signal });
  soloAbort.abort();
  assert.equal((await solo).error.code, 'ROUTING_CANCELLED');
  assert.equal(providerAbort.aborted, true);
  console.log('ok - walking requests coalesce, cancellation is isolated, TTL and clones protect geography and passenger labels');
}

async function defaultReuse() {
  const savedKey = process.env.GEOAPIFY_SERVER_API_KEY, savedFetch = global.fetch;
  const fixture = directWalkingFixture();
  let calls = 0;
  try {
    process.env.GEOAPIFY_SERVER_API_KEY = key;
    global.fetch = async url => { calls++; return reply(url); };
    assert.equal(getDefaultWalkingRouter(), getDefaultWalkingRouter());
    const services = {
      loadEligibleCoordinateNodes: async () => Object.values(fixture.nodes),
      loadEligibleTransportGraphData: async () => ({ variants: fixture.variants }),
      loadEligibleDisruptions: async () => [],
      loadFareAndServiceData: async () => ({ fareRules: [], servicePatterns: [] }),
      loadOperationalData: async () => ({ operationalRecords: [] }),
    };
    const request = { origin: fixture.origin, destination: fixture.destination, departureAt: '2026-09-28T00:00:00Z', passengerCategory: 'REGULAR' };
    const options = { services, now: () => new Date(request.departureAt) };
    const first = await orchestrateTripPlan(request, options);
    const second = await orchestrateTripPlan(request, options);
    assert.equal(first.status, 'JOURNEYS_FOUND');
    assert.deepEqual(first, second, 'reuse must preserve ordering, facts, null geometry and unknown estimates');
    assert.equal(calls, 2, 'the production default must retain walking cache across trip requests');
    const prior = getDefaultWalkingRouter();
    process.env.GEOAPIFY_SERVER_API_KEY = `${key}-rotated`;
    assert.notEqual(getDefaultWalkingRouter(), prior, 'configuration rotation invalidates the shared router');
  } finally {
    global.fetch = savedFetch;
    if (savedKey === undefined) delete process.env.GEOAPIFY_SERVER_API_KEY;
    else process.env.GEOAPIFY_SERVER_API_KEY = savedKey;
  }
  console.log('ok - production orchestrator reuses geography across requests without caching planning facts');
}

async function bounds() {
  const config = walkingConfig({ maxCandidateCount: 100, maxConcurrentRequests: 100, requestTimeoutMs: 1e9, cacheTtlMs: 1e9 });
  assert.equal(config.maxCandidateCount, 5); assert.equal(config.maxConcurrentRequests, 2);
  assert.equal(config.requestTimeoutMs, 30000); assert.equal(config.cacheTtlMs, 300000);
  const nodes = Array.from({ length: 50 }, (_, index) => withCoordinates(node(`PERF-${index}`), from.lat + (index + 1) * 0.0003, from.lng));
  let calls = 0, active = 0, peak = 0;
  const result = await findAccessNodes({ point: from, nodes, config, router: { async routeWalk({ from, to }) {
    calls++; peak = Math.max(peak, ++active); await wait(2); active--;
    return { ok: true, value: { from, to, geometry: { type: 'LineString', coordinates: [[from.lng, from.lat], [to.lng, to.lat]] }, distanceMeters: 100, durationSeconds: 90 } };
  } } });
  assert.equal(result.candidates.length, 5); assert.equal(calls, 5); assert.equal(peak, 2);
  const fixture = directWalkingFixture();
  const operations = Array.from({ length: 9 }, (_, index) => operationalRecord(fixture.variants[0], { code: String(index) }));
  active = 0; peak = 0; let loads = 0;
  const strapiInstance = { documents(uid) { return {
    findMany: async () => uid === 'api::trip.trip' ? operations.map(record => record.trip) : operations.map(record => record.vehicle),
    findFirst: async query => {
      loads++; peak = Math.max(peak, ++active); await wait(1); active--;
      assert.equal(query.filters.data_mode, 'REAL');
      return operations.find(record => record.vehicle.documentId === query.filters.vehicle.documentId).location;
    },
  }; } };
  const data = await loadOperationalData({ journey: { legs: [{ type: 'TRANSIT', routeVariantId: fixture.variants[0].documentId }] }, strapiInstance });
  assert.equal(peak, 4); assert.equal(loads, 9); assert.equal(data.operationalRecords.length, 9);
  let selections = 0, documents = 0;
  const connection = () => {
    selections++;
    const query = {};
    for (const method of ['join', 'distinctOn', 'select', 'where', 'orderBy']) query[method] = () => query;
    query.then = (resolve, reject) => Promise.resolve(operations.map(record => ({
      tripId: record.trip.documentId, vehicleId: record.vehicle.documentId, locationId: record.location.documentId,
    }))).then(resolve, reject);
    return query;
  };
  connection.client = { config: { client: 'pg' } };
  const batchStrapi = { db: { connection }, documents(uid) { return { findMany: async query => {
    documents++;
    if (uid === 'api::trip.trip') return operations.map(record => record.trip);
    if (uid === 'api::vehicle.vehicle') return operations.map(record => record.vehicle);
    assert.equal(query.filters.data_mode, 'REAL');
    assert.equal(query.filters.documentId.$in.length, 9);
    return operations.map(record => record.location);
  } }; } };
  const batch = await loadOperationalData({ journey: { legs: [{ type: 'TRANSIT', routeVariantId: fixture.variants[0].documentId }] }, strapiInstance: batchStrapi });
  assert.equal(selections, 1); assert.equal(documents, 3);
  assert.deepEqual(batch, data, 'batch loading must preserve ordered operational evidence');
  console.log('ok - candidate bounds, portable concurrency and four-call PostgreSQL evidence loading preserve exact REAL records');
}

(async () => {
  await sharedWalking(); await defaultReuse(); await bounds();
  const source = fs.readFileSync(path.join(__dirname, '../src/api/live-vehicle/controllers/live-vehicle.js'), 'utf8');
  assert.match(source, /loadLatestLocations/);
  assert.doesNotMatch(source, /findFirst/);
  assert.doesNotMatch(source, /cache|setInterval/);
})().catch(error => { console.error(`FAIL: ${error.message}`); process.exitCode = 1; });
