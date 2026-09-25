'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildTransportGraph } = require('../src/services/pamana-journey/graph-builder');
const { planJourneys } = require('../src/services/pamana-journey/journey-planner');
const {
  AVAILABILITY_STATUS,
  availabilityForLeg,
} = require('../src/services/pamana-journey/availability-engine');
const {
  enrichJourneyInformation,
} = require('../src/services/pamana-journey/journey-information-enricher');
const {
  assignedVehicleQuery,
  loadOperationalData,
  operationalTripQuery,
} = require('../src/services/pamana-journey/availability-data-loader');
const { evaluateServiceForLeg } = require('../src/services/pamana-journey/service-pattern-engine');
const { WAIT_STATUS } = require('../src/services/pamana-journey/wait-window');
const { directFixture, transferFixture } = require('./fixtures/phase10-synthetic-network');
const { servicePattern } = require('./fixtures/phase12-synthetic-information');
const { operationalRecord } = require('./fixtures/phase13-synthetic-availability');

const REQUESTED = '2026-09-28T08:00:00+08:00';
const NOW = new Date(REQUESTED);

function journeyFor(fixture, origin, destination) {
  return planJourneys(buildTransportGraph(fixture), {
    candidateBoardingNodeIds: [origin],
    candidateDestinationNodeIds: [destination],
  })[0];
}

function serviceFor(leg, pattern) {
  return evaluateServiceForLeg(leg, { servicePatterns: pattern ? [pattern] : [], requestedDeparture: REQUESTED });
}

{
  const fixture = directFixture();
  const leg = journeyFor(fixture, fixture.nodes.A.id, fixture.nodes.C.id).legs[0];
  const pattern = servicePattern('HEADWAY-13', fixture.variants[0]);
  const service = serviceFor(leg, pattern);
  const availability = availabilityForLeg(leg, { service, now: NOW });
  assert.equal(availability.status, AVAILABILITY_STATUS.SERVICE_EXPECTED);
  assert.deepEqual(service.headwayMinutes, { minimum: 10, maximum: 15 });
  assert.deepEqual(availability.wait, {
    status: WAIT_STATUS.SERVICE_INTERVAL_ONLY,
    lowMinutes: 0,
    highMinutes: 15,
    basis: 'VERIFIED_HEADWAY',
  });
  assert.equal(Object.hasOwn(availability.wait, 'predictedArrival'), false);
  assert.notEqual(availability.wait.lowMinutes, 15);
  console.log('ok - verified headway remains a service interval, not an arrival prediction or 15-minute fallback');
}

{
  const fixture = directFixture();
  const leg = journeyFor(fixture, fixture.nodes.A.id, fixture.nodes.C.id).legs[0];
  for (const [dispatch, overrides, expectedStatus] of [
    ['LEAVE_WHEN_FULL', { dispatch_type: 'LEAVE_WHEN_FULL', headway_min_minutes: 5, headway_max_minutes: 10 }, 'SERVICE_EXPECTED'],
    ['CONTINUOUS_UNSCHEDULED', { dispatch_type: 'CONTINUOUS_UNSCHEDULED', headway_min_minutes: null, headway_max_minutes: null }, 'SERVICE_EXPECTED'],
    ['SCHEDULED', { dispatch_type: 'SCHEDULED', headway_min_minutes: null, headway_max_minutes: null }, 'SERVICE_EXPECTED'],
  ]) {
    const service = serviceFor(leg, servicePattern(dispatch, fixture.variants[0], overrides));
    const availability = availabilityForLeg(leg, { service, now: NOW });
    assert.equal(availability.status, expectedStatus);
    assert.equal(availability.wait.status, WAIT_STATUS.UNKNOWN);
    assert.equal(availability.wait.lowMinutes, null);
    assert.equal(availability.wait.highMinutes, null);
    assert.notEqual(availability.wait.lowMinutes, 0);
  }
  const outsideService = serviceFor(leg, servicePattern('OUTSIDE', fixture.variants[0]));
  const outside = availabilityForLeg(leg, {
    service: outsideService,
    now: new Date('2026-10-03T08:00:00+08:00'),
  });
  // Availability uses the service evaluation time, not observation time.
  const evaluatedOutside = availabilityForLeg(leg, {
    service: evaluateServiceForLeg(leg, {
      servicePatterns: [servicePattern('OUTSIDE', fixture.variants[0])],
      requestedDeparture: '2026-10-03T08:00:00+08:00',
    }),
    now: NOW,
  });
  assert.equal(evaluatedOutside.status, AVAILABILITY_STATUS.OUTSIDE_SERVICE);
  assert.equal(evaluatedOutside.wait.status, WAIT_STATUS.NOT_APPLICABLE);
  assert.equal(outside.status, AVAILABILITY_STATUS.SERVICE_EXPECTED);
  console.log('ok - leave-when-full, continuous and unsupported schedules keep numeric wait unknown; outside window is explicit');
}

