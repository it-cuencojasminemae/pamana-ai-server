'use strict';

const {
  PLANNING_ELIGIBLE_STATUSES,
  planningEligibilityFor,
} = require('./planning-eligibility');

const WORKBENCH_ROLES = new Set(['LGU', 'Administrator']);
const ADMIN_ROLE = 'Administrator';
const VERIFIED_GEOMETRY_SOURCES = new Set(['FIELD_GPS', 'AUTHORITATIVE', 'MANUAL_VERIFIED']);
const FARE_TYPES = new Set(['FLAT', 'DISTANCE_BASED', 'ZONE', 'MANUAL_LOOKUP']);
const DISPATCH_TYPES = new Set(['SCHEDULED', 'HEADWAY', 'LEAVE_WHEN_FULL', 'CONTINUOUS_UNSCHEDULED', 'UNKNOWN']);
const ENTITY_CONFIG = Object.freeze({
  'transport-nodes': {
    uid: 'api::transport-node.transport-node',
    labelField: 'name', codeField: 'node_code',
    writable: ['name', 'node_code', 'node_type', 'latitude', 'longitude', 'barangay',
      'municipality_city', 'province', 'source_name', 'source_url', 'source_reference',
      'notes', 'verification_status', 'verified_at', 'planning_enabled', 'data_mode'],
    populate: {},
  },
  routes: {
    uid: 'api::route.route',
    labelField: 'route_name', codeField: 'route_code',
    writable: ['route_name', 'route_code', 'transport_mode', 'origin', 'destination',
      'route_status', 'active', 'cooperative', 'source_name', 'source_url',
      'source_reference', 'notes', 'verification_status', 'verified_at',
      'planning_enabled', 'data_mode'],
    populate: { cooperative: true, route_variants: { fields: ['documentId', 'variant_code'] } },
  },
  'route-variants': {
    uid: 'api::route-variant.route-variant',
    labelField: 'display_name', codeField: 'variant_code',
    writable: ['variant_code', 'display_name', 'direction', 'route', 'signboard_text',
      'start_node', 'end_node', 'operating_status', 'effective_from', 'effective_to',
      'geometry_source', 'geometry_geojson', 'source_type', 'source_name', 'source_url',
      'source_reference', 'notes', 'verification_status', 'verified_at',
      'planning_enabled', 'data_mode'],
    populate: {
      route: true, start_node: true, end_node: true,
      route_variant_stops: { populate: ['transport_node'] },
    },
  },
  'route-variant-stops': {
    uid: 'api::route-variant-stop.route-variant-stop',
    labelField: 'sequence', codeField: 'documentId',
    writable: ['route_variant', 'transport_node', 'sequence', 'pickup_allowed',
      'dropoff_allowed', 'transfer_allowed', 'is_timepoint', 'instruction_template',
      'distance_from_variant_start_m'],
    populate: { route_variant: true, transport_node: true },
  },
  'fare-rules': {
    uid: 'api::fare-rule.fare-rule',
    labelField: 'fare_type', codeField: 'documentId',
    writable: ['route', 'route_variant', 'fare_type', 'currency', 'regular_base_fare',
      'base_distance_km', 'per_km_after_base', 'minimum_fare', 'rounding_rule',
      'student_discount_percent', 'senior_discount_percent', 'pwd_discount_percent',
      'effective_from', 'effective_to', 'source_name', 'source_url', 'source_reference',
      'notes', 'verification_status', 'verified_at', 'planning_enabled', 'data_mode'],
    populate: { route: true, route_variant: { populate: ['route'] } },
  },
  'service-patterns': {
    uid: 'api::service-pattern.service-pattern',
    labelField: 'dispatch_type', codeField: 'documentId',
    writable: ['route_variant', 'days_of_week', 'first_trip_time', 'last_trip_time',
      'dispatch_type', 'headway_min_minutes', 'headway_max_minutes', 'effective_from',
      'effective_to', 'source_name', 'source_url', 'source_reference', 'notes',
      'verification_status', 'verified_at', 'planning_enabled', 'data_mode'],
    populate: { route_variant: { populate: ['route'] } },
  },
});

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const hasText = (value) => typeof value === 'string' && value.trim().length > 0;
const relationId = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') return value;
  return value.documentId || value.document_id || null;
};
const numberOrNull = (value) => value === '' || value === null || value === undefined ? null : Number(value);

