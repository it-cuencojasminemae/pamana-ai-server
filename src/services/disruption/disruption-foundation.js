'use strict';

const {
  DATA_MODE,
  VERIFICATION_STATUS,
  planningEligibilityFor,
} = require('../transport-data/planning-eligibility');

const DISRUPTION_EFFECT = Object.freeze({
  WARNING_ONLY: 'WARNING_ONLY',
  LIMITED_SERVICE: 'LIMITED_SERVICE',
  ROUTE_SUSPENDED: 'ROUTE_SUSPENDED',
  VARIANT_SUSPENDED: 'VARIANT_SUSPENDED',
  NODE_CLOSED: 'NODE_CLOSED',
  BOARDING_CLOSED: 'BOARDING_CLOSED',
  ALIGHTING_CLOSED: 'ALIGHTING_CLOSED',
  TRANSFER_BLOCKED: 'TRANSFER_BLOCKED',
});

const GEOMETRY_SOURCE = Object.freeze({
  FIELD_GPS: 'FIELD_GPS',
  AUTHORITATIVE: 'AUTHORITATIVE',
  GOOGLE_ROAD_MATCHED: 'GOOGLE_ROAD_MATCHED',
  MANUAL_VERIFIED: 'MANUAL_VERIFIED',
  SIMULATED: 'SIMULATED',
  UNKNOWN: 'UNKNOWN',
});

const VERIFIED_GEOMETRY_SOURCES = new Set([
  GEOMETRY_SOURCE.FIELD_GPS,
  GEOMETRY_SOURCE.AUTHORITATIVE,
  GEOMETRY_SOURCE.GOOGLE_ROAD_MATCHED,
  GEOMETRY_SOURCE.MANUAL_VERIFIED,
]);

const EFFECT_TARGET = Object.freeze({
  [DISRUPTION_EFFECT.ROUTE_SUSPENDED]: 'affected_route',
  [DISRUPTION_EFFECT.VARIANT_SUSPENDED]: 'affected_route_variant',
  [DISRUPTION_EFFECT.NODE_CLOSED]: 'affected_transport_node',
  [DISRUPTION_EFFECT.BOARDING_CLOSED]: 'affected_transport_node',
  [DISRUPTION_EFFECT.ALIGHTING_CLOSED]: 'affected_transport_node',
  [DISRUPTION_EFFECT.TRANSFER_BLOCKED]: 'affected_transport_node',
});

const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const validDate = (value) => value && Number.isFinite(new Date(value).getTime());

function relationDocumentId(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object') {
    if (typeof value.documentId === 'string' && value.documentId.trim()) return value.documentId.trim();
    const connected = Array.isArray(value.connect) ? value.connect[0] : null;
    if (typeof connected === 'string' && connected.trim()) return connected.trim();
    if (connected && typeof connected.documentId === 'string') return connected.documentId.trim() || null;
  }
  return null;
}

function validPosition(value) {
  return Array.isArray(value) && value.length >= 2
    && Number.isFinite(value[0]) && value[0] >= -180 && value[0] <= 180
    && Number.isFinite(value[1]) && value[1] >= -90 && value[1] <= 90
    && !(value[0] === 0 && value[1] === 0);
}

function positionsEqual(first, second) {
  return first.length >= 2 && second.length >= 2
    && first[0] === second[0] && first[1] === second[1];
}

function validLine(value) {
  return Array.isArray(value) && value.length >= 2 && value.every(validPosition);
}

function validRing(value) {
  return Array.isArray(value) && value.length >= 4
    && value.every(validPosition) && positionsEqual(value[0], value[value.length - 1]);
}

function validPolygon(value) {
  return Array.isArray(value) && value.length > 0 && value.every(validRing);
}

function validDisruptionGeometry(value) {
  if (value == null) return true;
  if (!value || typeof value !== 'object' || !Array.isArray(value.coordinates)) return false;
  switch (value.type) {
    case 'Point': return validPosition(value.coordinates);
    case 'LineString': return validLine(value.coordinates);
    case 'Polygon': return validPolygon(value.coordinates);
    case 'MultiLineString': return value.coordinates.length > 0 && value.coordinates.every(validLine);
    case 'MultiPolygon': return value.coordinates.length > 0 && value.coordinates.every(validPolygon);
    default: return false;
  }
}

function conservativeDisruptionDefaults(input = {}) {
  return {
    ...input,
    planning_enabled: input.planning_enabled === true,
    verification_status: input.verification_status || VERIFICATION_STATUS.RESEARCH_CANDIDATE,
    data_mode: input.data_mode || DATA_MODE.SIMULATED,
    geometry_source: input.geometry_source || GEOMETRY_SOURCE.UNKNOWN,
  };
}

