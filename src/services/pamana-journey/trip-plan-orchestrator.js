'use strict';

const { buildTransportGraph } = require('./graph-builder');
const { loadEligibleCoordinateNodes } = require('./access-node-finder');
const { loadEligibleTransportGraphData } = require('./transport-data-loader');
const { planJourneysWithWalkingCandidates } = require('./walking-journey-service');
const { getDefaultWalkingRouter } = require('./walking-router');
const { loadFareAndServiceData } = require('./fare-service-data-loader');
const { loadOperationalData } = require('./availability-data-loader');
const { enrichJourneyInformation } = require('./journey-information-enricher');
const { tripPlanConfig } = require('./trip-plan-config');
const { countVehicleTransfers } = require('./transfer-count');
const { recommendJourneys } = require('./journey-recommendations');
const { loadEligibleDisruptions } = require('./disruption-data-loader');
const { applyDisruptionConstraints, attachDisruptionWarnings } = require('./disruption-engine');
const { expansionSettings, filterExpansionGraphData } = require('./pilot-expansion');
const { planningContext } = require('./planning-context');
const { materializeResearchTransport } = require('./research-transport');
const { attachCorridorConnectors } = require('./corridor-connectors');
const { requestBudget } = require('./provider-budget');
const { demoObservations } = require('./research-demo-observations');
const { resultKey } = require('./journey-result-deduplicator');

const TRIP_PLAN_STATUS = Object.freeze({
  INVALID_REQUEST: 'INVALID_REQUEST',
  JOURNEYS_FOUND: 'JOURNEYS_FOUND',
  NO_ELIGIBLE_ACCESS_NODES: 'NO_ELIGIBLE_ACCESS_NODES',
  NO_TRANSPORT_JOURNEY: 'NO_TRANSPORT_JOURNEY',
  ROUTING_PROVIDER_UNAVAILABLE: 'ROUTING_PROVIDER_UNAVAILABLE',
});

const PROVIDER_FAILURES = new Set([
  'ROUTING_PROVIDER_NOT_CONFIGURED', 'ROUTING_PROVIDER_AUTHORIZATION_FAILED',
  'ROUTING_RATE_LIMITED', 'ROUTING_TIMEOUT', 'ROUTING_NETWORK_ERROR',
  'ROUTING_PROVIDER_UNAVAILABLE', 'ROUTING_INVALID_RESPONSE',
]);
const VERIFIED_GEOMETRY_SOURCES = new Set([
  'FIELD_GPS', 'AUTHORITATIVE', 'GOOGLE_ROAD_MATCHED', 'MANUAL_VERIFIED',
]);

function recordIdentity(record) {
  return record?.documentId || record?.document_id || (record?.id == null ? null : String(record.id));
}

function validTransitGeometry(value) {
  if (!value || !['LineString', 'MultiLineString'].includes(value.type)
    || !Array.isArray(value.coordinates) || value.coordinates.length === 0) return null;
  const validPosition = (position) => Array.isArray(position) && position.length >= 2
    && Number.isFinite(position[0]) && position[0] >= -180 && position[0] <= 180
    && Number.isFinite(position[1]) && position[1] >= -90 && position[1] <= 90;
  const validLine = (line) => Array.isArray(line) && line.length >= 2 && line.every(validPosition);
  const valid = value.type === 'LineString'
    ? validLine(value.coordinates)
    : value.coordinates.every(validLine);
  if (!valid) return null;
  return Object.freeze({ type: value.type, coordinates: structuredClone(value.coordinates) });
}

function transitGeometryMap(graphData) {
  const result = new Map();
  for (const variant of Array.isArray(graphData?.variants) ? graphData.variants : []) {
    if (!VERIFIED_GEOMETRY_SOURCES.has(variant?.geometry_source)) continue;
    const geometry = validTransitGeometry(variant.geometry_geojson);
    const id = recordIdentity(variant);
    if (id && geometry) result.set(id, geometry);
  }
  return result;
}

function stableJourneyKey(journey) {
  return (journey?.legs || []).filter((leg) => leg.type === 'TRANSIT')
    .map((leg) => `${leg.variantCode || ''}:${leg.boardAt?.nodeCode || ''}:${leg.alightAt?.nodeCode || ''}`)
    .join('>');
}

