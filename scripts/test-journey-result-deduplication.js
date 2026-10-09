'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { distinctJourneyResults, resultKey } = require('../src/services/pamana-journey/journey-result-deduplicator');
const { orchestrateTripPlan } = require('../src/services/pamana-journey/trip-plan-orchestrator');
const { recommendJourneys } = require('../src/services/pamana-journey/journey-recommendations');
const { directWalkingFixture } = require('./fixtures/phase11-synthetic-network');
const captured = require('./fixtures/journey-result-duplicates.json');
const clone = value => structuredClone(value);
const shared = captured.runtime.find(c => c.id === 'D').response.journeys.slice(0, 2);

// Earlier tests merged distinct variant IDs on a shared corridor. The final
// contract explicitly preserves those services, even with identical geometry.
test('captured route variants, directions and return services remain distinct', () => {
  for (const c of captured.runtime) {
    const before = JSON.stringify(c.response);
    assert.deepEqual(distinctJourneyResults(c.response.journeys), c.response.journeys, c.id);
    assert.equal(JSON.stringify(c.response), before);
  }
  for (const c of captured.options) assert.deepEqual(distinctJourneyResults(c.body.journeys), c.body.journeys, c.id);
});

function walkOption(id, meters, seconds = meters) {
  const journey = clone(shared[0]); journey.id = id;
  const walk = journey.legs.find(l => l.type === 'WALK');
  walk.distanceMeters = meters; walk.durationSeconds = seconds;
  journey.durationSummary.totalJourneyDurationSeconds = 2100 + seconds;
  return journey;
}

test('101m/37min and 201m/38min walks on one journey collapse to the best complete representative', () => {
  const near = walkOption('near', 101, 60), far = walkOption('far', 201, 120);
  near.legs.at(-1).geometry.coordinates[0][1][0] += 0.0001;
  const before = JSON.stringify([far, near]);
  assert.deepEqual(distinctJourneyResults([far, near, clone(near)]), [near]);
  assert.equal(JSON.stringify([far, near]), before);
  assert.equal(distinctJourneyResults([far, near])[0].legs, near.legs);
});

test('equal-distance walking alternatives choose the quicker valid connection regardless of input order', () => {
  const slow = walkOption('slow', 101, 120), quick = walkOption('quick', 101, 60);
  assert.deepEqual(distinctJourneyResults([slow, quick]), [quick]);
  assert.deepEqual(distinctJourneyResults([quick, slow]), [quick]);
  const unknown = walkOption('unknown', 101); unknown.legs.at(-1).distanceMeters = null;
  assert.deepEqual(distinctJourneyResults([unknown, quick]), [quick]);
});

test('stable route variants, meaningful boarding/dropoff locations and passenger constraints are preserved', () => {
  const edits = [
    j => { j.legs[0].variant.id = 'OTHER-VARIANT'; },
    j => { j.legs[0].route.code = 'OTHER-SERVICE'; },
    j => { j.legs[0].direction = 'INBOUND'; },
    j => { j.legs[0].geometry.coordinates[1][0] += 0.001; },
    j => { j.legs[0].boardAt.nodeCode = 'OTHER-BOARDING'; },
    j => { j.legs[0].alightAt.nodeCode = 'OTHER-DROPOFF'; },
    j => { j.legs[0].boardingInstructions.push('Use another boarding side.'); },
    j => { j.legs[0].fare.payableFare += 1; },
    j => { j.legs[0].service.headwayMinutes.maximum += 1; },
    j => { j.warnings.push('DISRUPTION_WARNING'); },
    j => { j.legs.at(-1).wheelchairAccessible = true; },
    j => { j.accessibilityRequirements = ['STEP_FREE']; },
  ];
  for (const edit of edits) {
    const changed = clone(shared[0]); edit(changed);
    assert.equal(distinctJourneyResults([shared[0], changed]).length, 2, edit.toString());
  }
  const unknown = clone(shared); unknown.forEach(j => { j.legs[0].geometry = null; });
  assert.equal(distinctJourneyResults(unknown).length, 2);
});

function groupedOption(id, meters, offset, group = 'same-approved-section-and-stop-interval') {
  const j = walkOption(id, meters);
  j.legs[0].boardAt = { ...j.legs[0].boardAt, nodeId: `connector-${id}`, nodeCode: `CONNECTOR-${id}`,
    lat: 15 + offset / 100000, lng: 120, connector: { temporary: true, candidateGroupId: group,
      role: 'ACCESS', sectionId: 'section', direction: 'OUTBOUND', evidenceClass: 'LOCAL_RESEARCH',
      placementSource: 'PROVIDER_DERIVED_RESEARCH', fieldBoardingSideVerified: false, offsetMeters: offset } };
  j.legs[0].geometry.coordinates[0][0] += offset / 100000;
  return j;
}

test('only explicit roadside probe groups collapse; sections, permanent stops and boarding sides stay distinct', () => {
  const near = groupedOption('near', 101, 500), far = groupedOption('far', 201, 600);
  assert.deepEqual(distinctJourneyResults([far, near]), [near]);
  for (const patch of [{ candidateGroupId: 'another-stop-interval' }, { sectionId: 'another-section' },
    { fieldBoardingSideVerified: true }, { role: 'EGRESS' }, { evidenceClass: 'VERIFIED_OPERATIONAL' }]) {
    const changed = clone(far); Object.assign(changed.legs[0].boardAt.connector, patch);
    assert.equal(distinctJourneyResults([near, changed]).length, 2);
  }
  const exactOnly = clone([near, far]); exactOnly.forEach(j => { delete j.legs[0].boardAt.connector.candidateGroupId; });
  assert.equal(distinctJourneyResults(exactOnly).length, 2);
  assert.equal(distinctJourneyResults([near, shared[0]]).length, 2);
});