{
  const fixture = directFixture();
  const leg = journeyFor(fixture, fixture.nodes.A.id, fixture.nodes.C.id).legs[0];
  const service = serviceFor(leg, null);
  const fresh = operationalRecord(fixture.variants[0]);
  const live = availabilityForLeg(leg, { service, operationalRecords: [fresh], now: NOW });
  assert.equal(live.status, AVAILABILITY_STATUS.LIVE_ACTIVE);
  assert.equal(live.activeVehicleCount, 1);
  assert.equal(live.boardableVehicleCount, 1);
  assert.equal(live.dataFreshness.status, 'FRESH');
  assert.equal(live.wait.status, WAIT_STATUS.UNKNOWN);
  assert.equal(live.wait.lowMinutes, null);
  assert.ok(live.warnings.includes('LIVE_VEHICLE_ETA_UNAVAILABLE'));

  const stale = availabilityForLeg(leg, {
    service,
    operationalRecords: [operationalRecord(fixture.variants[0], { recordedAt: '2026-09-28T07:57:00+08:00' })],
    now: NOW,
  });
  assert.equal(stale.status, AVAILABILITY_STATUS.UNKNOWN);
  assert.equal(stale.activeVehicleCount, 0);
  assert.equal(stale.dataFreshness.status, 'STALE');
  assert.ok(stale.warnings.includes('STALE_OPERATIONAL_DATA'));

  const noLocation = availabilityForLeg(leg, {
    service,
    operationalRecords: [operationalRecord(fixture.variants[0], { includeLocation: false })],
    now: NOW,
  });
  assert.equal(noLocation.status, AVAILABILITY_STATUS.UNKNOWN);
  assert.equal(noLocation.activeVehicleCount, 0);
  assert.equal(noLocation.dataFreshness.status, 'UNKNOWN');

  const wrong = availabilityForLeg(leg, {
    service,
    operationalRecords: [operationalRecord({ documentId: 'different-variant', variant_code: 'DIFFERENT' })],
    now: NOW,
  });
  assert.equal(wrong.activeVehicleCount, 0);
  assert.equal(wrong.status, AVAILABILITY_STATUS.UNKNOWN);
  console.log('ok - only fresh, exactly related RouteVariant records count as live; live presence does not fabricate ETA');
}

{
  const fixture = directFixture();
  const leg = journeyFor(fixture, fixture.nodes.A.id, fixture.nodes.C.id).legs[0];
  const service = serviceFor(leg, null);
  const full = availabilityForLeg(leg, {
    service,
    operationalRecords: [operationalRecord(fixture.variants[0], { occupancyLevel: 'full', vehicleStatus: 'full' })],
    now: NOW,
  });
  assert.equal(full.activeVehicleCount, 1);
  assert.equal(full.boardableVehicleCount, 0);
  assert.ok(full.warnings.includes('FULL_VEHICLE_NOT_BOARDABLE'));
  const fullJourney = enrichJourneyInformation({ id: 'full', legs: [leg] }, {
    operationalRecords: [operationalRecord(fixture.variants[0], { occupancyLevel: 'full', vehicleStatus: 'full' })],
    requestedDeparture: REQUESTED,
    observedAt: NOW,
  });
  assert.equal(fullJourney.availabilitySummary.status, 'PARTIAL');
  const unknown = availabilityForLeg(leg, {
    service,
    operationalRecords: [operationalRecord(fixture.variants[0], { occupancyLevel: null })],
    now: NOW,
  });
  assert.equal(unknown.activeVehicleCount, 1);
  assert.equal(unknown.boardableVehicleCount, 0);
  assert.ok(unknown.warnings.includes('LIVE_VEHICLE_OCCUPANCY_UNKNOWN'));
  const simulated = availabilityForLeg(leg, {
    service,
    operationalRecords: [operationalRecord(fixture.variants[0], { dataMode: 'SIMULATED', isSimulated: true })],
    now: NOW,
  });
  assert.equal(simulated.activeVehicleCount, 0);
  assert.equal(simulated.status, AVAILABILITY_STATUS.UNKNOWN);
  const demo = availabilityForLeg(leg, {
    service,
    operationalRecords: [operationalRecord(fixture.variants[0], { dataMode: 'SIMULATED', isSimulated: true })],
    now: NOW,
    allowSimulated: true,
  });
  assert.equal(demo.activeVehicleCount, 1);
  console.log('ok - full and unknown occupancy are never assumed boardable; simulated operations require explicit demo mode');
}