function roleName(user) {
  return user?.role?.name || user?.role?.type || null;
}

function canAccessWorkbench(user) {
  return WORKBENCH_ROLES.has(roleName(user));
}

function canElevateTrust(user) {
  return roleName(user) === ADMIN_ROLE;
}

function pickWritable(entity, input = {}) {
  const config = ENTITY_CONFIG[entity];
  if (!config) return {};
  return Object.fromEntries(config.writable.filter((field) => hasOwn(input, field)).map((field) => [field, input[field]]));
}

function finiteCoordinatePair(record) {
  const latitude = numberOrNull(record.latitude);
  const longitude = numberOrNull(record.longitude);
  if (latitude === null && longitude === null) return { valid: true, present: false };
  if (latitude === null || longitude === null) return { valid: false, present: false, reason: 'COORDINATE_PAIR_REQUIRED' };
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)
    || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return { valid: false, present: true, reason: 'COORDINATES_INVALID' };
  }
  if (latitude === 0 && longitude === 0) return { valid: false, present: true, reason: 'NULL_ISLAND_REJECTED' };
  return { valid: true, present: true, latitude, longitude };
}

function validPosition(value) {
  return Array.isArray(value) && value.length >= 2
    && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))
    && Number(value[0]) >= -180 && Number(value[0]) <= 180
    && Number(value[1]) >= -90 && Number(value[1]) <= 90
    && !(Number(value[0]) === 0 && Number(value[1]) === 0);
}

function validTransitGeometry(value) {
  if (value === null || value === undefined) return true;
  const geometry = value?.type === 'Feature' ? value.geometry : value;
  if (!geometry || typeof geometry !== 'object') return false;
  if (geometry.type === 'LineString') {
    return Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2
      && geometry.coordinates.every(validPosition);
  }
  if (geometry.type === 'MultiLineString') {
    return Array.isArray(geometry.coordinates) && geometry.coordinates.length > 0
      && geometry.coordinates.every((line) => Array.isArray(line) && line.length >= 2 && line.every(validPosition));
  }
  return false;
}

function validDateOrder(record) {
  if (!record.effective_from || !record.effective_to) return true;
  const start = new Date(`${record.effective_from}T00:00:00.000Z`).getTime();
  const end = new Date(`${record.effective_to}T00:00:00.000Z`).getTime();
  return Number.isFinite(start) && Number.isFinite(end) && start <= end;
}

function planningEvidenceErrors(record) {
  return planningEligibilityFor(record).reasons;
}

function validateFareRule(record) {
  const errors = [];
  if (!FARE_TYPES.has(record.fare_type)) errors.push('FARE_TYPE_INVALID');
  if (!hasText(record.currency)) errors.push('CURRENCY_REQUIRED');
  const nonNegative = ['regular_base_fare', 'base_distance_km', 'per_km_after_base', 'minimum_fare'];
  for (const field of nonNegative) {
    if (record[field] !== null && record[field] !== undefined && record[field] !== '') {
      const value = Number(record[field]);
      if (!Number.isFinite(value) || value < 0) errors.push(`${field.toUpperCase()}_INVALID`);
    }
  }
  if (record.fare_type === 'FLAT' && numberOrNull(record.regular_base_fare) === null) errors.push('REGULAR_BASE_FARE_REQUIRED');
  if (record.fare_type === 'DISTANCE_BASED') {
    if (numberOrNull(record.regular_base_fare) === null) errors.push('REGULAR_BASE_FARE_REQUIRED');
    if (numberOrNull(record.base_distance_km) === null) errors.push('BASE_DISTANCE_REQUIRED');
    if (numberOrNull(record.per_km_after_base) === null) errors.push('PER_KM_FARE_REQUIRED');
  }
  if (record.fare_type === 'MANUAL_LOOKUP' && !hasText(record.notes) && !hasText(record.source_reference)) {
    errors.push('MANUAL_LOOKUP_REFERENCE_REQUIRED');
  }
  if (!relationId(record.route) && !relationId(record.route_variant)) errors.push('FARE_SCOPE_REQUIRED');
  if (!validDateOrder(record)) errors.push('EFFECTIVE_DATE_RANGE_INVALID');
  return errors;
}