test('ordered rides and transfer connection identities cannot be merged', () => {
  const j = clone(captured.runtime.find(c => c.id === 'B').response.journeys[0]);
  const changed = clone(j); changed.legs.find(l => l.type === 'TRANSFER').connectionId = 'OTHER-TRANSFER';
  assert.equal(distinctJourneyResults([j, changed]).length, 2);
  changed.legs.reverse(); assert.notEqual(resultKey(j), resultKey(changed));
});

async function orchestrate(raw, maxJourneys = 2) {
  const data = directWalkingFixture(); let loads = 0;
  const candidates = raw.map(j => ({ ...clone(j), dataQuality: { planningEligible: true,
    verificationStatuses: ['FIELD_VERIFIED'], dataModes: ['REAL'] }, legs: j.legs.map(l => l.type === 'TRANSIT' ? {
    ...clone(l), routeId: l.route.id, routeCode: l.route.code,
    routeVariantId: l.variant.id, variantCode: l.variant.code, rideGeometry: l.geometry,
  } : clone(l)) }));
  const response = await orchestrateTripPlan({ origin: data.origin, destination: data.destination,
    departureAt: '2026-10-08T04:00:00Z', passengerCategory: 'REGULAR' }, {
    config: { maxJourneys }, expansion: { enabled: false, connections: [], maxTransfers: 1 }, services: {
      loadEligibleCoordinateNodes: async () => Object.values(data.nodes),
      loadEligibleTransportGraphData: async () => data,
      loadEligibleDisruptions: async () => [],
      planJourneysWithWalkingCandidates: async () => ({ accessCandidates: [{}], egressCandidates: [{}], journeys: candidates, failures: [] }),
      loadFareAndServiceData: async ({ journey }) => {
        loads++; assert.ok(journey.legs.filter(l => l.type === 'TRANSIT').length <= maxJourneys);
        return { fareRules: [], servicePatterns: [] };
      },
      loadOperationalData: async () => ({ operationalRecords: [] }),
    },
  });
  return { response, loads };
}

test('deduplication checks later batches before ranking/limiting and recalculates category IDs', async () => {
  const far = walkOption('far', 201), near = walkOption('near', 101);
  const { response, loads } = await orchestrate([far, shared[1], near]);
  assert.equal(loads, 2);
  assert.equal(response.journeys.length, 2);
  assert.ok(response.journeys.some(j => j.id === 'near'));
  assert.ok(!response.journeys.some(j => j.id === 'far'));
  assert.equal(response.meta.journeyCount, 2);
  for (const choice of Object.values(response.recommendations)) if (choice.journeyId)
    assert.ok(response.journeys.some(j => j.id === choice.journeyId));
});

test('one unique journey remains one and no transport returns an honest empty response', async () => {
  const { response } = await orchestrate([walkOption('far', 201), walkOption('near', 101)]);
  assert.equal(response.journeys.length, 1);
  assert.equal(response.journeys[0].id, 'near');
  for (const key of ['recommended', 'fewestTransfers']) assert.equal(response.recommendations[key].journeyId, 'near');
  if (response.journeys[0].fareSummary.totalStatus === 'KNOWN') assert.equal(response.recommendations.cheapest.journeyId, 'near');
  const { response: empty } = await orchestrate([]);
  assert.equal(empty.status, 'NO_TRANSPORT_JOURNEY'); assert.equal(empty.meta.journeyCount, 0);
  for (const choice of Object.values(empty.recommendations)) assert.equal(choice.journeyId, null);
});

test('one sufficiently evidenced journey receives all five categories; unknown reliability remains unavailable', () => {
  const j = walkOption('only', 101);
  j.dataQuality.researchPreview = false; j.dataQuality.dataModes = ['REAL'];
  const ranks = recommendJourneys([j]);
  for (const choice of Object.values(ranks)) assert.equal(choice.journeyId, j.id);
  j.legs[0].availability.status = 'UNKNOWN';
  assert.equal(recommendJourneys([j]).mostReliable.journeyId, null);
});

test('preference-loading failures are sanitized and invalid planning modes keep their domain status', async () => {
  const { createTripPlanHandler } = require('../src/api/pamana-ai/controllers/trip-plan');
  const previous = global.strapi;
  try {
    global.strapi = { documents: () => ({ findMany: async () => { throw new Error('select private passenger SQL; secret=hidden'); } }) };
    const handler = createTripPlanHandler();
    const ctx = { state: { user: { id: 2147483646, role: { name: 'Passenger' } } }, request: { body: {} } };
    await handler(ctx);
    assert.equal(ctx.status, 503); assert.equal(ctx.body.status, 'SERVICE_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(ctx.body), /SQL|secret|private/);
    ctx.request.body.planningMode = 'INVALID_MODE'; await handler(ctx);
    assert.equal(ctx.status, 400); assert.equal(ctx.body.status, 'INVALID_PLANNING_MODE');
  } finally { global.strapi = previous; }
});
