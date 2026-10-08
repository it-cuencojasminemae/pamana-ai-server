'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { distinctJourneyResults } = require('../src/services/pamana-journey/journey-result-deduplicator');
const { orchestrateTripPlan } = require('../src/services/pamana-journey/trip-plan-orchestrator');
const { directWalkingFixture } = require('./fixtures/phase11-synthetic-network');
// Captured local API results; no live database or provider is needed.
const captured = require('./fixtures/journey-result-duplicates.json');
const runtime = { cases: captured.runtime };
const options = { examples: captured.options };
const clone = value => structuredClone(value);
const shared = runtime.cases.find(c => c.id === 'D').response.journeys.slice(0, 2);

test('recorded direct, jeep-transfer and feeder results collapse equivalent used segments', () => {
  for (const c of runtime.cases.filter(c => ['A','B','C','D'].includes(c.id))) {
    const before = JSON.stringify(c.response);
    const results = distinctJourneyResults(c.response.journeys);
    assert.equal(results.length, c.response.journeys.length - 1, c.id);
    assert.equal(JSON.stringify(c.response), before);
    assert.equal(results[0], c.response.journeys[0]);
  }
  for (const c of options.examples) assert.equal(distinctJourneyResults(c.body.journeys).length, c.body.journeys.length - 1, c.id);
});

test('all recorded return services and other distinct routes remain available', () => {
  for (const c of runtime.cases.filter(c => !['A','B','C','D'].includes(c.id))) {
    assert.deepEqual(distinctJourneyResults(c.response.journeys), c.response.journeys, c.id);
  }
});

test('same titles, fares or endpoints alone cannot merge meaningfully different rides', () => {
  const edits = [
    j => { j.legs[0].route.code = 'OTHER-SERVICE'; },
    j => { j.legs[0].direction = 'INBOUND'; },
    j => { j.legs[0].geometry.coordinates[1][0] += 0.001; },
    j => { j.legs[0].boardAt.nodeCode = 'OTHER-BOARDING'; },
    j => { j.legs[0].alightAt.nodeCode = 'OTHER-DROPOFF'; },
    j => { j.legs[0].signboard = 'Another signboard'; },
    j => { j.legs[0].boardingInstructions.push('Use another boarding side.'); },
    j => { j.legs[0].fare.payableFare += 1; },
    j => { j.legs[0].service.headwayMinutes.maximum += 1; },
    j => { j.legs[0].availability.wait.highMinutes += 1; },
    j => { j.legs[0].durationSeconds += 1; },
    j => { j.warnings.push('DISRUPTION_WARNING'); },
    j => { j.legs.at(-1).distanceMeters += 1; },
  ];
  for (const edit of edits) {
    const changed = clone(shared[1]); edit(changed);
    assert.equal(distinctJourneyResults([shared[0], changed]).length, 2, edit.toString());
  }
  const unknown = clone(shared); unknown.forEach(j => { j.legs[0].geometry = null; });
  assert.equal(distinctJourneyResults(unknown).length, 2);
});

test('duplicate journey IDs and exact repeated results do not create extra cards', () => {
  assert.deepEqual(distinctJourneyResults([shared[0], clone(shared[0]), shared[1]]), [shared[0]]);
});

test('temporary corridor IDs do not duplicate the same point, while placement and permissions stay distinct', () => {
  const pair = clone(shared);
  for (const [index, j] of pair.entries()) {
    const point = { ...j.legs[0].alightAt, nodeId: `connector-${index}`, nodeCode: `CONNECTOR-${index}`,
      connector: { temporary: true, role: 'EGRESS', direction: 'OUTBOUND', evidenceClass: 'LOCAL_RESEARCH',
        placementSource: 'PROVIDER_DERIVED_RESEARCH', sectionId: `section-${index}`, variantCode: `variant-${index}`, offsetMeters: 100 + index } };
    j.legs[0].alightAt = point;
    j.legs.at(-1).from = clone(point);
  }
  assert.equal(distinctJourneyResults(pair).length, 1);
  for (const patch of [{ lat: pair[1].legs[0].alightAt.lat + 0.0001 },
    { connector: { ...pair[1].legs[0].alightAt.connector, role: 'ACCESS' } },
    { connector: { ...pair[1].legs[0].alightAt.connector, evidenceClass: 'VERIFIED_OPERATIONAL' } }]) {
    const changed = clone(pair[1]); Object.assign(changed.legs[0].alightAt, patch);
    assert.equal(distinctJourneyResults([pair[0], changed]).length, 2);
  }
});

test('deduplication precedes the result limit and keeps evidence loads bounded', async () => {
  const data = directWalkingFixture();
  const raw = shared.map(j => ({ ...clone(j), legs: j.legs.map(l => l.type === 'TRANSIT' ? {
    ...clone(l), routeId: l.route.id, routeCode: l.route.code,
    routeVariantId: l.variant.id, variantCode: l.variant.code, rideGeometry: l.geometry,
  } : clone(l)) }));
  const third = clone(raw[0]); third.id = 'distinct-later'; third.legs[0].signboard = 'Different service';
  third.legs[0].variantCode = 'ZZZ-DISTINCT'; third.legs[0].routeVariantId = 'variant-distinct';
  let loads = 0;
  const request = { origin: data.origin, destination: data.destination, departureAt: '2026-10-08T04:00:00Z', passengerCategory: 'REGULAR' };
  const response = await orchestrateTripPlan(request, { config: { maxJourneys: 2 }, expansion: { enabled: false, connections: [], maxTransfers: 1 }, services: {
    loadEligibleCoordinateNodes: async () => Object.values(data.nodes),
    loadEligibleTransportGraphData: async () => data,
    loadEligibleDisruptions: async () => [],
    planJourneysWithWalkingCandidates: async () => ({ accessCandidates: [{}], egressCandidates: [{}], journeys: [...raw, third], failures: [] }),
    loadFareAndServiceData: async ({ journey }) => {
      loads++; assert.ok(journey.legs.filter(l => l.type === 'TRANSIT').length <= 2);
      return { fareRules: [], servicePatterns: [] };
    },
    loadOperationalData: async () => ({ operationalRecords: [] }),
  } });
  assert.equal(loads, 2, 'refill only when equivalent journeys consumed a batch');
  assert.deepEqual(response.journeys.map(j => j.id), [shared[0].id, third.id]);
  assert.equal(response.meta.journeyCount, 2);
  for (const choice of Object.values(response.recommendations)) if (choice.journeyId) assert.ok(response.journeys.some(j => j.id === choice.journeyId));
});