function validateServicePattern(record) {
  const errors = [];
  if (!DISPATCH_TYPES.has(record.dispatch_type)) errors.push('DISPATCH_TYPE_INVALID');
  if (!relationId(record.route_variant)) errors.push('ROUTE_VARIANT_REQUIRED');
  if (!Array.isArray(record.days_of_week) || !record.days_of_week.length) errors.push('SERVICE_DAYS_REQUIRED');
  if (record.first_trip_time && record.last_trip_time && record.first_trip_time > record.last_trip_time) errors.push('SERVICE_TIME_RANGE_INVALID');
  if (['SCHEDULED', 'HEADWAY'].includes(record.dispatch_type)) {
    const minimum = numberOrNull(record.headway_min_minutes);
    const maximum = numberOrNull(record.headway_max_minutes);
    if (!Number.isInteger(minimum) || minimum < 1) errors.push('HEADWAY_MIN_REQUIRED');
    if (!Number.isInteger(maximum) || maximum < 1) errors.push('HEADWAY_MAX_REQUIRED');
    if (Number.isInteger(minimum) && Number.isInteger(maximum) && minimum > maximum) errors.push('HEADWAY_RANGE_INVALID');
  }
  if (!validDateOrder(record)) errors.push('EFFECTIVE_DATE_RANGE_INVALID');
  return errors;
}

function validateStop(record) {
  const errors = [];
  if (!relationId(record.route_variant)) errors.push('ROUTE_VARIANT_REQUIRED');
  if (!relationId(record.transport_node)) errors.push('TRANSPORT_NODE_REQUIRED');
  if (!Number.isInteger(Number(record.sequence)) || Number(record.sequence) < 1) errors.push('STOP_SEQUENCE_INVALID');
  for (const field of ['pickup_allowed', 'dropoff_allowed', 'transfer_allowed']) {
    if (typeof record[field] !== 'boolean') errors.push(`${field.toUpperCase()}_REQUIRED`);
  }
  return errors;
}

function trustElevationRequested(existing = {}, requested = {}) {
  return (hasOwn(requested, 'planning_enabled') && requested.planning_enabled === true && existing.planning_enabled !== true)
    || (hasOwn(requested, 'verification_status') && PLANNING_ELIGIBLE_STATUSES.has(requested.verification_status)
      && existing.verification_status !== requested.verification_status);
}

function trustFieldsChanged(existing = {}, requested = {}) {
  return ['planning_enabled', 'verification_status', 'verified_at'].some((field) =>
    hasOwn(requested, field) && String(requested[field] ?? '') !== String(existing[field] ?? ''));
}

