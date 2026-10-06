'use strict';

// Product policy supplied for Batch A; this is not a claim of LTFRB verification.
const JEEPNEY_POLICIES = Object.freeze({
  PUJ_TRADITIONAL: Object.freeze({ baseFare: 14, baseDistanceKm: 4, perKm: 2 }),
  PUJ_MODERN: Object.freeze({ baseFare: 17, baseDistanceKm: 4, perKm: 2.4 }),
});
const DISCOUNT_PERCENT = 20;
const DEMO_TRICYCLE = Object.freeze({
  routeCode: 'PILOT-PSU-MEXICO-BAYAN-TRICYCLE',
  variantCode: 'PILOT-PSU-MEXICO-BAYAN-TRICYCLE-OUT',
  from: 'RCH-PSU-MEXICO-FRONT',
  to: 'RCH-MEXICO-BAYAN-STA-MONICA-TRANSFER',
  fare: 100,
  source: 'PAMANA Batch A supplied demo estimate',
});

function rawJeepneyFare(mode, distanceMeters) {
  const policy = JEEPNEY_POLICIES[mode];
  if (!policy || !Number.isFinite(distanceMeters) || distanceMeters < 0) return null;
  return policy.baseFare + Math.max(0, distanceMeters / 1000 - policy.baseDistanceKm) * policy.perKm;
}

function matchesDemoTricycle(leg) {
  return leg.transportMode === 'TRICYCLE'
    && leg.routeCode === DEMO_TRICYCLE.routeCode
    && leg.variantCode === DEMO_TRICYCLE.variantCode
    && leg.boardAt?.nodeCode === DEMO_TRICYCLE.from
    && leg.alightAt?.nodeCode === DEMO_TRICYCLE.to;
}

module.exports = { JEEPNEY_POLICIES, DISCOUNT_PERCENT, DEMO_TRICYCLE, rawJeepneyFare, matchesDemoTricycle };
