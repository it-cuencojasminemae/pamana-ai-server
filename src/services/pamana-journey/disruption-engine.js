'use strict';

const { DISRUPTION_EFFECT } = require('../disruption/disruption-foundation');
const { unwrapMany, unwrapRecord } = require('./graph-builder');

const BLOCKING_EFFECTS = new Set([
  DISRUPTION_EFFECT.ROUTE_SUSPENDED,
  DISRUPTION_EFFECT.VARIANT_SUSPENDED,
  DISRUPTION_EFFECT.NODE_CLOSED,
  DISRUPTION_EFFECT.BOARDING_CLOSED,
  DISRUPTION_EFFECT.ALIGHTING_CLOSED,
  DISRUPTION_EFFECT.TRANSFER_BLOCKED,
]);
const ADVISORY_EFFECTS = new Set([
  DISRUPTION_EFFECT.WARNING_ONLY,
  DISRUPTION_EFFECT.LIMITED_SERVICE,
]);

const text = (value) => typeof value === 'string' && value.trim() ? value.trim() : null;
const identity = (value) => {
  const record = unwrapRecord(value);
  return text(record?.documentId) || text(record?.document_id)
    || (record?.id == null ? null : String(record.id));
};

function disruptionIndex(disruptions = []) {
  const list = Object.freeze((Array.isArray(disruptions) ? disruptions : []).filter(Boolean));
  const collect = (effect, key) => new Set(list.filter((item) => item.effect === effect && item[key]).map((item) => item[key]));
  return Object.freeze({
    list,
    suspendedRoutes: collect(DISRUPTION_EFFECT.ROUTE_SUSPENDED, 'routeId'),
    suspendedVariants: collect(DISRUPTION_EFFECT.VARIANT_SUSPENDED, 'variantId'),
    closedNodes: collect(DISRUPTION_EFFECT.NODE_CLOSED, 'nodeId'),
    boardingClosedNodes: collect(DISRUPTION_EFFECT.BOARDING_CLOSED, 'nodeId'),
    alightingClosedNodes: collect(DISRUPTION_EFFECT.ALIGHTING_CLOSED, 'nodeId'),
    transferBlockedNodes: collect(DISRUPTION_EFFECT.TRANSFER_BLOCKED, 'nodeId'),
  });
}

function applyDisruptionConstraints(graphData = {}, disruptions = []) {
  const index = disruptionIndex(disruptions);
  const impact = { blockedVariants: 0, constrainedStops: 0, blockingApplied: false };
  const variants = [];
  for (const variant of Array.isArray(graphData?.variants) ? graphData.variants : []) {
    const variantId = identity(variant);
    const routeId = identity(unwrapRecord(variant)?.route);
    if ((routeId && index.suspendedRoutes.has(routeId))
      || (variantId && index.suspendedVariants.has(variantId))) {
      impact.blockedVariants += 1;
      impact.blockingApplied = true;
      continue;
    }
    const rawStops = unwrapMany(unwrapRecord(variant)?.route_variant_stops);
    let changed = false;
    const stops = rawStops.map((stop) => {
      const nodeId = identity(stop.transport_node);
      if (!nodeId) return stop;
      const closed = index.closedNodes.has(nodeId);
      const boardingClosed = closed || index.boardingClosedNodes.has(nodeId);
      const alightingClosed = closed || index.alightingClosedNodes.has(nodeId);
      const transferBlocked = closed || index.transferBlockedNodes.has(nodeId);
      if (!boardingClosed && !alightingClosed && !transferBlocked) return stop;
      changed = true;
      impact.constrainedStops += 1;
      impact.blockingApplied = true;
      return {
        ...stop,
        pickup_allowed: boardingClosed ? false : stop.pickup_allowed,
        dropoff_allowed: alightingClosed ? false : stop.dropoff_allowed,
        transfer_allowed: transferBlocked ? false : stop.transfer_allowed,
      };
    });
    variants.push(changed ? { ...variant, route_variant_stops: stops } : variant);
  }
  return Object.freeze({
    graphData: Object.freeze({ ...graphData, variants: Object.freeze(variants) }),
    index,
    impact: Object.freeze(impact),
  });
}

function journeyTargetSets(journey) {
  const routes = new Set();
  const variants = new Set();
  const nodes = new Set();
  for (const leg of journey?.legs || []) {
    if (leg.type === 'TRANSIT') {
      if (leg.routeId) routes.add(leg.routeId);
      if (leg.route?.id) routes.add(leg.route.id);
      if (leg.routeVariantId) variants.add(leg.routeVariantId);
      if (leg.variant?.id) variants.add(leg.variant.id);
      for (const node of [leg.boardAt, leg.alightAt, ...(leg.intermediateNodes || [])]) {
        if (node?.nodeId) nodes.add(node.nodeId);
      }
    } else if (leg.type === 'TRANSFER' && leg.at?.nodeId) nodes.add(leg.at.nodeId);
  }
  return { routes, variants, nodes };
}

function appliesToJourney(disruption, targets) {
  if (disruption.routeId) return targets.routes.has(disruption.routeId);
  if (disruption.variantId) return targets.variants.has(disruption.variantId);
  if (disruption.nodeId) return targets.nodes.has(disruption.nodeId);
  return disruption.effect === DISRUPTION_EFFECT.WARNING_ONLY;
}

function publicWarning(disruption) {
  return Object.freeze({
    code: disruption.effect === DISRUPTION_EFFECT.LIMITED_SERVICE
      ? 'LIMITED_SERVICE' : 'DISRUPTION_WARNING',
    type: 'DISRUPTION',
    effect: disruption.effect,
    disruptionId: disruption.id,
    message: disruption.title,
    severity: disruption.severity,
    startsAt: disruption.startsAt,
    endsAt: disruption.endsAt,
    geometry: disruption.geometry || null,
  });
}

function disruptionWarningsForJourney(journey, disruptions = []) {
  const targets = journeyTargetSets(journey);
  const unique = new Map();
  for (const disruption of Array.isArray(disruptions) ? disruptions : []) {
    if (!ADVISORY_EFFECTS.has(disruption.effect) || !appliesToJourney(disruption, targets)) continue;
    const warning = publicWarning(disruption);
    const key = `${warning.disruptionId}|${warning.effect}`;
    if (!unique.has(key)) unique.set(key, warning);
  }
  return Object.freeze([...unique.values()]);
}

function attachDisruptionWarnings(journey, disruptions = []) {
  const additions = disruptionWarningsForJourney(journey, disruptions);
  if (!additions.length) return journey;
  return Object.freeze({ ...journey, warnings: Object.freeze([...(journey.warnings || []), ...additions]) });
}

module.exports = {
  ADVISORY_EFFECTS,
  BLOCKING_EFFECTS,
  applyDisruptionConstraints,
  attachDisruptionWarnings,
  disruptionIndex,
  disruptionWarningsForJourney,
  publicWarning,
};