function sortJourneys(journeys, { preferWalking = false } = {}) {
  const accessCost = (journey, metric) => journey.legs.filter(leg => leg.type === 'WALK' && leg.purpose === 'ACCESS')
    .reduce((sum, leg) => sum + (Number.isFinite(leg[metric]) ? leg[metric] : Infinity), 0);
  return [...journeys].sort((first, second) =>
    Number(first.transferCount || 0) - Number(second.transferCount || 0)
    || first.legs.filter((leg) => leg.type === 'TRANSIT').length
      - second.legs.filter((leg) => leg.type === 'TRANSIT').length
    || (preferWalking ? accessCost(first, 'distanceMeters') - accessCost(second, 'distanceMeters')
      || accessCost(first, 'durationSeconds') - accessCost(second, 'durationSeconds') : 0)
    || (preferWalking ? first.legs.filter(l => l.type === 'WALK').reduce((sum, l) => sum + (l.distanceMeters || 0), 0)
      - second.legs.filter(l => l.type === 'WALK').reduce((sum, l) => sum + (l.distanceMeters || 0), 0) : 0)
    || stableJourneyKey(first).localeCompare(stableJourneyKey(second))
  );
}

function distinctRidePatterns(journeys, options = {}) {
  const groups = new Map();
  const walkDistance = j => (j.legs || []).filter(l => l.type === 'WALK').reduce((sum, l) => sum + (Number.isFinite(l.distanceMeters) ? l.distanceMeters : Infinity), 0);
  for (const journey of sortJourneys(journeys)) {
    const key = journey.legs.filter(l => l.type === 'TRANSIT').map(l => l.variantCode).join('>')
      + '|' + (journey.transferConnections || []).map(c => c?.id || '').join('>');
    const current = groups.get(key);
    if (!current || walkDistance(journey) < walkDistance(current)) groups.set(key, journey);
  }
  return sortJourneys([...groups.values()], options);
}

function legWarnings(leg) {
  return [
    ...(leg?.fare?.warnings || []),
    ...(leg?.service?.warnings || []),
    ...(leg?.availability?.warnings || []),
  ];
}

function normalizeLeg(leg, { transitGeometries = new Map() } = {}) {
  if (leg.type === 'TRANSIT') {
    return Object.freeze({
      sequence: leg.sequence,
      type: leg.type,
      transportMode: leg.transportMode || null,
      route: Object.freeze({ id: leg.routeId || null, code: leg.routeCode || null }),
      variant: Object.freeze({ id: leg.routeVariantId || null, code: leg.variantCode || null }),
      direction: leg.direction || null,
      operatingStatus: leg.operatingStatus || null,
      boardAt: leg.boardAt || null,
      alightAt: leg.alightAt || null,
      intermediateNodes: leg.intermediateNodes || Object.freeze([]),
      signboard: leg.signboard || null,
      ...(leg.signboardAliases ? { signboardAliases: leg.signboardAliases } : {}),
      ...(leg.boardingInstructions ? { boardingInstructions: leg.boardingInstructions } : {}),
      segmentDistanceMeters: leg.segmentDistanceMeters ?? null,
      roadDistanceSource: leg.roadDistanceSource || null,
      durationSeconds: leg.simulatedDurationSeconds ?? null,
      geometry: leg.rideGeometry || transitGeometries.get(leg.routeVariantId) || null,
      ...(leg.evidenceClass ? { evidenceClass: leg.evidenceClass } : {}),
      ...(leg.geometrySource ? { geometrySource: leg.geometrySource } : {}),
      ...(leg.simulatedDurationSeconds != null ? { durationEvidenceClass: 'SIMULATED' } : {}),
      fare: leg.fare,
      service: leg.service,
      availability: leg.availability,
    });
  }
  return Object.freeze({ ...leg });
}

function normalizeJourney(journey, options = {}) {
  const legs = Object.freeze(journey.legs.map((leg) => normalizeLeg(leg, options)));
  const walkingDurationSeconds = legs
    .filter((leg) => leg.type === 'WALK' && Number.isFinite(leg.durationSeconds))
    .reduce((total, leg) => total + leg.durationSeconds, 0);
  const hasWalkingDuration = legs.some((leg) => leg.type === 'WALK' && Number.isFinite(leg.durationSeconds));
  const transit = legs.filter(leg => leg.type === 'TRANSIT');
  const simulationComplete = options.context?.allowSimulatedObservations && transit.every(leg => Number.isFinite(leg.durationSeconds)
    && Number.isFinite(leg.availability.wait.lowMinutes) && Number.isFinite(leg.availability.wait.highMinutes))
    && legs.filter(leg => leg.type === 'WALK').every(leg => Number.isFinite(leg.durationSeconds));
  const simulatedTotal = simulationComplete ? walkingDurationSeconds + transit.reduce((sum, leg) => sum + leg.durationSeconds + (leg.availability.wait.lowMinutes + leg.availability.wait.highMinutes) * 30, 0) : null;
  const warningValues = [
    ...(journey.warnings || []),
    ...journey.legs.flatMap(legWarnings),
  ];
  const warnings = [...new Map(warningValues.map((warning) => {
    const key = typeof warning === 'string'
      ? `code:${warning}`
      : `disruption:${warning?.disruptionId || ''}:${warning?.effect || ''}:${warning?.code || ''}`;
    return [key, warning];
  })).values()];
  return Object.freeze({
    id: journey.id,
    transferCount: countVehicleTransfers(legs),
    modes: journey.modes,
    legs,
    fareSummary: journey.fareSummary,
    availabilitySummary: journey.availabilitySummary,
    durationSummary: Object.freeze({
      status: simulatedTotal !== null ? 'KNOWN' : hasWalkingDuration ? 'PARTIAL' : 'UNKNOWN',
      knownWalkingDurationSeconds: hasWalkingDuration ? walkingDurationSeconds : null,
      totalJourneyDurationSeconds: simulatedTotal,
      ...(simulatedTotal !== null ? { evidenceClass: 'SIMULATED' } : {}),
    }),
    warnings: Object.freeze(warnings),
    dataQuality: journey.dataQuality,
  });
}

