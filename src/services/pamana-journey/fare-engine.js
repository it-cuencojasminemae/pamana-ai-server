'use strict';

const { unwrapRecord } = require('./graph-builder');
const { LEG_TYPE } = require('./types');
const {
  finiteNumber,
  identity,
  ruleEligibilityFor,
  sourceSummary,
  text,
} = require('./rule-utils');

const FARE_STATUS = Object.freeze({
  KNOWN: 'KNOWN',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  PARTIAL: 'PARTIAL',
  UNKNOWN: 'UNKNOWN',
});

const PASSENGER_CATEGORIES = Object.freeze(['REGULAR', 'STUDENT', 'SENIOR', 'PWD']);

function unknownFare(warnings = ['NO_ELIGIBLE_FARE_RULE']) {
  return Object.freeze({
    status: FARE_STATUS.UNKNOWN,
    currency: 'PHP',
    regularFare: null,
    discountedFare: null,
    payableFare: null,
    appliedRuleId: null,
    discountType: null,
    sourceSummary: null,
    verificationStatus: null,
    warnings: Object.freeze(warnings),
  });
}

function notApplicableFare() {
  return Object.freeze({
    status: FARE_STATUS.NOT_APPLICABLE,
    currency: null,
    regularFare: null,
    discountedFare: null,
    payableFare: null,
    appliedRuleId: null,
    discountType: null,
    sourceSummary: null,
    verificationStatus: null,
    warnings: Object.freeze([]),
  });
}

function relationMatches(relation, id, code, codeField) {
  const record = unwrapRecord(relation);
  if (!record) return false;
  return [identity(record), text(record[codeField])]
    .filter(Boolean)
    .some((candidate) => candidate === id || candidate === code);
}

function ruleScope(rule, leg) {
  const variant = unwrapRecord(rule.route_variant);
  const route = unwrapRecord(rule.route);
  if (variant) {
    return relationMatches(variant, leg.routeVariantId, leg.variantCode, 'variant_code')
      ? 'VARIANT'
      : null;
  }
  if (route) {
    return relationMatches(route, leg.routeId, leg.routeCode, 'route_code') ? 'ROUTE' : null;
  }
  return null;
}

const scopeRank = (scope) => scope === 'VARIANT' ? 2 : 1;

function matchingRules(leg, rules, options) {
  const matched = [];
  for (const rawRule of Array.isArray(rules) ? rules : []) {
    const rule = unwrapRecord(rawRule);
    const scope = ruleScope(rule, leg);
    if (!scope) continue;
    const eligibility = ruleEligibilityFor(rule, options);
    if (!eligibility.eligible) continue;
    matched.push({ rule, scope });
  }
  return matched.sort((first, second) =>
    scopeRank(second.scope) - scopeRank(first.scope)
    || String(second.rule.effective_from || '').localeCompare(String(first.rule.effective_from || ''))
    || String(identity(first.rule) || '').localeCompare(String(identity(second.rule) || ''))
  );
}