function validateWorkbenchRecord(entity, record, {
  existing = {}, user = null, confirmations = {}, siblingStops = [], relations = {},
} = {}) {
  const errors = [];
  const requested = record || {};
  if (!ENTITY_CONFIG[entity]) return { valid: false, errors: ['ENTITY_NOT_SUPPORTED'] };

  const unauthorizedTrustChange = existing.documentId
    ? trustFieldsChanged(existing, requested)
    : trustElevationRequested({}, requested);
  if (unauthorizedTrustChange && !canElevateTrust(user)) errors.push('TRUST_FIELDS_ADMIN_ONLY');

  if (entity === 'transport-nodes') {
    const coordinates = finiteCoordinatePair(requested);
    if (!coordinates.valid) errors.push(coordinates.reason);
    const coordinateChanged = numberOrNull(existing.latitude) !== numberOrNull(requested.latitude)
      || numberOrNull(existing.longitude) !== numberOrNull(requested.longitude);
    if (coordinateChanged && !confirmations.coordinate) errors.push('COORDINATE_CONFIRMATION_REQUIRED');
    if (!hasText(requested.name)) errors.push('NODE_NAME_REQUIRED');
    if (!hasText(requested.node_code)) errors.push('NODE_CODE_REQUIRED');
    if (requested.planning_enabled === true && !coordinates.present) errors.push('PLANNING_COORDINATES_REQUIRED');
  }

  if (entity === 'routes') {
    if (!hasText(requested.route_name) || !hasText(requested.route_code)) errors.push('ROUTE_IDENTITY_REQUIRED');
    if (requested.planning_enabled === true && (requested.route_status !== 'active' || requested.active !== true)) errors.push('PLANNING_ROUTE_NOT_ACTIVE');
    if (requested.planning_enabled === true && !hasText(requested.transport_mode)) errors.push('TRANSPORT_MODE_REQUIRED');
  }

  if (entity === 'route-variants') {
    if (!hasText(requested.variant_code) || !hasText(requested.display_name)) errors.push('VARIANT_IDENTITY_REQUIRED');
    if (!relationId(requested.route)) errors.push('ROUTE_REQUIRED');
    if (!validDateOrder(requested)) errors.push('EFFECTIVE_DATE_RANGE_INVALID');
    const geometryChanged = JSON.stringify(existing.geometry_geojson ?? null)
      !== JSON.stringify(requested.geometry_geojson ?? null);
    if (requested.geometry_geojson !== null && requested.geometry_geojson !== undefined) {
      if (!validTransitGeometry(requested.geometry_geojson)) errors.push('TRANSIT_GEOMETRY_INVALID');
      if (!VERIFIED_GEOMETRY_SOURCES.has(requested.geometry_source)) errors.push('VERIFIED_GEOMETRY_SOURCE_REQUIRED');
      if (geometryChanged && !confirmations.geometry) errors.push('GEOMETRY_CONFIRMATION_REQUIRED');
    }
    if (requested.planning_enabled === true) {
      if (!['ACTIVE', 'LIMITED'].includes(requested.operating_status)) errors.push('VARIANT_NOT_OPERATING');
      if (!relationId(requested.start_node) || !relationId(requested.end_node)) errors.push('VARIANT_ENDPOINTS_REQUIRED');
      if (siblingStops.length < 2) errors.push('VARIANT_STOP_SEQUENCE_INCOMPLETE');
      if (relations.route) planningEligibilityFor(relations.route, { requireActive: true }).reasons
        .forEach((reason) => errors.push(`ROUTE_${reason}`));
      for (const [field, node] of [['START', relations.start_node], ['END', relations.end_node]]) {
        if (!node) continue;
        planningEligibilityFor(node).reasons.forEach((reason) => errors.push(`${field}_NODE_${reason}`));
        if (!finiteCoordinatePair(node).present) errors.push(`${field}_NODE_COORDINATES_REQUIRED`);
      }
      const sequences = new Set();
      for (const [index, stop] of siblingStops.entries()) {
        if (!Number.isInteger(Number(stop.sequence)) || Number(stop.sequence) < 1 || sequences.has(Number(stop.sequence))) {
          errors.push(`STOP_${index + 1}_SEQUENCE_INVALID`);
        }
        sequences.add(Number(stop.sequence));
        if (!stop.transport_node) errors.push(`STOP_${index + 1}_NODE_MISSING`);
        else planningEligibilityFor(stop.transport_node).reasons
          .forEach((reason) => errors.push(`STOP_${index + 1}_NODE_${reason}`));
      }
    }
  }

  if (entity === 'route-variant-stops') {
    errors.push(...validateStop(requested));
    const changedOrder = existing.documentId && Number(existing.sequence) !== Number(requested.sequence);
    if (changedOrder && !confirmations.order) errors.push('STOP_ORDER_CONFIRMATION_REQUIRED');
    if (siblingStops.some((stop) => stop.documentId !== existing.documentId
      && Number(stop.sequence) === Number(requested.sequence))) errors.push('DUPLICATE_STOP_SEQUENCE');
  }

  if (entity === 'fare-rules') {
    errors.push(...validateFareRule(requested));
    if (requested.planning_enabled === true) {
      const scope = relations.route_variant || relations.route;
      if (!scope?.planning_enabled) errors.push('FARE_SCOPE_NOT_PLANNING_ENABLED');
    }
  }
  if (entity === 'service-patterns') {
    errors.push(...validateServicePattern(requested));
    if (requested.planning_enabled === true && !relations.route_variant?.planning_enabled) {
      errors.push('ROUTE_VARIANT_NOT_PLANNING_ENABLED');
    }
  }

  if (requested.planning_enabled === true) {
    errors.push(...planningEvidenceErrors(requested));
  } else if (PLANNING_ELIGIBLE_STATUSES.has(requested.verification_status)) {
    if (!hasText(requested.source_name)) errors.push('SOURCE_NAME_MISSING');
    if (!hasText(requested.source_reference) && !hasText(requested.source_url)) errors.push('SOURCE_REFERENCE_MISSING');
    if (!requested.verified_at || !Number.isFinite(new Date(requested.verified_at).getTime())) errors.push('VERIFIED_AT_MISSING_OR_INVALID');
  }

  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

function criticalFields(entity, record = {}) {
  const missing = [];
  const add = (condition, field) => { if (condition) missing.push(field); };
  if (entity === 'route-variant-stops') {
    add(!Number.isInteger(Number(record.sequence)) || Number(record.sequence) < 1, 'sequence');
  } else {
    add(!hasText(record[ENTITY_CONFIG[entity]?.labelField]), ENTITY_CONFIG[entity]?.labelField || 'name');
  }
  if (entity === 'transport-nodes') add(!finiteCoordinatePair(record).present, 'coordinates');
  if (entity === 'routes') add(!hasText(record.transport_mode), 'transport_mode');
  if (entity === 'route-variants') {
    add(!relationId(record.route), 'route'); add(!relationId(record.start_node), 'start_node'); add(!relationId(record.end_node), 'end_node');
  }
  if (entity === 'route-variant-stops') {
    add(!relationId(record.route_variant), 'route_variant'); add(!relationId(record.transport_node), 'transport_node');
  }
  if (entity === 'fare-rules') add(!FARE_TYPES.has(record.fare_type), 'fare_type');
  if (entity === 'service-patterns') add(!relationId(record.route_variant), 'route_variant');
  if (!['route-variant-stops'].includes(entity)) {
    add(!hasText(record.source_name), 'source_name');
    add(!hasText(record.source_reference) && !hasText(record.source_url), 'source_reference');
  }
  return missing.filter(Boolean);
}

function summarizeRecord(entity, record) {
  return {
    ...record,
    workbench: {
      entity,
      label: String(record?.[ENTITY_CONFIG[entity].labelField] ?? 'Untitled record'),
      code: String(record?.[ENTITY_CONFIG[entity].codeField] ?? record?.documentId ?? ''),
      missingCriticalFields: criticalFields(entity, record),
      evidence: hasText(record?.source_name)
        ? `${record.source_name}${hasText(record.source_reference) ? ` · ${record.source_reference}` : ''}`
        : 'No evidence recorded',
    },
  };
}

module.exports = {
  ADMIN_ROLE, DISPATCH_TYPES, ENTITY_CONFIG, FARE_TYPES, WORKBENCH_ROLES,
  canAccessWorkbench, canElevateTrust, criticalFields, finiteCoordinatePair,
  pickWritable, relationId, roleName, summarizeRecord, trustElevationRequested,
  trustFieldsChanged, validTransitGeometry, validateFareRule, validateServicePattern, validateStop,
  validateWorkbenchRecord,
};