function baseResponse(request, status, {
  journeys = [], failures = [], warningCodes = [], now, maxJourneys, context,
} = {}) {
  return Object.freeze({
    request,
    status,
    journeys: Object.freeze(journeys),
    recommendations: recommendJourneys(journeys, { context }),
    warnings: Object.freeze([...new Set([
      ...failures.map((failure) => failure.code).filter(Boolean),
      ...warningCodes.filter(Boolean),
    ])]),
    meta: Object.freeze({
      journeyCount: journeys.length,
      generatedAt: now.toISOString(),
      dataMode: 'REAL',
      maxJourneys,
      pendingAccessConnections: failures.filter(failure => PROVIDER_FAILURES.has(failure.code) || failure.code === 'ROUTING_CANCELLED').length,
      ...(context ? { planningMode: context.mode, researchPreview: context.researchPreview,
        evidenceClass: context.researchPreview ? 'LOCAL_RESEARCH' : 'VERIFIED_OPERATIONAL' } : {}),
    }),
  });
}

async function orchestrateTripPlan(request, {
  strapiInstance = global.strapi,
  router = getDefaultWalkingRouter(),
  now = () => new Date(),
  config: configOverrides = {},
  walkingConfig = {},
  signal,
  services = {},
  expansion = expansionSettings(),
  context = planningContext(request.planningMode || 'OPERATIONAL'),
} = {}) {
  const config = tripPlanConfig(configOverrides);
  const generatedAt = now();
  const serviceDate = new Date(request.departureAt);
  const loadNodes = services.loadEligibleCoordinateNodes || loadEligibleCoordinateNodes;
  const loadGraphData = services.loadEligibleTransportGraphData || loadEligibleTransportGraphData;
  const planWalking = services.planJourneysWithWalkingCandidates || planJourneysWithWalkingCandidates;
  const loadInformation = services.loadFareAndServiceData || loadFareAndServiceData;
  const loadOperations = services.loadOperationalData || loadOperationalData;
  const loadDisruptions = services.loadEligibleDisruptions || loadEligibleDisruptions;

  const [loadedNodes, loadedGraphData, disruptions] = await Promise.all([
    loadNodes({ strapiInstance }),
    loadGraphData({ strapiInstance, demoMode: false, serviceDate }),
    loadDisruptions({ strapiInstance, serviceDate, allowSimulated: false }),
  ]);
  const research = materializeResearchTransport(filterExpansionGraphData(loadedGraphData, expansion), loadedNodes, request, context);
  const connected = attachCorridorConnectors(research.graphData, research.nodes, request, { context, sections: research.sections, serviceDate });
  const nodes = connected.nodes, graphData = connected.graphData;
  if (!nodes.length) {
    return baseResponse(request, TRIP_PLAN_STATUS.NO_ELIGIBLE_ACCESS_NODES, {
      now: generatedAt, maxJourneys: config.maxJourneys, context,
    });
  }
  if (!graphData?.variants?.length) {
    return baseResponse(request, TRIP_PLAN_STATUS.NO_TRANSPORT_JOURNEY, {
      now: generatedAt, maxJourneys: config.maxJourneys, context,
    });
  }
  const eligibleGraphData = context.researchPreview ? graphData : filterExpansionGraphData(graphData, expansion);
  const constrained = applyDisruptionConstraints(eligibleGraphData, disruptions);
  let disruptionWarningCodes = [];
  if (!constrained.graphData.variants.length) {
    disruptionWarningCodes = constrained.impact.blockingApplied
      ? ['NO_JOURNEY_DUE_TO_ACTIVE_DISRUPTION'] : [];
    return baseResponse(request, TRIP_PLAN_STATUS.NO_TRANSPORT_JOURNEY, {
      warningCodes: disruptionWarningCodes,
      now: generatedAt,
      maxJourneys: config.maxJourneys,
      context,
    });
  }
  const graph = buildTransportGraph(constrained.graphData, { demoMode: false, serviceDate, context });
  if (constrained.impact.blockingApplied && graph.outgoing.size === 0) {
    const unconstrainedGraph = buildTransportGraph(eligibleGraphData, { demoMode: false, serviceDate, context });
    if (unconstrainedGraph.outgoing.size > 0) {
      disruptionWarningCodes = ['NO_JOURNEY_DUE_TO_ACTIVE_DISRUPTION'];
    }
  }
  const transitGeometries = transitGeometryMap(constrained.graphData);
  const budget = requestBudget(signal, configOverrides.details ? 15000 : 10000);
  let walking;
  try { walking = await planWalking({
    origin: request.origin,
    destination: request.destination,
    nodes,
    graph,
    router,
    config: walkingConfig,
    maxTransfers: context.researchPreview ? 2 : expansion.maxTransfers,
    maxPublicRides: context.researchPreview ? 3 : expansion.maxTransfers + 1,
    allowInitialFeeder: context.researchPreview,
    accessPreference: request.accessPreference || 'AUTO',
    transferConnections: [...expansion.connections, ...(research.connections || [])],
    context,
    signal: budget.signal,
  }); } finally { budget.dispose(); }
  const failures = Array.isArray(walking.failures) ? walking.failures : [];
  if (!walking.accessCandidates?.length || !walking.egressCandidates?.length) {
    const providerUnavailable = failures.some((failure) => PROVIDER_FAILURES.has(failure.code));
    return baseResponse(request, providerUnavailable
      ? TRIP_PLAN_STATUS.ROUTING_PROVIDER_UNAVAILABLE
      : TRIP_PLAN_STATUS.NO_ELIGIBLE_ACCESS_NODES, {
      failures, now: generatedAt, maxJourneys: config.maxJourneys, context,
    });
  }
  // Preview compares alternative boarding points after fare/service enrichment,
  // so a cheaper or otherwise meaningfully different boarding is not discarded.
  const candidates = context.researchPreview ? sortJourneys(walking.journeys || [], { preferWalking: true })
    : expansion.enabled ? distinctRidePatterns(walking.journeys || []) : sortJourneys(walking.journeys || []);
  if (!candidates.length) {
    return baseResponse(request, TRIP_PLAN_STATUS.NO_TRANSPORT_JOURNEY, {
      failures,
      warningCodes: disruptionWarningCodes,
      now: generatedAt,
      maxJourneys: config.maxJourneys,
      context,
    });
  }

  // Compare enriched facts before limiting the unique results. Evidence loads
  // stay bounded to the existing batch size; only duplicates require refilling.
  const journeys = [];
  const seenResults = new Set();
  const seenAccessPatterns = new Set();
  for (let offset = 0; offset < candidates.length && journeys.length < config.maxJourneys; offset += config.maxJourneys) {
    const selected = candidates.slice(offset, offset + config.maxJourneys);
    const combinedJourney = Object.freeze({
      legs: Object.freeze(selected.flatMap((journey) => journey.legs)),
    });
    const [information, operations] = await Promise.all([
      loadInformation({ journey: combinedJourney, requestedDeparture: request.departureAt, strapiInstance }),
      loadOperations({ journey: combinedJourney, strapiInstance, allowSimulated: false }),
    ]);
    const simulation = demoObservations(selected, generatedAt, context);
    const enriched = selected.map((journey) => normalizeJourney(enrichJourneyInformation(
      attachDisruptionWarnings(journey, disruptions), {
        ...information,
        ...operations,
        servicePatterns: [...(information.servicePatterns || []), ...simulation.servicePatterns],
        operationalRecords: [...(operations.operationalRecords || []), ...simulation.operationalRecords],
        passengerCategory: request.passengerCategory,
        requestedDeparture: request.departureAt,
        observedAt: generatedAt,
        allowSimulated: context.allowSimulatedObservations,
        context,
      }
    ), { transitGeometries, context }));
    for (const journey of enriched) {
      const key = resultKey(journey);
      const accessKey = context.researchPreview ? resultKey(journey, { accessAlternatives: true }) : null;
      if (seenResults.has(key) || (accessKey && seenAccessPatterns.has(accessKey))) continue;
      seenResults.add(key);
      if (accessKey) seenAccessPatterns.add(accessKey);
      journeys.push(journey);
      if (journeys.length === config.maxJourneys) break;
    }
  }
  return baseResponse(request, TRIP_PLAN_STATUS.JOURNEYS_FOUND, {
    journeys, failures, now: generatedAt, maxJourneys: config.maxJourneys, context,
  });
}

module.exports = {
  TRIP_PLAN_STATUS,
  normalizeJourney,
  orchestrateTripPlan,
  sortJourneys,
  transitGeometryMap,
  distinctRidePatterns,
};
