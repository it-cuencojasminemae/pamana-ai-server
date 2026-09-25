'use strict';

const {
  planningEligibilityFor,
} = require('../transport-data/planning-eligibility');
const {
  PLANNING_OPERATING_STATUSES,
  TRANSPORT_MODES,
} = require('./types');

const text = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;
const identity = (record) => text(record?.documentId)
  || text(record?.document_id)
  || (record?.id !== undefined && record?.id !== null ? String(record.id) : null);

function unwrapRecord(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.data !== undefined) return unwrapRecord(value.data);
  if (value.attributes && typeof value.attributes === 'object') {
    return { ...value, ...value.attributes };
  }
  return value;
}

function unwrapMany(value) {
  const unwrapped = value && typeof value === 'object' && !Array.isArray(value) && value.data !== undefined
    ? value.data
    : value;
  return Array.isArray(unwrapped) ? unwrapped.map(unwrapRecord).filter(Boolean) : [];
}

function effectiveDateReason(variant, serviceDate) {
  const day = new Date(serviceDate);
  if (!Number.isFinite(day.getTime())) return 'SERVICE_DATE_INVALID';
  day.setUTCHours(0, 0, 0, 0);
  for (const [field, relation] of [['effective_from', 'after'], ['effective_to', 'before']]) {
    if (!variant[field]) continue;
    const boundary = new Date(`${variant[field]}T00:00:00.000Z`);
    if (!Number.isFinite(boundary.getTime())) return `${field.toUpperCase()}_INVALID`;
    if (relation === 'after' && day < boundary) return 'NOT_YET_EFFECTIVE';
    if (relation === 'before' && day > boundary) return 'NO_LONGER_EFFECTIVE';
  }
  return null;
}

function routeVariantPlanningEligibilityFor(rawVariant, {
  demoMode = false,
  serviceDate = new Date(),
} = {}) {
  const variant = unwrapRecord(rawVariant);
  const reasons = [];
  if (!variant) return { eligible: false, reasons: ['VARIANT_MISSING'] };

  planningEligibilityFor(variant, { allowSimulated: demoMode }).reasons
    .forEach((reason) => reasons.push(`VARIANT_${reason}`));

  if (!PLANNING_OPERATING_STATUSES.includes(variant.operating_status)) {
    reasons.push('VARIANT_NOT_OPERATING');
  }

  const dateReason = effectiveDateReason(variant, serviceDate);
  if (dateReason) reasons.push(`VARIANT_${dateReason}`);

  const route = unwrapRecord(variant.route);
  if (!route) {
    reasons.push('ROUTE_MISSING');
  } else {
    planningEligibilityFor(route, { requireActive: true, allowSimulated: demoMode }).reasons
      .forEach((reason) => reasons.push(`ROUTE_${reason}`));
    if (route.active !== true) reasons.push('ROUTE_ACTIVE_FLAG_FALSE');
    if (!TRANSPORT_MODES.includes(route.transport_mode)) reasons.push('TRANSPORT_MODE_UNSUPPORTED');
  }

  const stops = unwrapMany(variant.route_variant_stops);
  if (stops.length < 2) reasons.push('VARIANT_STOP_SEQUENCE_INCOMPLETE');
  const sequences = new Set();
  for (const [index, stop] of stops.entries()) {
    if (!Number.isInteger(stop.sequence) || stop.sequence < 1 || sequences.has(stop.sequence)) {
      reasons.push(`STOP_${index + 1}_SEQUENCE_INVALID`);
    }
    sequences.add(stop.sequence);
    const node = unwrapRecord(stop.transport_node);
    if (!node) {
      reasons.push(`STOP_${index + 1}_NODE_MISSING`);
      continue;
    }
    planningEligibilityFor(node, { allowSimulated: demoMode }).reasons
      .forEach((reason) => reasons.push(`STOP_${index + 1}_NODE_${reason}`));
  }

  return { eligible: reasons.length === 0, reasons };
}

function normalizeNode(rawNode) {
  const node = unwrapRecord(rawNode);
  const id = identity(node);
  const nodeCode = text(node?.node_code);
  const name = text(node?.name);
  if (!id || !nodeCode || !name) return null;
  return Object.freeze({
    id,
    databaseId: node.id ?? null,
    documentId: text(node.documentId) || text(node.document_id),
    nodeCode,
    name,
    nodeType: text(node.node_type),
    verificationStatus: node.verification_status,
    dataMode: node.data_mode,
  });
}

