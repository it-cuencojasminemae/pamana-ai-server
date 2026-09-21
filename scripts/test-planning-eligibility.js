'use strict';

const assert = require('assert');
const {
  DATA_MODE,
  VERIFICATION_STATUS,
  planningEligibilityFor,
  routePlanningEligibilityFor,
  planningCandidateFilters,
  filterPlanningEligibleRoutes,
} = require('../src/services/transport-data/planning-eligibility');

const verifiedFact = (overrides = {}) => ({
  planning_enabled: true,
  verification_status: VERIFICATION_STATUS.FIELD_VERIFIED,
  data_mode: DATA_MODE.REAL,
  verified_at: '2026-09-21T00:00:00.000Z',
  source_name: 'PAMANA field survey',
  source_reference: 'FIELD-SURVEY-2026-09-21',
  ...overrides,
});

const verifiedRoute = (overrides = {}) => ({
  ...verifiedFact(),
  route_status: 'active',
  route_stops: [
    verifiedFact({ name: 'Boarding point', sequence: 1 }),
    verifiedFact({ name: 'Alighting point', sequence: 2 }),
  ],
  ...overrides,
});

assert.deepStrictEqual(planningEligibilityFor(verifiedFact()), {
  eligible: true,
  reasons: [],
});

for (const status of [
  VERIFICATION_STATUS.CORROBORATED_RESEARCH,
  VERIFICATION_STATUS.HISTORICAL_UNVERIFIED,
  VERIFICATION_STATUS.SIMULATED_DEMO,
  VERIFICATION_STATUS.RESEARCH_CANDIDATE,
]) {
  assert.strictEqual(
    planningEligibilityFor(verifiedFact({ verification_status: status })).eligible,
    false,
    `${status} must not be passenger-planning eligible`
  );
}

assert.strictEqual(
  planningEligibilityFor(verifiedFact({ planning_enabled: false })).eligible,
  false
);
assert.strictEqual(
  planningEligibilityFor(verifiedFact({ data_mode: DATA_MODE.SIMULATED })).eligible,
  false
);
assert.strictEqual(
  planningEligibilityFor(verifiedFact({ verified_at: null })).eligible,
  false
);
assert.strictEqual(
  planningEligibilityFor(verifiedFact({ source_name: null })).eligible,
  false
);
assert.strictEqual(
  planningEligibilityFor(verifiedFact({ source_reference: null, source_url: null })).eligible,
  false
);

assert.deepStrictEqual(routePlanningEligibilityFor(verifiedRoute()), {
  eligible: true,
  reasons: [],
});
assert.strictEqual(
  routePlanningEligibilityFor(verifiedRoute({ route_status: 'inactive' })).eligible,
  false
);
assert.strictEqual(
  routePlanningEligibilityFor(verifiedRoute({ route_stops: [] })).eligible,
  false
);
assert.strictEqual(
  routePlanningEligibilityFor(
    verifiedRoute({
      route_stops: [
        verifiedFact({ name: 'Boarding point', sequence: 1 }),
        verifiedFact({ name: 'Unverified stop', sequence: 2, planning_enabled: false }),
      ],
    })
  ).eligible,
  false
);

const eligible = verifiedRoute({ route_code: 'VERIFIED-01' });
const historical = verifiedRoute({
  route_code: 'LEGACY-01',
  verification_status: VERIFICATION_STATUS.HISTORICAL_UNVERIFIED,
});
assert.deepStrictEqual(filterPlanningEligibleRoutes([historical, eligible]), [eligible]);
assert.deepStrictEqual(planningCandidateFilters({ requireActive: true }), {
  planning_enabled: true,
  verification_status: {
    $in: [
      VERIFICATION_STATUS.AUTHORITATIVE_CURRENT,
      VERIFICATION_STATUS.FIELD_VERIFIED,
    ],
  },
  data_mode: DATA_MODE.REAL,
  route_status: 'active',
});

console.log('ok - only authoritative or field-verified real facts can be planning-enabled');
console.log('ok - planning requires verification time and source evidence');
console.log('ok - route eligibility includes active status and every stop');
console.log('ok - historical, research-only, and simulated routes are excluded');
