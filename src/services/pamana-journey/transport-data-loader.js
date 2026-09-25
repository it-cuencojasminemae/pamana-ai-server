'use strict';

const {
  planningCandidateFilters,
} = require('../transport-data/planning-eligibility');
const {
  routeVariantPlanningEligibilityFor,
} = require('./graph-builder');
const {
  PLANNING_OPERATING_STATUSES,
} = require('./types');

function transportGraphQuery({ demoMode = false } = {}) {
  return {
    filters: {
      ...planningCandidateFilters({ allowSimulated: demoMode }),
      operating_status: { $in: [...PLANNING_OPERATING_STATUSES] },
      route: {
        ...planningCandidateFilters({ requireActive: true, allowSimulated: demoMode }),
        active: true,
      },
    },
    fields: [
      'variant_code', 'direction', 'signboard_text', 'operating_status',
      'planning_enabled', 'verification_status', 'data_mode', 'verified_at',
      'source_name', 'source_url', 'source_reference', 'effective_from', 'effective_to',
    ],
    populate: {
      route: {
        fields: [
          'route_code', 'transport_mode', 'route_status', 'active',
          'planning_enabled', 'verification_status', 'data_mode', 'verified_at',
          'source_name', 'source_url', 'source_reference',
        ],
      },
      route_variant_stops: {
        fields: [
          'sequence', 'pickup_allowed', 'dropoff_allowed', 'transfer_allowed',
          'distance_from_variant_start_m',
        ],
        sort: ['sequence:asc'],
        populate: {
          transport_node: {
            fields: [
              'node_code', 'name', 'node_type', 'planning_enabled',
              'verification_status', 'data_mode', 'verified_at',
              'source_name', 'source_url', 'source_reference',
            ],
          },
        },
      },
    },
    sort: ['variant_code:asc'],
  };
}

/**
 * Loads only planning candidates, then reapplies the shared trust policy to
 * populated relations before graph construction. It performs no writes.
 */
async function loadEligibleTransportGraphData({
  strapiInstance = global.strapi,
  demoMode = false,
  serviceDate = new Date(),
} = {}) {
  if (!strapiInstance?.documents) throw new Error('STRAPI_DOCUMENT_SERVICE_UNAVAILABLE');
  const variants = await strapiInstance
    .documents('api::route-variant.route-variant')
    .findMany(transportGraphQuery({ demoMode }));
  const eligibleVariants = (Array.isArray(variants) ? variants : []).filter((variant) =>
    routeVariantPlanningEligibilityFor(variant, { demoMode, serviceDate }).eligible
  );
  return Object.freeze({ variants: Object.freeze(eligibleVariants) });
}

module.exports = {
  loadEligibleTransportGraphData,
  transportGraphQuery,
};