function normalizeVariant(rawVariant) {
  const variant = unwrapRecord(rawVariant);
  const route = unwrapRecord(variant.route);
  const id = identity(variant);
  const routeId = identity(route);
  if (!id || !routeId || !text(variant.variant_code) || !text(route.route_code)) return null;
  const stops = unwrapMany(variant.route_variant_stops)
    .map((rawStop) => {
      const node = normalizeNode(rawStop.transport_node);
      if (!node) return null;
      return Object.freeze({
        id: identity(rawStop) || `${id}-sequence-${rawStop.sequence}`,
        sequence: rawStop.sequence,
        distanceFromVariantStartMeters: rawStop.distance_from_variant_start_m !== null
          && rawStop.distance_from_variant_start_m !== undefined
          && rawStop.distance_from_variant_start_m !== ''
          && Number.isFinite(Number(rawStop.distance_from_variant_start_m))
          ? Number(rawStop.distance_from_variant_start_m)
          : null,
        pickupAllowed: rawStop.pickup_allowed === true,
        dropoffAllowed: rawStop.dropoff_allowed === true,
        transferAllowed: rawStop.transfer_allowed === true,
        node,
      });
    })
    .filter(Boolean)
    .sort((first, second) => first.sequence - second.sequence);
  return Object.freeze({
    id,
    variantCode: variant.variant_code,
    direction: variant.direction,
    signboard: text(variant.signboard_text),
    operatingStatus: variant.operating_status,
    verificationStatus: variant.verification_status,
    dataMode: variant.data_mode,
    route: Object.freeze({
      id: routeId,
      routeCode: route.route_code,
      transportMode: route.transport_mode,
    }),
    stops: Object.freeze(stops),
  });
}

function edgeKey(edge) {
  return [edge.variant.id, edge.boardStop.node.id, edge.alightStop.node.id,
    edge.boardStop.sequence, edge.alightStop.sequence].join('|');
}

/**
 * Produces forward-only ride edges. A reverse service can only appear through
 * its own eligible RouteVariant and ordered RouteVariantStop records.
 */
function buildTransportGraph({ variants = [] } = {}, options = {}) {
  const nodes = new Map();
  const aliases = new Map();
  const variantMap = new Map();
  const outgoing = new Map();
  const seenVariants = new Set();
  const seenEdges = new Set();
  const excludedVariants = [];

  for (const rawVariant of Array.isArray(variants) ? variants : []) {
    const eligibility = routeVariantPlanningEligibilityFor(rawVariant, options);
    const rawId = identity(unwrapRecord(rawVariant)) || 'unknown';
    if (!eligibility.eligible) {
      excludedVariants.push(Object.freeze({ id: rawId, reasons: Object.freeze(eligibility.reasons) }));
      continue;
    }
    const variant = normalizeVariant(rawVariant);
    if (!variant || seenVariants.has(variant.id)) continue;
    seenVariants.add(variant.id);
    variantMap.set(variant.id, variant);

    for (const stop of variant.stops) {
      nodes.set(stop.node.id, stop.node);
      for (const alias of [stop.node.id, stop.node.documentId, stop.node.databaseId, stop.node.nodeCode]) {
        if (alias !== null && alias !== undefined) aliases.set(String(alias), stop.node.id);
      }
    }

    for (let boardIndex = 0; boardIndex < variant.stops.length - 1; boardIndex += 1) {
      const boardStop = variant.stops[boardIndex];
      if (!boardStop.pickupAllowed) continue;
      for (let alightIndex = boardIndex + 1; alightIndex < variant.stops.length; alightIndex += 1) {
        const alightStop = variant.stops[alightIndex];
        if (!alightStop.dropoffAllowed || alightStop.sequence <= boardStop.sequence) continue;
        const edge = Object.freeze({
          variant,
          boardStop,
          alightStop,
          intermediateNodes: Object.freeze(
            variant.stops.slice(boardIndex + 1, alightIndex).map((stop) => stop.node)
          ),
        });
        const key = edgeKey(edge);
        if (seenEdges.has(key)) continue;
        seenEdges.add(key);
        const current = outgoing.get(boardStop.node.id) || [];
        current.push(edge);
        outgoing.set(boardStop.node.id, current);
      }
    }
  }

  for (const edges of outgoing.values()) {
    edges.sort((first, second) => edgeKey(first).localeCompare(edgeKey(second)));
    Object.freeze(edges);
  }

  const resolveNodeId = (candidate) => aliases.get(String(candidate)) || null;
  return Object.freeze({
    nodes,
    variants: variantMap,
    outgoing,
    excludedVariants: Object.freeze(excludedVariants),
    resolveNodeId,
  });
}

module.exports = {
  buildTransportGraph,
  normalizeNode,
  normalizeVariant,
  routeVariantPlanningEligibilityFor,
  unwrapMany,
  unwrapRecord,
};
