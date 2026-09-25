'use strict';

const assert = require('node:assert/strict');
const fareRuleSchema = require('../src/api/fare-rule/content-types/fare-rule/schema.json');
const servicePatternSchema = require('../src/api/service-pattern/content-types/service-pattern/schema.json');
const routeStopSchema = require('../src/api/route-variant-stop/content-types/route-variant-stop/schema.json');
const { buildTransportGraph } = require('../src/services/pamana-journey/graph-builder');
const { planJourneys } = require('../src/services/pamana-journey/journey-planner');
const {
  FARE_STATUS,
  evaluateFareForLeg,
} = require('../src/services/pamana-journey/fare-engine');
const {
  enrichJourneyInformation,
} = require('../src/services/pamana-journey/journey-information-enricher');
const {
  fareRuleQuery,
  loadFareAndServiceData,
  servicePatternQuery,
} = require('../src/services/pamana-journey/fare-service-data-loader');
const {
  SERVICE_STATUS,
  WINDOW_STATUS,
  evaluateServiceForLeg,
} = require('../src/services/pamana-journey/service-pattern-engine');
const { composeWalkingJourneys } = require('../src/services/pamana-journey/walking-journey-composer');
const {
  directFixture,
  transferFixture,
} = require('./fixtures/phase10-synthetic-network');
const {
  distanceFareFixture,
  fareRule,
  servicePattern,
} = require('./fixtures/phase12-synthetic-information');

const REQUESTED = '2026-09-28T08:00:00+08:00';

function journeyFor(fixture, origin, destination) {
  return planJourneys(buildTransportGraph(fixture), {
    candidateBoardingNodeIds: [origin],
    candidateDestinationNodeIds: [destination],
  })[0];
}

function walkLeg(from, to) {
  return Object.freeze({
    type: 'WALK', from, to, distanceMeters: 100, durationSeconds: 80,
    geometry: { type: 'LineString', coordinates: [[120, 14], [120.001, 14.001]] },
    instructions: Object.freeze([]), source: 'GEOAPIFY', calculatedAt: REQUESTED,
  });
}

{
  const fareFields = fareRuleSchema.attributes;
  assert.ok(fareFields.route && fareFields.route_variant);
  assert.deepEqual(fareFields.fare_type.enum, ['FLAT', 'DISTANCE_BASED', 'ZONE', 'MANUAL_LOOKUP']);
  assert.ok(fareFields.regular_base_fare && fareFields.base_distance_km && fareFields.per_km_after_base);
  assert.ok(fareFields.student_discount_percent && fareFields.senior_discount_percent && fareFields.pwd_discount_percent);
  assert.ok(fareFields.effective_from && fareFields.effective_to);
  assert.equal(Object.hasOwn(fareFields, 'origin_node'), false);
  assert.equal(Object.hasOwn(fareFields, 'destination_node'), false);

  const serviceFields = servicePatternSchema.attributes;
  assert.deepEqual(serviceFields.dispatch_type.enum, [
    'SCHEDULED', 'HEADWAY', 'LEAVE_WHEN_FULL', 'CONTINUOUS_UNSCHEDULED', 'UNKNOWN',
  ]);
  assert.ok(serviceFields.days_of_week && serviceFields.first_trip_time && serviceFields.last_trip_time);
  assert.ok(serviceFields.headway_min_minutes && serviceFields.headway_max_minutes);
  assert.equal(Object.hasOwn(serviceFields, 'scheduled_departures'), false);
  assert.ok(routeStopSchema.attributes.distance_from_variant_start_m);
  console.log('ok - Phase 12 uses the actual fare, service-pattern and cumulative stop-distance schemas');
}

