'use strict';

const { planningCandidateFilters } = require('../transport-data/planning-eligibility');
const { unwrapRecord } = require('./graph-builder');
const { ruleEligibilityFor } = require('./rule-utils');

function fareRuleQuery({ routeIds = [], variantIds = [] } = {}) {
  const scopes = [];
  if (routeIds.length) scopes.push({ route: { documentId: { $in: routeIds } } });
  if (variantIds.length) scopes.push({ route_variant: { documentId: { $in: variantIds } } });
  return {
    filters: {
      ...planningCandidateFilters(),
      $or: scopes,
    },
    fields: [
      'fare_type', 'currency', 'regular_base_fare', 'base_distance_km',
      'per_km_after_base', 'minimum_fare', 'rounding_rule',
      'student_discount_percent', 'senior_discount_percent', 'pwd_discount_percent',
      'effective_from', 'effective_to', 'planning_enabled', 'verification_status',
      'data_mode', 'verified_at', 'source_name', 'source_url', 'source_reference',
    ],
    populate: {
      route: { fields: ['route_code'] },
      route_variant: { fields: ['variant_code'] },
    },
    sort: ['effective_from:desc', 'id:asc'],
  };
}

function servicePatternQuery({ variantIds = [] } = {}) {
  return {
    filters: {
      ...planningCandidateFilters(),
      route_variant: { documentId: { $in: variantIds } },
    },
    fields: [
      'days_of_week', 'first_trip_time', 'last_trip_time', 'dispatch_type',
      'headway_min_minutes', 'headway_max_minutes', 'planning_enabled',
      'verification_status', 'data_mode', 'verified_at', 'source_name',
      'source_url', 'source_reference',
    ],
    populate: {
      route_variant: { fields: ['variant_code', 'effective_from', 'effective_to'] },
    },
    sort: ['id:asc'],
  };
}

async function loadFareAndServiceData({
  journey,
  requestedDeparture,
  strapiInstance = global.strapi,
} = {}) {
  if (!strapiInstance?.documents) throw new Error('STRAPI_DOCUMENT_SERVICE_UNAVAILABLE');
  const transitLegs = (Array.isArray(journey?.legs) ? journey.legs : [])
    .filter((leg) => leg.type === 'TRANSIT');
  const routeIds = [...new Set(transitLegs.map((leg) => leg.routeId).filter(Boolean))];
  const variantIds = [...new Set(transitLegs.map((leg) => leg.routeVariantId).filter(Boolean))];
  if (!transitLegs.length) {
    return Object.freeze({ fareRules: Object.freeze([]), servicePatterns: Object.freeze([]) });
  }
  const [rawFareRules, rawServicePatterns] = await Promise.all([
    strapiInstance.documents('api::fare-rule.fare-rule').findMany(fareRuleQuery({ routeIds, variantIds })),
    strapiInstance.documents('api::service-pattern.service-pattern').findMany(servicePatternQuery({ variantIds })),
  ]);
  const fareRules = (Array.isArray(rawFareRules) ? rawFareRules : []).filter((rule) =>
    ruleEligibilityFor(rule, { requestedDate: requestedDeparture }).eligible
  );
  const servicePatterns = (Array.isArray(rawServicePatterns) ? rawServicePatterns : []).filter((pattern) => {
    const record = unwrapRecord(pattern);
    return ruleEligibilityFor(record, {
      requestedDate: requestedDeparture,
      effectiveRecord: unwrapRecord(record?.route_variant),
    }).eligible;
  });
  return Object.freeze({
    fareRules: Object.freeze(fareRules),
    servicePatterns: Object.freeze(servicePatterns),
  });
}

module.exports = {
  fareRuleQuery,
  loadFareAndServiceData,
  servicePatternQuery,
};
