'use strict';

const {
  planningCandidateFilters,
  planningEligibilityFor,
} = require('../transport-data/planning-eligibility');
const { walkingConfig } = require('./walking-config');
const { normalizePoint } = require('./walking-router');

const EARTH_RADIUS_METERS = 6371008.8;

const text = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;

function identity(node) {
  return text(node?.documentId)
    || text(node?.document_id)
    || (node?.id !== undefined && node?.id !== null ? String(node.id) : null);
}

function usableNodeCoordinate(node) {
  const point = normalizePoint({ lat: node?.latitude, lng: node?.longitude, label: node?.name });
  if (!point || (point.lat === 0 && point.lng === 0)) return null;
  return point;
}

function radians(degrees) {
  return degrees * Math.PI / 180;
}

function haversineMeters(first, second) {
  const from = normalizePoint(first);
  const to = normalizePoint(second);
  if (!from || !to) return null;
  const latitudeDifference = radians(to.lat - from.lat);
  const longitudeDifference = radians(to.lng - from.lng);
  const fromLatitude = radians(from.lat);
  const toLatitude = radians(to.lat);
  const a = Math.sin(latitudeDifference / 2) ** 2
    + Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDifference / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeEligibleNode(node) {
  if (!planningEligibilityFor(node).eligible) return null;
  const point = usableNodeCoordinate(node);
  const nodeId = identity(node);
  const nodeCode = text(node?.node_code);
  const name = text(node?.name);
  if (!point || !nodeId || !nodeCode || !name) return null;
  return Object.freeze({
    nodeId,
    nodeCode,
    name,
    nodeType: text(node.node_type),
    lat: point.lat,
    lng: point.lng,
  });
}

function accessNodeQuery() {
  return {
    filters: {
      ...planningCandidateFilters(),
      latitude: { $notNull: true },
      longitude: { $notNull: true },
    },
    fields: [
      'node_code', 'name', 'node_type', 'latitude', 'longitude',
      'planning_enabled', 'verification_status', 'data_mode', 'verified_at',
      'source_name', 'source_url', 'source_reference',
    ],
    sort: ['node_code:asc'],
  };
}

async function loadEligibleCoordinateNodes({ strapiInstance = global.strapi } = {}) {
  if (!strapiInstance?.documents) throw new Error('STRAPI_DOCUMENT_SERVICE_UNAVAILABLE');
  const nodes = await strapiInstance
    .documents('api::transport-node.transport-node')
    .findMany(accessNodeQuery());
  return Object.freeze((Array.isArray(nodes) ? nodes : [])
    .filter((node) => normalizeEligibleNode(node) !== null));
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await mapper(items[current], current);
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(Math.max(1, limit), items.length) },
    worker
  ));
  return results;
}

function walkingSort(first, second) {
  const firstDistance = first.walkingDistanceMeters ?? first.straightLineDistanceMeters;
  const secondDistance = second.walkingDistanceMeters ?? second.straightLineDistanceMeters;
  return firstDistance - secondDistance || first.node.nodeCode.localeCompare(second.node.nodeCode);
}

/**
 * Haversine distance bounds the provider calls. Geoapify walking distance then
 * refines the candidates but does not select the passenger's transport journey.
 */
async function findAccessNodes({
  point: rawPoint,
  nodes = [],
  direction = 'ACCESS',
  router,
  config: configOverrides = {},
  signal,
} = {}) {
  const point = normalizePoint(rawPoint);
  const config = walkingConfig(configOverrides);
  if (!point) {
    return Object.freeze({ candidates: Object.freeze([]), failures: Object.freeze([
      Object.freeze({ nodeId: null, code: 'ROUTING_INVALID_COORDINATES' }),
    ]) });
  }
  if (!['ACCESS', 'EGRESS'].includes(direction)) {
    throw new Error('ACCESS_NODE_DIRECTION_INVALID');
  }

  const prefetched = [];
  for (const rawNode of Array.isArray(nodes) ? nodes : []) {
    const node = normalizeEligibleNode(rawNode);
    if (!node) continue;
    const straightLineDistanceMeters = haversineMeters(point, node);
    if (straightLineDistanceMeters === null
      || straightLineDistanceMeters > config.maximumCandidateRadiusMeters) continue;
    prefetched.push({ node, straightLineDistanceMeters });
  }
  prefetched.sort((first, second) =>
    first.straightLineDistanceMeters - second.straightLineDistanceMeters
    || first.node.nodeCode.localeCompare(second.node.nodeCode)
  );

  const initial = prefetched.filter((item) =>
    item.straightLineDistanceMeters <= config.initialCandidateRadiusMeters
  );
  const expanded = prefetched.filter((item) =>
    item.straightLineDistanceMeters > config.initialCandidateRadiusMeters
  );
  const shortlist = [...initial, ...expanded].slice(0, config.maxCandidateCount);

  const resolved = await mapWithConcurrency(shortlist, config.maxConcurrentRequests, async (item) => {
    if (item.straightLineDistanceMeters <= config.proximityThresholdMeters) {
      return Object.freeze({
        candidate: Object.freeze({
          node: item.node,
          walkingLeg: null,
          walkingDistanceMeters: null,
          walkingDurationSeconds: null,
          straightLineDistanceMeters: item.straightLineDistanceMeters,
          withinProximityThreshold: true,
        }),
      });
    }
    const from = direction === 'ACCESS' ? point : item.node;
    const to = direction === 'ACCESS' ? item.node : point;
    let result;
    try {
      result = await router?.routeWalk({ from, to, signal });
    } catch {
      result = null;
    }
    if (!result?.ok) {
      return Object.freeze({
        failure: Object.freeze({
          nodeId: item.node.nodeId,
          code: result?.error?.code || 'ROUTING_PROVIDER_UNAVAILABLE',
        }),
      });
    }
    if (result.value.distanceMeters === null
      || result.value.durationSeconds === null
      || result.value.geometry === null) {
      return Object.freeze({
        failure: Object.freeze({ nodeId: item.node.nodeId, code: 'WALKING_ROUTE_UNAVAILABLE' }),
      });
    }
    return Object.freeze({
      candidate: Object.freeze({
        node: item.node,
        walkingLeg: result.value,
        walkingDistanceMeters: result.value.distanceMeters,
        walkingDurationSeconds: result.value.durationSeconds,
        straightLineDistanceMeters: item.straightLineDistanceMeters,
        withinProximityThreshold: false,
      }),
    });
  });

  const candidates = resolved.map((item) => item.candidate).filter(Boolean).sort(walkingSort);
  const failures = resolved.map((item) => item.failure).filter(Boolean);
  return Object.freeze({
    candidates: Object.freeze(candidates),
    failures: Object.freeze(failures),
  });
}

module.exports = {
  accessNodeQuery,
  findAccessNodes,
  haversineMeters,
  loadEligibleCoordinateNodes,
  normalizeEligibleNode,
  usableNodeCoordinate,
};
