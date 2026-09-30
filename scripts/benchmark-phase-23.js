'use strict';

// Reproducible synthetic benchmark. No DB connection or live provider request.
const { performance } = require('node:perf_hooks');
const { orchestrateTripPlan } = require('../src/services/pamana-journey/trip-plan-orchestrator');
const { createWalkingRouter } = require('../src/services/pamana-journey/walking-router');
const { directWalkingFixture } = require('./fixtures/phase11-synthetic-network');
const { operationalRecord } = require('./fixtures/phase13-synthetic-availability');
const fixture = directWalkingFixture();
const clock = new Date('2026-09-28T00:00:00.000Z');
const operations = Array.from({ length: 8 }, (_, index) => operationalRecord(fixture.variants[0], { code: String(index) }));
const counts = {};
let providerCalls = 0, activeLocations = 0, peakLocations = 0;
const strapiInstance = { documents(uid) { return {
  async findMany() {
    counts[uid] = (counts[uid] || 0) + 1;
    if (uid === 'api::transport-node.transport-node') return Object.values(fixture.nodes);
    if (uid === 'api::route-variant.route-variant') return fixture.variants;
    if (uid === 'api::trip.trip') return operations.map(record => record.trip);
    if (uid === 'api::vehicle.vehicle') return operations.map(record => record.vehicle);
    if (uid === 'api::vehicle-location.vehicle-location') return operations.map(record => record.location);
    return [];
  },
  async findFirst(query) {
    counts[uid] = (counts[uid] || 0) + 1;
    peakLocations = Math.max(peakLocations, ++activeLocations);
    await new Promise(resolve => setTimeout(resolve, 1));
    activeLocations--;
    return operations.find(record => record.vehicle.documentId === query.filters.vehicle.documentId)?.location || null;
  },
}; } };
if (!process.argv.includes('--fresh-router')) {
  const connection = () => {
    counts['latest-location-id-selection'] = (counts['latest-location-id-selection'] || 0) + 1;
    const query = {};
    for (const method of ['join', 'distinctOn', 'select', 'where', 'orderBy']) query[method] = () => query;
    query.then = (resolve, reject) => (async () => {
      peakLocations = Math.max(peakLocations, ++activeLocations);
      await new Promise(done => setTimeout(done, 1)); activeLocations--;
      return operations.map(record => ({ tripId: record.trip.documentId, vehicleId: record.vehicle.documentId, locationId: record.location.documentId }));
    })().then(resolve, reject);
    return query;
  };
  connection.client = { config: { client: 'pg' } };
  strapiInstance.db = { connection };
}
const makeRouter = () => createWalkingRouter({
  apiKey: 'synthetic-benchmark-only', now: () => clock,
  fetcher: async (url) => {
    providerCalls++;
    await new Promise(resolve => setTimeout(resolve, 5));
    const points = new URL(url).searchParams.get('waypoints').split('|').map(point => point.split(',').map(Number).reverse());
    return { ok: true, json: async () => ({ type: 'FeatureCollection', features: [{
      type: 'Feature', geometry: { type: 'LineString', coordinates: points }, properties: { distance: 120, time: 90 },
    }] }) };
  },
});

(async () => {
  const durations = [], router = makeRouter();
  for (let index = 0; index < 10; index++) {
    const started = performance.now();
    const result = await orchestrateTripPlan({
      origin: fixture.origin, destination: fixture.destination,
      departureAt: clock.toISOString(), passengerCategory: 'REGULAR',
    }, { strapiInstance, router: process.argv.includes('--fresh-router') ? makeRouter() : router, now: () => clock });
    if (result.status !== 'JOURNEYS_FOUND') throw new Error('Synthetic journey unavailable');
    durations.push(performance.now() - started);
  }
  console.log(JSON.stringify({
    scope: '10 synthetic identical direct plans; provider delay 5ms; location delay 1ms; 8 active synthetic vehicles',
    providerCalls, peakConcurrentLocationReads: peakLocations,
    medianMs: Number([...durations].sort((a, b) => a - b)[5].toFixed(2)),
    firstMs: Number(durations[0].toFixed(2)), totalLoaderCalls: Object.values(counts).reduce((a, b) => a + b, 0), loaderCalls: counts,
  }, null, 2));
})().catch(() => { console.error('Synthetic benchmark failed.'); process.exitCode = 1; });
