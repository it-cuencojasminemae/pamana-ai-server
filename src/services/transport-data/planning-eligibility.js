'use strict';

const VERIFICATION_STATUS = Object.freeze({
  AUTHORITATIVE_CURRENT: 'AUTHORITATIVE_CURRENT',
  FIELD_VERIFIED: 'FIELD_VERIFIED',
  CORROBORATED_RESEARCH: 'CORROBORATED_RESEARCH',
  HISTORICAL_UNVERIFIED: 'HISTORICAL_UNVERIFIED',
  SIMULATED_DEMO: 'SIMULATED_DEMO',
  RESEARCH_CANDIDATE: 'RESEARCH_CANDIDATE',
});

const DATA_MODE = Object.freeze({
  REAL: 'REAL',
  SIMULATED: 'SIMULATED',
});

const PLANNING_ELIGIBLE_STATUSES = new Set([
  VERIFICATION_STATUS.AUTHORITATIVE_CURRENT,
  VERIFICATION_STATUS.FIELD_VERIFIED,
]);

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;

const hasValidVerificationDate = (value) => {
  if (!value) return false;
  return Number.isFinite(new Date(value).getTime());
};

/**
 * Applies the common trust rule to any route-fact record (Route, Route Stop,
 * and future RouteVariant/TransportNode records). `planning_enabled` is an
 * explicit human decision, never inferred from a promising research status.
 */
function planningEligibilityFor(record, { requireActive = false } = {}) {
  const reasons = [];

  if (!record) {
    return { eligible: false, reasons: ['RECORD_MISSING'] };
  }

  if (requireActive && record.route_status !== 'active') {
    reasons.push('NOT_ACTIVE');
  }

  if (record.planning_enabled !== true) {
    reasons.push('PLANNING_DISABLED');
  }

  if (!PLANNING_ELIGIBLE_STATUSES.has(record.verification_status)) {
    reasons.push('VERIFICATION_STATUS_NOT_ELIGIBLE');
  }

  if (record.data_mode !== DATA_MODE.REAL) {
    reasons.push('NOT_REAL_DATA');
  }

  if (!hasValidVerificationDate(record.verified_at)) {
    reasons.push('VERIFIED_AT_MISSING_OR_INVALID');
  }

  if (!hasText(record.source_name)) {
    reasons.push('SOURCE_NAME_MISSING');
  }

  if (!hasText(record.source_url) && !hasText(record.source_reference)) {
    reasons.push('SOURCE_REFERENCE_MISSING');
  }

  return { eligible: reasons.length === 0, reasons };
}

/**
 * A route is usable only when both the route record and every ordered stop
 * pass the same trust rule. Unknown fare and service values are intentionally
 * not part of this Phase 2 gate and may remain null.
 */
function routePlanningEligibilityFor(route) {
  const routeEligibility = planningEligibilityFor(route, { requireActive: true });
  const reasons = routeEligibility.reasons.map((reason) => `ROUTE_${reason}`);
  const stops = Array.isArray(route?.route_stops) ? route.route_stops : [];

  if (stops.length < 2) {
    reasons.push('ROUTE_STOP_SEQUENCE_INCOMPLETE');
  }

  stops.forEach((stop, index) => {
    const stopEligibility = planningEligibilityFor(stop);
    stopEligibility.reasons.forEach((reason) => {
      reasons.push(`STOP_${index + 1}_${reason}`);
    });
  });

  return { eligible: reasons.length === 0, reasons };
}

const isPlanningEligible = (record, options) =>
  planningEligibilityFor(record, options).eligible;

const isRoutePlanningEligible = (route) =>
  routePlanningEligibilityFor(route).eligible;

const planningCandidateFilters = ({ requireActive = false } = {}) => ({
  planning_enabled: true,
  verification_status: { $in: Array.from(PLANNING_ELIGIBLE_STATUSES) },
  data_mode: DATA_MODE.REAL,
  ...(requireActive ? { route_status: 'active' } : {}),
});

const filterPlanningEligibleRoutes = (routes) =>
  (Array.isArray(routes) ? routes : []).filter(isRoutePlanningEligible);

module.exports = {
  DATA_MODE,
  VERIFICATION_STATUS,
  PLANNING_ELIGIBLE_STATUSES,
  planningEligibilityFor,
  routePlanningEligibilityFor,
  isPlanningEligible,
  isRoutePlanningEligible,
  planningCandidateFilters,
  filterPlanningEligibleRoutes,
};