{
  const fixture = distanceFareFixture();
  const journey = journeyFor(fixture, fixture.nodes.A.id, fixture.nodes.C.id);
  const leg = journey.legs[0];
  assert.equal(leg.segmentDistanceMeters, 5000);
  const broad = fareRule('BROAD', { routeRecord: fixture.route, regularFare: 30 });
  const specific = fareRule('SPECIFIC', { variantRecord: fixture.variant, regularFare: 20 });
  const research = fareRule('RESEARCH', {
    variantRecord: fixture.variant,
    regularFare: 5,
    overrides: { planning_enabled: false, verification_status: 'CORROBORATED_RESEARCH' },
  });
  const fare = evaluateFareForLeg(leg, {
    fareRules: [broad, research, specific], requestedDate: REQUESTED,
  });
  assert.equal(fare.status, FARE_STATUS.KNOWN);
  assert.equal(fare.regularFare, 20);
  assert.equal(fare.payableFare, 20);
  assert.equal(fare.appliedRuleId, specific.documentId);
  assert.equal(JSON.stringify(fare).includes('base_fare'), false);

  const incompleteSpecific = fareRule('INCOMPLETE-SPECIFIC', {
    variantRecord: fixture.variant,
    fareType: 'MANUAL_LOOKUP',
    regularFare: null,
  });
  const noSilentFallback = evaluateFareForLeg(leg, {
    fareRules: [broad, incompleteSpecific], requestedDate: REQUESTED,
  });
  assert.equal(noSilentFallback.status, FARE_STATUS.PARTIAL);
  assert.equal(noSilentFallback.appliedRuleId, incompleteSpecific.documentId);
  assert.equal(noSilentFallback.regularFare, null);

  const expired = fareRule('EXPIRED', {
    variantRecord: fixture.variant,
    regularFare: 1,
    overrides: { effective_to: '2025-12-31' },
  });
  const future = fareRule('FUTURE', {
    variantRecord: fixture.variant,
    regularFare: 2,
    overrides: { effective_from: '2030-01-01' },
  });
  const historical = fareRule('HISTORICAL', {
    variantRecord: fixture.variant,
    regularFare: 3,
    overrides: { verification_status: 'HISTORICAL_UNVERIFIED' },
  });
  const simulated = fareRule('SIMULATED', {
    variantRecord: fixture.variant,
    regularFare: 4,
    overrides: { verification_status: 'SIMULATED_DEMO', data_mode: 'SIMULATED' },
  });
  for (const rule of [expired, future, historical, simulated]) {
    const result = evaluateFareForLeg(leg, { fareRules: [rule], requestedDate: REQUESTED });
    assert.equal(result.status, FARE_STATUS.UNKNOWN);
    assert.equal(result.regularFare, null);
  }
  const localDateRule = fareRule('LOCAL-DATE', {
    variantRecord: fixture.variant,
    regularFare: 21,
    overrides: { effective_from: '2026-09-29' },
  });
  assert.equal(evaluateFareForLeg(leg, {
    fareRules: [localDateRule], requestedDate: '2026-09-28T17:00:00Z',
  }).regularFare, 21, 'fare effective dates use the Philippine-local calendar date');
  console.log('ok - variant fare precedence is deterministic and ineligible evidence never reaches guidance');
}

{
  const fixture = distanceFareFixture();
  const graph = buildTransportGraph(fixture);
  const pairs = [
    [fixture.nodes.A.id, fixture.nodes.B.id, 2000, 10],
    [fixture.nodes.B.id, fixture.nodes.C.id, 3000, 12],
    [fixture.nodes.A.id, fixture.nodes.C.id, 5000, 16],
  ];
  for (const [origin, destination, distance, expectedFare] of pairs) {
    const leg = planJourneys(graph, {
      candidateBoardingNodeIds: [origin], candidateDestinationNodeIds: [destination],
    })[0].legs[0];
    assert.equal(leg.segmentDistanceMeters, distance);
    const result = evaluateFareForLeg(leg, {
      fareRules: [fixture.distanceRule], requestedDate: REQUESTED,
    });
    assert.equal(result.regularFare, expectedFare);
  }
  const unknownDistanceLeg = { ...planJourneys(graph, {
    candidateBoardingNodeIds: [fixture.nodes.A.id], candidateDestinationNodeIds: [fixture.nodes.C.id],
  })[0].legs[0], segmentDistanceMeters: null };
  const partial = evaluateFareForLeg(unknownDistanceLeg, {
    fareRules: [fixture.distanceRule], requestedDate: REQUESTED,
  });
  assert.equal(partial.status, FARE_STATUS.PARTIAL);
  assert.equal(partial.regularFare, null);
  assert.notEqual(partial.regularFare, 0);
  console.log('ok - distance rules price exact through-route segments only when cumulative stop distances exist');
}

