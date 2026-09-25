'use strict';

const {
  evidence,
  node,
  route,
  stop,
  variant,
} = require('./phase10-synthetic-network');

function fareRule(code, {
  routeRecord = null,
  variantRecord = null,
  fareType = 'FLAT',
  regularFare = 20,
  overrides = {},
} = {}) {
  return {
    id: `fare-${code}`,
    documentId: `fare-${code}`,
    route: routeRecord,
    route_variant: variantRecord,
    fare_type: fareType,
    currency: 'PHP',
    regular_base_fare: regularFare,
    base_distance_km: null,
    per_km_after_base: null,
    minimum_fare: null,
    rounding_rule: 'NONE',
    student_discount_percent: null,
    senior_discount_percent: null,
    pwd_discount_percent: null,
    effective_from: '2026-01-01',
    effective_to: null,
    ...evidence,
    ...overrides,
  };
}

function servicePattern(code, variantRecord, overrides = {}) {
  return {
    id: `service-${code}`,
    documentId: `service-${code}`,
    route_variant: variantRecord,
    days_of_week: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
    first_trip_time: '06:00:00',
    last_trip_time: '18:00:00',
    dispatch_type: 'HEADWAY',
    headway_min_minutes: 10,
    headway_max_minutes: 15,
    ...evidence,
    ...overrides,
  };
}

function distanceFareFixture() {
  const nodes = { A: node('FARE-A'), B: node('FARE-B'), C: node('FARE-C') };
  const routeRecord = route('FARE-DISTANCE');
  const variantRecord = variant('FARE-DISTANCE-OUT', 'OUTBOUND', routeRecord, [
    stop('FARE-DISTANCE-OUT', nodes.A, 1, { distance_from_variant_start_m: 0 }),
    stop('FARE-DISTANCE-OUT', nodes.B, 2, { distance_from_variant_start_m: 2000 }),
    stop('FARE-DISTANCE-OUT', nodes.C, 3, { distance_from_variant_start_m: 5000 }),
  ]);
  return {
    nodes,
    route: routeRecord,
    variant: variantRecord,
    variants: [variantRecord],
    distanceRule: fareRule('DISTANCE', {
      variantRecord,
      fareType: 'DISTANCE_BASED',
      regularFare: 10,
      overrides: {
        base_distance_km: 2,
        per_km_after_base: 2,
        minimum_fare: 10,
      },
    }),
  };
}

module.exports = {
  distanceFareFixture,
  fareRule,
  servicePattern,
};