function validateDisruption(record, {
  requireEffect = false,
  requireResolutionDetails = true,
  targetRecords = {},
} = {}) {
  const errors = [];
  const effectValues = new Set(Object.values(DISRUPTION_EFFECT));
  const geometrySources = new Set(Object.values(GEOMETRY_SOURCE));
  const routeId = relationDocumentId(record.affected_route);
  const variantId = relationDocumentId(record.affected_route_variant);
  const nodeId = relationDocumentId(record.affected_transport_node);

  const boundedText = (value, maximum, required = false) => {
    if (value == null || value === '') return !required;
    return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maximum;
  };
  if (!boundedText(record.title, 160, true)) errors.push('TITLE_INVALID');
  if (!boundedText(record.description, 2000)) errors.push('DESCRIPTION_INVALID');
  if (!boundedText(record.notes, 2000)) errors.push('NOTES_INVALID');
  if (!boundedText(record.resolution_notes, 1000)) errors.push('RESOLUTION_NOTES_INVALID');
  if (!boundedText(record.source_name, 160)) errors.push('SOURCE_NAME_INVALID');
  if (!boundedText(record.source_reference, 500)) errors.push('SOURCE_REFERENCE_INVALID');
  if (!boundedText(record.source_url, 1000)) errors.push('SOURCE_URL_INVALID');
  const hasLatitude = record.latitude !== null && record.latitude !== undefined && record.latitude !== '';
  const hasLongitude = record.longitude !== null && record.longitude !== undefined && record.longitude !== '';
  if (hasLatitude !== hasLongitude) errors.push('COORDINATE_PAIR_REQUIRED');
  if (hasLatitude && hasLongitude) {
    const lat = Number(record.latitude);
    const lng = Number(record.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)
      || lat < -90 || lat > 90 || lng < -180 || lng > 180 || (lat === 0 && lng === 0)) {
      errors.push('COORDINATES_INVALID');
    }
  }

  if ((requireEffect || record.effect != null) && !effectValues.has(record.effect)) {
    errors.push('EFFECT_INVALID_OR_MISSING');
  }

  const requiredTarget = EFFECT_TARGET[record.effect];
  if (requiredTarget && !relationDocumentId(record[requiredTarget])) {
    errors.push(`${requiredTarget.toUpperCase()}_REQUIRED`);
  }
  if (record.effect === DISRUPTION_EFFECT.LIMITED_SERVICE && !routeId && !variantId) {
    errors.push('ROUTE_OR_VARIANT_REQUIRED');
  }

  if (routeId && !targetRecords.route) errors.push('AFFECTED_ROUTE_NOT_FOUND');
  if (variantId && !targetRecords.variant) errors.push('AFFECTED_ROUTE_VARIANT_NOT_FOUND');
  if (nodeId && !targetRecords.node) errors.push('AFFECTED_TRANSPORT_NODE_NOT_FOUND');

  const variantRouteId = relationDocumentId(targetRecords.variant?.route);
  if (routeId && variantId && variantRouteId && routeId !== variantRouteId) {
    errors.push('VARIANT_ROUTE_MISMATCH');
  }

  if (!validDate(record.starts_at)) errors.push('STARTS_AT_INVALID_OR_MISSING');
  if (record.ends_at != null && !validDate(record.ends_at)) errors.push('ENDS_AT_INVALID');
  if (validDate(record.starts_at) && validDate(record.ends_at)
    && new Date(record.ends_at).getTime() <= new Date(record.starts_at).getTime()) {
    errors.push('ENDS_AT_MUST_FOLLOW_STARTS_AT');
  }

  if (record.disruption_status === 'resolved' && requireResolutionDetails) {
    if (!validDate(record.resolved_at)) errors.push('RESOLVED_AT_REQUIRED');
    if (!hasText(record.resolution_notes)) errors.push('RESOLUTION_NOTES_REQUIRED');
  }
  if (record.resolved_at != null && !validDate(record.resolved_at)) errors.push('RESOLVED_AT_INVALID');

  if (!geometrySources.has(record.geometry_source)) errors.push('GEOMETRY_SOURCE_INVALID');
  if (!validDisruptionGeometry(record.geometry_geojson)) errors.push('GEOMETRY_INVALID');
  if (record.geometry_geojson == null && record.geometry_source !== GEOMETRY_SOURCE.UNKNOWN) {
    errors.push('GEOMETRY_REQUIRED_FOR_SOURCE');
  }
  if (record.geometry_source === GEOMETRY_SOURCE.SIMULATED && record.data_mode !== DATA_MODE.SIMULATED) {
    errors.push('SIMULATED_GEOMETRY_REQUIRES_SIMULATED_MODE');
  }

  if (record.planning_enabled === true) {
    const eligibility = planningEligibilityFor(record);
    errors.push(...eligibility.reasons.map((reason) => `PLANNING_${reason}`));
    if (!effectValues.has(record.effect)) errors.push('PLANNING_EFFECT_REQUIRED');
    if (record.geometry_geojson != null && !VERIFIED_GEOMETRY_SOURCES.has(record.geometry_source)) {
      errors.push('PLANNING_GEOMETRY_NOT_VERIFIED');
    }
  }

  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

function enforceTrustManagementRole(requested, { isAdministrator = false, existing = null } = {}) {
  if (isAdministrator) return [];
  const errors = [];
  const administratorFields = ['planning_enabled', 'verification_status', 'verified_at'];
  for (const field of administratorFields) {
    if (Object.prototype.hasOwnProperty.call(requested, field)) errors.push(`${field.toUpperCase()}_ADMIN_ONLY`);
  }
  const planningFields = [
    'effect', 'affected_route', 'affected_route_variant', 'affected_transport_node',
    'starts_at', 'ends_at', 'data_mode', 'geometry_source', 'geometry_geojson',
    'source_name', 'source_url', 'source_reference',
  ];
  const protectedChange = planningFields.some((field) =>
    Object.prototype.hasOwnProperty.call(requested, field)
      && !(field === 'ends_at' && requested.disruption_status === 'resolved'));
  if (existing?.planning_enabled === true && protectedChange) {
    errors.push('PLANNING_ENABLED_DISRUPTION_ADMIN_ONLY');
  }
  return [...new Set(errors)];
}

module.exports = {
  DATA_MODE,
  DISRUPTION_EFFECT,
  EFFECT_TARGET,
  GEOMETRY_SOURCE,
  VERIFIED_GEOMETRY_SOURCES,
  VERIFICATION_STATUS,
  conservativeDisruptionDefaults,
  enforceTrustManagementRole,
  relationDocumentId,
  validDisruptionGeometry,
  validateDisruption,
};