{
  const fixture = directFixture();
  const leg = journeyFor(fixture, fixture.nodes.A.id, fixture.nodes.C.id).legs[0];
  assert.equal(leg.segmentDistanceMeters, null, 'missing cumulative distance is never converted to zero');
  const unknown = evaluateFareForLeg(leg, { fareRules: [], requestedDate: REQUESTED });
  assert.equal(unknown.status, FARE_STATUS.UNKNOWN);
  assert.equal(unknown.regularFare, null);
  assert.equal(unknown.payableFare, null);

  const discountRule = fareRule('DISCOUNT', {
    variantRecord: fixture.variants[0],
    regularFare: 20,
    overrides: { student_discount_percent: 20 },
  });
  const student = evaluateFareForLeg(leg, {
    fareRules: [discountRule], passengerCategory: 'STUDENT', requestedDate: REQUESTED,
  });
  assert.equal(student.regularFare, 20);
  assert.equal(student.discountedFare, 16);
  assert.equal(student.payableFare, 16);
  assert.equal(student.discountType, 'STUDENT');

  const noBase = fareRule('NO-BASE', {
    variantRecord: fixture.variants[0],
    regularFare: null,
    overrides: { student_discount_percent: 20 },
  });
  const unresolvedStudent = evaluateFareForLeg(leg, {
    fareRules: [noBase], passengerCategory: 'STUDENT', requestedDate: REQUESTED,
  });
  assert.equal(unresolvedStudent.status, FARE_STATUS.PARTIAL);
  assert.equal(unresolvedStudent.regularFare, null);
  assert.equal(unresolvedStudent.discountedFare, null);
  assert.equal(unresolvedStudent.payableFare, null);
  console.log('ok - discounts require both an explicit percentage and a known regular fare');
}

{
  const fixture = transferFixture();
  const transitJourney = journeyFor(fixture, fixture.nodes.A.id, fixture.nodes.D.id);
  const accessCandidate = {
    node: { nodeId: fixture.nodes.A.id },
    walkingLeg: walkLeg({ lat: 1, lng: 1 }, { lat: 1.01, lng: 1.01 }),
    walkingDistanceMeters: 100,
  };
  const egressCandidate = {
    node: { nodeId: fixture.nodes.D.id },
    walkingLeg: walkLeg({ lat: 2, lng: 2 }, { lat: 2.01, lng: 2.01 }),
    walkingDistanceMeters: 100,
  };
  const composed = composeWalkingJourneys([transitJourney], {
    accessCandidates: [accessCandidate], egressCandidates: [egressCandidate],
  })[0];
  const firstLegRule = fareRule('FIRST-LEG', {
    variantRecord: fixture.variants[0], regularFare: 15,
  });
  const enriched = enrichJourneyInformation(composed, {
    fareRules: [firstLegRule], requestedDeparture: REQUESTED,
  });
  assert.deepEqual(enriched.legs.map((leg) => leg.type), [
    'WALK', 'TRANSIT', 'TRANSFER', 'TRANSIT', 'WALK',
  ]);
  assert.equal(enriched.legs[0].fare.status, FARE_STATUS.NOT_APPLICABLE);
  assert.equal(enriched.legs[2].fare.status, FARE_STATUS.NOT_APPLICABLE);
  assert.equal(enriched.legs[4].fare.status, FARE_STATUS.NOT_APPLICABLE);
  assert.equal(enriched.legs[1].fare.payableFare, 15);
  assert.equal(enriched.legs[3].fare.payableFare, null);
  assert.equal(enriched.fareSummary.totalStatus, FARE_STATUS.PARTIAL);
  assert.equal(enriched.fareSummary.knownSubtotal, 15);
  assert.equal(enriched.fareSummary.totalFare, null);

  const fullyKnown = enrichJourneyInformation(transitJourney, {
    fareRules: [
      firstLegRule,
      fareRule('SECOND-LEG', { variantRecord: fixture.variants[1], regularFare: 18 }),
    ],
    requestedDeparture: REQUESTED,
  });
  assert.equal(fullyKnown.fareSummary.totalStatus, FARE_STATUS.KNOWN);
  assert.equal(fullyKnown.fareSummary.totalFare, 33);
  console.log('ok - multi-leg totals remain partial until every required transit fare is known');
}