{
  const fixture = transferFixture();
  const journey = journeyFor(fixture, fixture.nodes.A.id, fixture.nodes.D.id);
  const patterns = [
    servicePattern('LEG-A', fixture.variants[0]),
    servicePattern('LEG-B', fixture.variants[1], {
      days_of_week: ['SATURDAY'],
    }),
  ];
  const enriched = enrichJourneyInformation(journey, {
    servicePatterns: patterns,
    operationalRecords: [operationalRecord(fixture.variants[0])],
    requestedDeparture: REQUESTED,
    observedAt: NOW,
  });
  const transit = enriched.legs.filter((leg) => leg.type === 'TRANSIT');
  assert.equal(transit[0].availability.status, AVAILABILITY_STATUS.LIVE_ACTIVE);
  assert.equal(transit[1].availability.status, AVAILABILITY_STATUS.OUTSIDE_SERVICE);
  assert.equal(availabilityForLeg({ type: 'TRANSFER' }).wait.status, WAIT_STATUS.NOT_APPLICABLE);
  assert.equal(enriched.availabilitySummary.status, 'UNAVAILABLE');
  assert.equal(enriched.availabilitySummary.transitLegsKnown, 2);

  const partial = enrichJourneyInformation(journey, {
    servicePatterns: [patterns[0]], requestedDeparture: REQUESTED, observedAt: NOW,
  });
  assert.equal(partial.availabilitySummary.status, 'PARTIAL');
  assert.equal(partial.availabilitySummary.transitLegsKnown, 1);
  assert.equal(partial.availabilitySummary.transitLegsUnknown, 1);
  console.log('ok - transfer legs are evaluated independently and journey summary never hides an unavailable or unknown leg');
}

async function testLoaderAndBoundaries() {
  const fixture = directFixture();
  const journey = journeyFor(fixture, fixture.nodes.A.id, fixture.nodes.C.id);
  const record = operationalRecord(fixture.variants[0]);
  const calls = [];
  const strapiInstance = { documents(uid) {
    return {
      findMany: async (query) => {
        calls.push({ uid, query });
        if (uid === 'api::trip.trip') return [record.trip];
        if (uid === 'api::vehicle.vehicle') return [record.vehicle];
        throw new Error(`Unexpected findMany ${uid}`);
      },
      findFirst: async (query) => {
        calls.push({ uid, query });
        return record.location;
      },
    };
  } };
  const loaded = await loadOperationalData({ journey, strapiInstance });
  assert.equal(loaded.operationalRecords.length, 1);
  assert.equal(calls.length, 3);
  assert.equal(operationalTripQuery({ variantIds: ['v'] }).filters.is_simulated, false);
  assert.equal(assignedVehicleQuery({ variantIds: ['v'] }).filters.data_mode, 'REAL');

  const serviceDirectory = path.join(__dirname, '..', 'src', 'services', 'pamana-journey');
  const source = fs.readdirSync(serviceDirectory)
    .filter((file) => file.endsWith('.js'))
    .map((file) => fs.readFileSync(path.join(serviceDirectory, file), 'utf8'))
    .join('\n');
  assert.doesNotMatch(source, /pamana-ai[\\/]wait-time|pamana-ai[\\/]demand|pamana-ai[\\/]supply-demand/);
  assert.doesNotMatch(source, /mode\s*[=:]\s*['\"]?drive|Geoapify.*drive/i);
  assert.doesNotMatch(source, /DEFAULT_FREQUENCY_MINUTES|fallback wait/i);
  console.log('ok - production loader requires REAL operations and revised journey services have no ML wait/demand or drive-routing dependency');
}

testLoaderAndBoundaries().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
