'use strict';

const { buildTransportGraph } = require('./graph-builder');
const { loadEligibleCoordinateNodes } = require('./access-node-finder');
const { loadEligibleTransportGraphData } = require('./transport-data-loader');
const { planJourneysWithWalkingCandidates } = require('./walking-journey-service');
const { createWalkingRouter } = require('./walking-router');
const { loadFareAndServiceData } = require('./fare-service-data-loader');
const { loadOperationalData } = require('./availability-data-loader');
const { enrichJourneyInformation } = require('./journey-information-enricher');
const { tripPlanConfig } = require('./trip-plan-config');

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

function sortJourneys(journeys) {
  return [...journeys].sort((first, second) =>
    Number(first.transferCount || 0) - Number(second.transferCount || 0)
    || first.legs.filter((leg) => leg.type === 'TRANSIT').length
      - second.legs.filter((leg) => leg.type === 'TRANSIT').length
    || stableJourneyKey(first).localeCompare(stableJourneyKey(second))
  );
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
      segmentDistanceMeters: leg.segmentDistanceMeters ?? null,
      durationSeconds: null,
      geometry: transitGeometries.get(leg.routeVariantId) || null,
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
  const warnings = [...new Set([
    ...(journey.warnings || []),
    ...journey.legs.flatMap(legWarnings),
  ])];
  return Object.freeze({
    id: journey.id,
    transferCount: journey.transferCount,
    modes: journey.modes,
    legs,
    fareSummary: journey.fareSummary,
    availabilitySummary: journey.availabilitySummary,
    durationSummary: Object.freeze({
      status: hasWalkingDuration ? 'PARTIAL' : 'UNKNOWN',
      knownWalkingDurationSeconds: hasWalkingDuration ? walkingDurationSeconds : null,
      totalJourneyDurationSeconds: null,
    }),
    warnings: Object.freeze(warnings),
    dataQuality: journey.dataQuality,
  });
}

function baseResponse(request, status, { journeys = [], failures = [], now, maxJourneys } = {}) {
  return Object.freeze({
    request,
    status,
    journeys: Object.freeze(journeys),
    warnings: Object.freeze([...new Set(failures.map((failure) => failure.code).filter(Boolean))]),
    meta: Object.freeze({
      journeyCount: journeys.length,
      generatedAt: now.toISOString(),
      dataMode: 'REAL',
      maxJourneys,
    }),
  });
}

async function orchestrateTripPlan(request, {
  strapiInstance = global.strapi,
  router = createWalkingRouter(),
  now = () => new Date(),
  config: configOverrides = {},
  walkingConfig = {},
  signal,
  services = {},
} = {}) {
  const config = tripPlanConfig(configOverrides);
  const generatedAt = now();
  const serviceDate = new Date(request.departureAt);
  const loadNodes = services.loadEligibleCoordinateNodes || loadEligibleCoordinateNodes;
  const loadGraphData = services.loadEligibleTransportGraphData || loadEligibleTransportGraphData;
  const planWalking = services.planJourneysWithWalkingCandidates || planJourneysWithWalkingCandidates;
  const loadInformation = services.loadFareAndServiceData || loadFareAndServiceData;
  const loadOperations = services.loadOperationalData || loadOperationalData;

  const [nodes, graphData] = await Promise.all([
    loadNodes({ strapiInstance }),
    loadGraphData({ strapiInstance, demoMode: false, serviceDate }),
  ]);
  if (!nodes.length) {
    return baseResponse(request, TRIP_PLAN_STATUS.NO_ELIGIBLE_ACCESS_NODES, {
      now: generatedAt, maxJourneys: config.maxJourneys,
    });
  }
  if (!graphData?.variants?.length) {
    return baseResponse(request, TRIP_PLAN_STATUS.NO_TRANSPORT_JOURNEY, {
      now: generatedAt, maxJourneys: config.maxJourneys,
    });
  }
  const graph = buildTransportGraph(graphData, { demoMode: false, serviceDate });
  const transitGeometries = transitGeometryMap(graphData);
  const walking = await planWalking({
    origin: request.origin,
    destination: request.destination,
    nodes,
    graph,
    router,
    config: walkingConfig,
    signal,
  });
  const failures = Array.isArray(walking.failures) ? walking.failures : [];
  if (!walking.accessCandidates?.length || !walking.egressCandidates?.length) {
    const providerUnavailable = failures.some((failure) => PROVIDER_FAILURES.has(failure.code));
    return baseResponse(request, providerUnavailable
      ? TRIP_PLAN_STATUS.ROUTING_PROVIDER_UNAVAILABLE
      : TRIP_PLAN_STATUS.NO_ELIGIBLE_ACCESS_NODES, {
      failures, now: generatedAt, maxJourneys: config.maxJourneys,
    });
  }
  const selected = sortJourneys(walking.journeys || []).slice(0, config.maxJourneys);
  if (!selected.length) {
    return baseResponse(request, TRIP_PLAN_STATUS.NO_TRANSPORT_JOURNEY, {
      failures, now: generatedAt, maxJourneys: config.maxJourneys,
    });
  }

  // Load shared evidence once for the bounded result set, then apply the
  // independently testable Phase 12 and 13 evaluators to every journey.
  const combinedJourney = Object.freeze({
    legs: Object.freeze(selected.flatMap((journey) => journey.legs)),
  });
  const [information, operations] = await Promise.all([
    loadInformation({ journey: combinedJourney, requestedDeparture: request.departureAt, strapiInstance }),
    loadOperations({ journey: combinedJourney, strapiInstance, allowSimulated: false }),
  ]);
  const journeys = selected.map((journey) => normalizeJourney(enrichJourneyInformation(journey, {
    ...information,
    ...operations,
    passengerCategory: request.passengerCategory,
    requestedDeparture: request.departureAt,
    observedAt: generatedAt,
    allowSimulated: false,
  }), { transitGeometries }));
  return baseResponse(request, TRIP_PLAN_STATUS.JOURNEYS_FOUND, {
    journeys, failures, now: generatedAt, maxJourneys: config.maxJourneys,
  });
}

module.exports = {
  TRIP_PLAN_STATUS,
  normalizeJourney,
  orchestrateTripPlan,
  sortJourneys,
  transitGeometryMap,
};