{
  const fixture = directFixture();
  const leg = journeyFor(fixture, fixture.nodes.A.id, fixture.nodes.C.id).legs[0];
  const pattern = servicePattern('HEADWAY', fixture.variants[0]);
  const frequency = evaluateServiceForLeg(leg, {
    servicePatterns: [pattern], requestedDeparture: REQUESTED,
  });
  assert.equal(frequency.status, SERVICE_STATUS.KNOWN);
  assert.equal(frequency.operatingMode, 'FREQUENCY_BASED');
  assert.deepEqual(frequency.headwayMinutes, { minimum: 10, maximum: 15 });
  assert.equal(frequency.windowStatus, WINDOW_STATUS.WITHIN);
  assert.equal(Object.hasOwn(frequency, 'predictedWait'), false);

  const scheduled = evaluateServiceForLeg(leg, {
    servicePatterns: [servicePattern('SCHEDULED', fixture.variants[0], {
      dispatch_type: 'SCHEDULED', headway_min_minutes: null, headway_max_minutes: null,
    })],
    requestedDeparture: REQUESTED,
  });
  assert.equal(scheduled.operatingMode, 'SCHEDULED');
  assert.equal(scheduled.status, SERVICE_STATUS.PARTIAL);
  assert.deepEqual(scheduled.scheduledDepartures, []);
  assert.ok(scheduled.warnings.includes('SCHEDULED_DEPARTURES_NOT_MODELED'));

  const leaveWhenFull = evaluateServiceForLeg(leg, {
    servicePatterns: [servicePattern('FILL', fixture.variants[0], {
      dispatch_type: 'LEAVE_WHEN_FULL', headway_min_minutes: 5, headway_max_minutes: 5,
    })],
    requestedDeparture: REQUESTED,
  });
  assert.equal(leaveWhenFull.operatingMode, 'LEAVE_WHEN_FULL');
  assert.equal(leaveWhenFull.leaveWhenFull, true);
  assert.equal(leaveWhenFull.headwayMinutes, null);
  assert.equal(Object.hasOwn(leaveWhenFull, 'predictedWait'), false);

  const limitedFixture = structuredClone(fixture);
  limitedFixture.variants[0].operating_status = 'LIMITED';
  const limitedLeg = journeyFor(
    limitedFixture, limitedFixture.nodes.A.id, limitedFixture.nodes.C.id
  ).legs[0];
  const limitedWithoutPattern = evaluateServiceForLeg(limitedLeg, {
    servicePatterns: [], requestedDeparture: REQUESTED,
  });
  assert.equal(limitedWithoutPattern.status, SERVICE_STATUS.UNKNOWN);
  assert.equal(limitedWithoutPattern.variantOperatingStatus, 'LIMITED');
  assert.equal(limitedWithoutPattern.limitedService, true);

  const saturday = evaluateServiceForLeg(leg, {
    servicePatterns: [pattern], requestedDeparture: '2026-10-03T08:00:00+08:00',
  });
  assert.equal(saturday.windowStatus, WINDOW_STATUS.OUTSIDE);

  const overnightPattern = servicePattern('OVERNIGHT', fixture.variants[0], {
    days_of_week: ['MONDAY'], first_trip_time: '22:00:00', last_trip_time: '02:00:00',
    dispatch_type: 'CONTINUOUS_UNSCHEDULED', headway_min_minutes: null, headway_max_minutes: null,
  });
  assert.equal(evaluateServiceForLeg(leg, {
    servicePatterns: [overnightPattern], requestedDeparture: '2026-09-29T01:00:00+08:00',
  }).windowStatus, WINDOW_STATUS.WITHIN);
  assert.equal(evaluateServiceForLeg(leg, {
    servicePatterns: [overnightPattern], requestedDeparture: '2026-09-28T17:00:00Z',
  }).windowStatus, WINDOW_STATUS.WITHIN, 'UTC input is evaluated at its Philippine-local day and time');
  assert.equal(evaluateServiceForLeg(leg, {
    servicePatterns: [overnightPattern], requestedDeparture: '2026-09-29T03:00:00+08:00',
  }).windowStatus, WINDOW_STATUS.OUTSIDE);
  console.log('ok - dispatch modes, Philippine-local weekday windows and overnight windows are deterministic');
}

