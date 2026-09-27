'use strict';

const {
  planningCandidateFilters,
  planningEligibilityFor,
} = require('../transport-data/planning-eligibility');
const {
  DISRUPTION_EFFECT,
  VERIFIED_GEOMETRY_SOURCES,
  relationDocumentId,
  validDisruptionGeometry,
} = require('../disruption/disruption-foundation');
const { unwrapRecord } = require('./graph-builder');

const EFFECTS = new Set(Object.values(DISRUPTION_EFFECT));
const NODE_EFFECTS = new Set([
  DISRUPTION_EFFECT.NODE_CLOSED,
  DISRUPTION_EFFECT.BOARDING_CLOSED,
  DISRUPTION_EFFECT.ALIGHTING_CLOSED,
  DISRUPTION_EFFECT.TRANSFER_BLOCKED,
]);

const text = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;
const identity = (value) => {
  const record = unwrapRecord(value);
  return relationDocumentId(record)
    || text(record?.document_id)
    || (record?.id == null ? null : String(record.id));
};

function disruptionQuery({ serviceDate = new Date(), allowSimulated = false } = {}) {
  const at = new Date(serviceDate);
  if (!Number.isFinite(at.getTime())) throw new Error('DISRUPTION_SERVICE_DATE_INVALID');
  const instant = at.toISOString();
  return {
    filters: {
      ...planningCandidateFilters({ allowSimulated }),
      disruption_status: 'active',
      resolved_at: { $null: true },
      starts_at: { $lte: instant },
      $or: [
        { ends_at: { $null: true } },
        { ends_at: { $gt: instant } },
      ],
    },
    fields: [
      'title', 'severity', 'effect', 'starts_at', 'ends_at', 'disruption_status',
      'planning_enabled', 'verification_status', 'data_mode', 'verified_at',
      'source_name', 'source_url', 'source_reference', 'resolved_at',
      'geometry_source', 'geometry_geojson',
    ],
    populate: {
      affected_route: { fields: ['route_code'] },
      affected_route_variant: { fields: ['variant_code'] },
      affected_transport_node: { fields: ['node_code', 'name'] },
    },
    sort: ['starts_at:asc', 'title:asc'],
  };
}

function targetIsValid(record) {
  const routeId = identity(record.affected_route);
  const variantId = identity(record.affected_route_variant);
  const nodeId = identity(record.affected_transport_node);
  if (record.effect === DISRUPTION_EFFECT.ROUTE_SUSPENDED) return Boolean(routeId);
  if (record.effect === DISRUPTION_EFFECT.VARIANT_SUSPENDED) return Boolean(variantId);
  if (NODE_EFFECTS.has(record.effect)) return Boolean(nodeId);
  if (record.effect === DISRUPTION_EFFECT.LIMITED_SERVICE) return Boolean(routeId || variantId);
  return record.effect === DISRUPTION_EFFECT.WARNING_ONLY;
}

function activeAt(record, serviceDate) {
  const at = new Date(serviceDate).getTime();
  const starts = new Date(record.starts_at).getTime();
  const ends = record.ends_at == null ? null : new Date(record.ends_at).getTime();
  return Number.isFinite(at) && Number.isFinite(starts) && starts <= at
    && (ends === null || (Number.isFinite(ends) && ends > at));
}

function normalizeDisruption(raw, { serviceDate = new Date(), allowSimulated = false } = {}) {
  const record = unwrapRecord(raw);
  if (!record || !EFFECTS.has(record.effect)) return null;
  if (!planningEligibilityFor(record, { allowSimulated }).eligible
    || record.disruption_status !== 'active' || record.resolved_at != null
    || !activeAt(record, serviceDate) || !targetIsValid(record)) return null;
  const id = identity(record);
  if (!id) return null;
  const geometry = record.geometry_geojson != null
    && VERIFIED_GEOMETRY_SOURCES.has(record.geometry_source)
    && validDisruptionGeometry(record.geometry_geojson)
    ? structuredClone(record.geometry_geojson) : null;
  return Object.freeze({
    id,
    effect: record.effect,
    title: text(record.title) || 'Active service disruption',
    severity: text(record.severity) || 'moderate',
    startsAt: new Date(record.starts_at).toISOString(),
    endsAt: record.ends_at ? new Date(record.ends_at).toISOString() : null,
    routeId: identity(record.affected_route),
    variantId: identity(record.affected_route_variant),
    nodeId: identity(record.affected_transport_node),
    geometry: geometry ? Object.freeze(geometry) : null,
  });
}

async function loadEligibleDisruptions({
  strapiInstance = global.strapi,
  serviceDate = new Date(),
  allowSimulated = false,
} = {}) {
  if (!strapiInstance?.documents) throw new Error('STRAPI_DOCUMENT_SERVICE_UNAVAILABLE');
  const records = await strapiInstance.documents('api::disruption.disruption')
    .findMany(disruptionQuery({ serviceDate, allowSimulated }));
  return Object.freeze((Array.isArray(records) ? records : [])
    .map((record) => normalizeDisruption(record, { serviceDate, allowSimulated }))
    .filter(Boolean));
}

module.exports = {
  activeAt,
  disruptionQuery,
  loadEligibleDisruptions,
  normalizeDisruption,
};