function roundCurrency(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function applyRounding(value, rawRule) {
  const rule = text(rawRule)?.toUpperCase() || 'NONE';
  if (rule === 'NONE') return { value: roundCurrency(value), warning: null };
  if (['NEAREST_PESO', 'ROUND_TO_NEAREST_PESO'].includes(rule)) {
    return { value: Math.round(value), warning: null };
  }
  if (rule === 'CEIL_TO_PESO') return { value: Math.ceil(value), warning: null };
  if (rule === 'FLOOR_TO_PESO') return { value: Math.floor(value), warning: null };
  return { value: null, warning: 'ROUNDING_RULE_UNSUPPORTED' };
}

function calculateRegularFare(rule, leg) {
  const warnings = [];
  const baseFare = finiteNumber(rule.regular_base_fare);
  if (rule.fare_type === 'FLAT') {
    if (baseFare === null || baseFare < 0) warnings.push('REGULAR_FARE_UNAVAILABLE');
    return { value: baseFare !== null && baseFare >= 0 ? roundCurrency(baseFare) : null, warnings };
  }
  if (rule.fare_type === 'DISTANCE_BASED') {
    const distanceMeters = finiteNumber(leg.segmentDistanceMeters);
    const baseDistanceKm = finiteNumber(rule.base_distance_km);
    const perKm = finiteNumber(rule.per_km_after_base);
    if (distanceMeters === null || distanceMeters < 0) warnings.push('SEGMENT_DISTANCE_UNAVAILABLE');
    if (baseFare === null || baseFare < 0 || baseDistanceKm === null || baseDistanceKm < 0
      || perKm === null || perKm < 0) warnings.push('DISTANCE_FARE_FORMULA_INCOMPLETE');
    if (warnings.length) return { value: null, warnings };
    const distanceKm = distanceMeters / 1000;
    let value = baseFare + Math.max(0, distanceKm - baseDistanceKm) * perKm;
    const minimumFare = finiteNumber(rule.minimum_fare);
    if (minimumFare !== null) value = Math.max(value, minimumFare);
    const rounded = applyRounding(value, rule.rounding_rule);
    if (rounded.warning) warnings.push(rounded.warning);
    return { value: rounded.value, warnings };
  }
  if (rule.fare_type === 'ZONE') warnings.push('ZONE_FARE_LOOKUP_NOT_MODELED');
  else if (rule.fare_type === 'MANUAL_LOOKUP') warnings.push('MANUAL_FARE_LOOKUP_REQUIRED');
  else warnings.push('FARE_TYPE_UNSUPPORTED');
  return { value: null, warnings };
}

function discountPercent(rule, passengerCategory) {
  const fields = {
    STUDENT: 'student_discount_percent',
    SENIOR: 'senior_discount_percent',
    PWD: 'pwd_discount_percent',
  };
  return fields[passengerCategory] ? finiteNumber(rule[fields[passengerCategory]]) : null;
}

function evaluateFareForLeg(leg, {
  fareRules = [],
  passengerCategory = 'REGULAR',
  requestedDate,
  allowSimulated = false,
} = {}) {
  if (leg?.type !== LEG_TYPE.TRANSIT) return notApplicableFare();
  if (!PASSENGER_CATEGORIES.includes(passengerCategory)) {
    return unknownFare(['PASSENGER_CATEGORY_UNSUPPORTED']);
  }
  if (!requestedDate) return unknownFare(['REQUESTED_DATE_REQUIRED']);
  const [match] = matchingRules(leg, fareRules, { requestedDate, allowSimulated });
  if (!match) return unknownFare();

  const { rule } = match;
  const calculated = calculateRegularFare(rule, leg);
  let discountedFare = null;
  let payableFare = calculated.value;
  let discountType = null;
  const warnings = calculated.warnings.slice();

  if (passengerCategory !== 'REGULAR') {
    const percent = discountPercent(rule, passengerCategory);
    if (percent === null || percent < 0 || percent > 100) {
      payableFare = null;
      warnings.push('DISCOUNT_RULE_UNAVAILABLE');
    } else if (calculated.value === null) {
      payableFare = null;
      warnings.push('DISCOUNT_BASE_FARE_UNKNOWN');
    } else {
      discountedFare = roundCurrency(calculated.value * (1 - percent / 100));
      payableFare = discountedFare;
      discountType = passengerCategory;
    }
  }

  return Object.freeze({
    status: payableFare === null ? FARE_STATUS.PARTIAL : FARE_STATUS.KNOWN,
    currency: text(rule.currency) || 'PHP',
    regularFare: calculated.value,
    discountedFare,
    payableFare,
    appliedRuleId: identity(rule),
    discountType,
    sourceSummary: sourceSummary(rule),
    verificationStatus: rule.verification_status || null,
    warnings: Object.freeze([...new Set(warnings)]),
  });
}

function summarizeJourneyFares(legs) {
  const transitFares = (Array.isArray(legs) ? legs : [])
    .filter((leg) => leg.type === LEG_TYPE.TRANSIT)
    .map((leg) => leg.fare);
  const known = transitFares.filter((fare) => fare?.payableFare !== null && fare?.payableFare !== undefined);
  const knownSubtotal = known.length
    ? roundCurrency(known.reduce((sum, fare) => sum + fare.payableFare, 0))
    : null;
  const currencies = new Set(known.map((fare) => fare.currency).filter(Boolean));
  const currencyMismatch = currencies.size > 1;
  const allKnown = transitFares.length > 0 && known.length === transitFares.length && !currencyMismatch;
  const hasPartialInformation = known.length > 0
    || transitFares.some((fare) => fare?.status === FARE_STATUS.PARTIAL);
  return Object.freeze({
    totalStatus: allKnown
      ? FARE_STATUS.KNOWN
      : (hasPartialInformation ? FARE_STATUS.PARTIAL : FARE_STATUS.UNKNOWN),
    knownSubtotal: currencyMismatch ? null : knownSubtotal,
    totalFare: allKnown ? knownSubtotal : null,
    currency: currencies.size === 1
      ? [...currencies][0]
      : (currencies.size === 0 ? 'PHP' : null),
    warnings: Object.freeze(currencyMismatch ? ['CURRENCY_MISMATCH'] : []),
  });
}

module.exports = {
  FARE_STATUS,
  PASSENGER_CATEGORIES,
  evaluateFareForLeg,
  matchingRules,
  notApplicableFare,
  ruleScope,
  summarizeJourneyFares,
};