{
  const fixture = directFixture();
  const leg = journeyFor(fixture, fixture.nodes.A.id, fixture.nodes.C.id).legs[0];
  assert.equal(evaluateServiceForLeg(leg, {
    servicePatterns: [], requestedDeparture: REQUESTED,
  }).status, SERVICE_STATUS.UNKNOWN);

  const cases = [
    servicePattern('EXPIRED', { ...fixture.variants[0], effective_to: '2025-12-31' }),
    servicePattern('FUTURE', { ...fixture.variants[0], effective_from: '2030-01-01' }),
    servicePattern('RESEARCH', fixture.variants[0], {
      planning_enabled: false, verification_status: 'CORROBORATED_RESEARCH',
    }),
    servicePattern('HISTORICAL', fixture.variants[0], {
      verification_status: 'HISTORICAL_UNVERIFIED',
    }),
    servicePattern('SIMULATED', fixture.variants[0], {
      verification_status: 'SIMULATED_DEMO', data_mode: 'SIMULATED',
    }),
  ];
  for (const pattern of cases) {
    const result = evaluateServiceForLeg(leg, {
      servicePatterns: [pattern], requestedDeparture: REQUESTED,
    });
    assert.equal(result.status, SERVICE_STATUS.UNKNOWN);
    assert.equal(result.appliedPatternId, null);
  }
  const unknownDays = evaluateServiceForLeg(leg, {
    servicePatterns: [servicePattern('UNKNOWN-DAYS', fixture.variants[0], { days_of_week: null })],
    requestedDeparture: REQUESTED,
  });
  assert.equal(unknownDays.status, SERVICE_STATUS.PARTIAL);
  assert.equal(unknownDays.windowStatus, WINDOW_STATUS.UNKNOWN);
  console.log('ok - unknown, expired, future, research, historical and simulated patterns stay out of guidance');
}

async function testLoader() {
  const fixture = directFixture();
  const journey = journeyFor(fixture, fixture.nodes.A.id, fixture.nodes.C.id);
  const eligibleFare = fareRule('LOADER', { variantRecord: fixture.variants[0], regularFare: 20 });
  const leakedFare = { ...eligibleFare, id: 'leaked-fare', documentId: 'leaked-fare', planning_enabled: false };
  const eligibleService = servicePattern('LOADER', fixture.variants[0]);
  const leakedService = {
    ...eligibleService, id: 'leaked-service', documentId: 'leaked-service',
    verification_status: 'CORROBORATED_RESEARCH', planning_enabled: false,
  };
  const calls = [];
  const strapiInstance = { documents(uid) {
    return { findMany: async (query) => {
      calls.push({ uid, query });
      return uid.includes('fare-rule') ? [eligibleFare, leakedFare] : [eligibleService, leakedService];
    } };
  } };
  const data = await loadFareAndServiceData({
    journey, requestedDeparture: REQUESTED, strapiInstance,
  });
  assert.equal(data.fareRules.length, 1);
  assert.equal(data.servicePatterns.length, 1);
  assert.equal(calls.length, 2);
  const fareCall = calls.find((call) => call.uid === 'api::fare-rule.fare-rule');
  const serviceCall = calls.find((call) => call.uid === 'api::service-pattern.service-pattern');
  assert.equal(fareCall.query.filters.planning_enabled, true);
  assert.equal(fareCall.query.filters.data_mode, 'REAL');
  assert.ok(fareCall.query.fields.includes('regular_base_fare'));
  assert.equal(fareCall.query.fields.includes('base_fare'), false, 'legacy Route.base_fare is never loaded');
  assert.equal(JSON.stringify(fareCall.query).includes('estimated_travel_time'), false);
  assert.equal(serviceCall.query.filters.route_variant.documentId.$in[0], journey.legs[0].routeVariantId);
  assert.deepEqual(fareRuleQuery({ routeIds: ['r'], variantIds: ['v'] }).filters.$or, [
    { route: { documentId: { $in: ['r'] } } },
    { route_variant: { documentId: { $in: ['v'] } } },
  ]);
  assert.deepEqual(servicePatternQuery({ variantIds: ['v'] }).filters.route_variant.documentId.$in, ['v']);
  console.log('ok - data loading uses strict planning filters and reapplies trust eligibility');
}

testLoader().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
