'use strict';

/**
 * trip-search controller
 *
 * Matches a passenger's origin/destination search against active routes and
 * returns three genuinely distinct comparison options - cheapest, fastest,
 * and most reliable - with one of the three additionally flagged as the
 * overall recommendation. Phase 17 (Dynamic Route Recommendation Engine):
 * scores candidates on fare, total journey time, predicted wait, transfers,
 * and reliability (src/services/pamana-ai/wait-time) - a formula, not a
 * trained model, per the guide's own baseline scope.
 *
 * A "trip option" is a (route, direction, vehicle) combination, not just a
 * Route record - the same corridor can have several vehicles, or an
 * alternate routing (a transfer route), each a distinct real candidate. This
 * is what lets the three categories actually differ instead of all landing
 * on the same single candidate.
 */

const { predictWaitTime } = require('../../../services/pamana-ai/wait-time');
const { explainTripRecommendation } = require('../../../services/pamana-ai/explain');

// Assumed overhead (wait + walk between legs) added to total journey time
// for every transfer in a candidate's route - not real headway data, a
// simulated placeholder like the rest of this pilot's predictions.
const TRANSFER_TIME_PENALTY_MINUTES = 12;

// Reliability points deducted per transfer: an extra leg is an extra point
// of failure (missed connection, tricycle availability), so a transfer
// route is modeled as inherently less reliable than a direct one.
const TRANSFER_RELIABILITY_PENALTY = 15;

const VEHICLE_STATUS_RELIABILITY = {
  available: 25,
  in_transit: 15,
  full: 0,
  offline: 0,
};

const OCCUPANCY_RELIABILITY = {
  empty: 15,
  low: 12,
  moderate: 8,
  near_full: 4,
  full: 0,
};

const truthy = (value) => value === 'true' || value === '1';
const isDemoMode = () => String(process.env.DEMO_MODE ?? 'true').toLowerCase() !== 'false';

const RECOMMENDATION_WEIGHTS = {
  fare: 0.2,
  total_time: 0.3,
  wait_time: 0.2,
  reliability: 0.2,
  transfers: 0.1,
};

// Bidirectional, case-insensitive substring match done in memory rather
// than via $containsi: a location picker can send a more specific string
// than what's stored (e.g. "San Luis, Pampanga" vs. the stored "San
// Luis") - $containsi only ever checks one direction, so a more specific
// search string could never match. Fine at this pilot's route count.
const matches = (storedValue, searchValue) => {
  const stored = String(storedValue).toLowerCase().trim();
  const search = String(searchValue).toLowerCase().trim();
  return stored.includes(search) || search.includes(stored);
};

const normalize = (values) => {
  const nums = values.filter((v) => typeof v === 'number' && !Number.isNaN(v));

  if (nums.length === 0) {
    return () => null;
  }

  const min = Math.min(...nums);
  const max = Math.max(...nums);

  if (min === max) {
    return (v) => (typeof v === 'number' ? 0 : null);
  }

  return (v) => (typeof v === 'number' ? (v - min) / (max - min) : null);
};

// Drops the ", Pampanga" suffix and "City of " prefix the seeded route data
// uses for full place names, so a service name reads "San Luis - San
// Fernando Jeepney" instead of "San Luis, Pampanga - City of San Fernando,
// Pampanga Jeepney".
const shortenPlaceName = (name) =>
  String(name)
    .replace(/^City of\s+/i, '')
    .replace(/,\s*Pampanga\s*$/i, '')
    .trim();

const buildServiceName = (originLabel, destinationLabel, transferStopName) => {
  const from = shortenPlaceName(originLabel);
  const to = shortenPlaceName(destinationLabel);

  if (transferStopName) {
    return `${from} - ${to} Jeepney (via ${transferStopName})`;
  }

  return `${from} - ${to} Jeepney`;
};

const reliabilityScoreFor = (waitConfidence, vehicle, transferCount) => {
  let score = waitConfidence * 60;

  if (vehicle) {
    score += VEHICLE_STATUS_RELIABILITY[vehicle.vehicle_status] ?? 0;
    score += OCCUPANCY_RELIABILITY[vehicle.occupancy_level] ?? 8;
  } else {
    score += 8; // no specific vehicle assigned yet - modest default, not zero
  }

  score -= transferCount * TRANSFER_RELIABILITY_PENALTY;

  return Math.max(0, Math.min(1, Math.round(score) / 100));
};

const reliabilityClassificationFor = (score) => {
  if (score >= 0.7) return 'High';
  if (score >= 0.45) return 'Medium';
  return 'Low';
};

const formatStop = (stop, source = 'unverified') =>
  stop
    ? {
        id: stop.id,
        documentId: stop.documentId,
        name: stop.name,
        sequence: stop.sequence,
        latitude: stop.latitude,
        longitude: stop.longitude,
        stop_type: stop.stop_type ?? null,
        // Coordinates identify a stored corridor stop; this is not road
        // geometry or a claim that its exact placement has been field-verified.
        source,
      }
    : null;

const formatVehicle = (vehicle, source, location = null) =>
  vehicle
    ? {
        id: vehicle.id,
        documentId: vehicle.documentId,
        vehicle_number: vehicle.vehicle_number,
        plate_number: vehicle.plate_number ?? null,
        vehicle_type: vehicle.vehicle_type,
        vehicle_status: vehicle.vehicle_status,
        occupancy_level: vehicle.occupancy_level ?? null,
        source,
        location,
      }
    : null;

// The schema has no transfer field. Treat a stop as a transfer only when its
// stored name explicitly identifies it as one; no transfer is inferred from
// ordinary route-stop data.
const findTransferStop = (stops) => stops.find((stop) => /transfer/i.test(stop.name)) ?? null;

const dataQualityFor = (route, waitTime) => {
  const isReferenceRoute = route.route_code === 'SL-SF-01';
  const vehicleSource = isDemoMode() ? 'simulation' : 'unverified';

  return {
    route: isReferenceRoute ? 'reference' : 'simulation',
    fare: isReferenceRoute ? 'reference' : 'simulation',
    travel_time: isReferenceRoute ? 'reference' : 'simulation',
    wait_time: waitTime.basis === 'historical_trip_intervals' ? 'observed' : 'fallback',
    vehicle: vehicleSource,
    occupancy: vehicleSource,
  };
};

const dataNoticeFor = (quality) =>
  quality.route === 'simulation'
    ? 'Demo route: transfer, fare, travel time, vehicle assignment, and availability are simulated for this prototype.'
    : 'Pilot corridor reference: fare and travel time are estimates; vehicle assignment and availability remain demo data until live driver tracking is connected.';

async function latestObservedVehicleLocation(strapi, vehicleId) {
  const activeTrip = await strapi.documents('api::trip.trip').findFirst({
    filters: { vehicle: { id: vehicleId }, trip_status: 'active', is_simulated: false },
    fields: ['id'],
  });

  if (!activeTrip) return null;

  const location = await strapi.documents('api::vehicle-location.vehicle-location').findFirst({
    filters: { trip: { id: activeTrip.id } },
    sort: ['recorded_at:desc'],
    fields: ['latitude', 'longitude', 'recorded_at'],
  });

  if (!location || !Number.isFinite(Number(location.latitude)) || !Number.isFinite(Number(location.longitude))) {
    return null;
  }

  return {
    latitude: Number(location.latitude),
    longitude: Number(location.longitude),
    recorded_at: location.recorded_at,
    source: 'observed',
  };
}

async function buildCandidates(strapi, routes, searchOrigin, searchDestination) {
  const waitTimeCache = new Map();
  const vehicleLocationCache = new Map();
  const candidates = [];

  for (const route of routes) {
    const isReverse = matches(route.destination, searchOrigin) && matches(route.origin, searchDestination);
    const direction = isReverse ? 'inbound' : 'outbound';
    const displayOrigin = isReverse ? route.destination : route.origin;
    const displayDestination = isReverse ? route.origin : route.destination;

    let sortedStops = (route.route_stops || []).slice().sort((a, b) => a.sequence - b.sequence);
    if (isReverse) sortedStops = sortedStops.slice().reverse();

    const transferStop = findTransferStop(sortedStops);
    const transferCount = transferStop ? 1 : 0;

    if (!waitTimeCache.has(route.id)) {
      waitTimeCache.set(route.id, await predictWaitTime(strapi, { routeId: route.id }));
    }
    const waitTime = waitTimeCache.get(route.id);
    const data_quality = dataQualityFor(route, waitTime);

    const eligibleVehicles = (route.vehicles || []).filter((v) => v.vehicle_status !== 'offline');
    const vehicleCandidates = eligibleVehicles.length > 0 ? eligibleVehicles : [null];

    for (const vehicle of vehicleCandidates) {
      const fare = route.base_fare != null ? Number(route.base_fare) : null;
      const estimatedTravelMinutes = route.estimated_travel_time ?? null;
      const reliability_score = reliabilityScoreFor(waitTime.confidence, vehicle, transferCount);
      const totalJourneyMinutes =
        (waitTime.predicted_wait_minutes?.high ?? 0) +
        (estimatedTravelMinutes ?? 0) +
        transferCount * TRANSFER_TIME_PENALTY_MINUTES;
      let vehicle_location = null;
      if (vehicle) {
        if (!vehicleLocationCache.has(vehicle.id)) {
          vehicleLocationCache.set(vehicle.id, await latestObservedVehicleLocation(strapi, vehicle.id));
        }
        vehicle_location = vehicleLocationCache.get(vehicle.id);
      }

      candidates.push({
        id: `${route.documentId}:${direction}:${vehicle ? vehicle.documentId : 'unassigned'}`,
        route,
        direction,
        origin: displayOrigin,
        destination: displayDestination,
        service_name: buildServiceName(
          displayOrigin,
          displayDestination,
          transferStop ? transferStop.name.replace(/\s*Transfer Point$/i, '') : null
        ),
        vehicle,
        vehicle_location,
        pickup_stop: sortedStops[0] ?? null,
        dropoff_stop: sortedStops[sortedStops.length - 1] ?? null,
        stops: sortedStops,
        fare,
        estimated_travel_minutes: estimatedTravelMinutes,
        predicted_wait_minutes: waitTime.predicted_wait_minutes,
        confidence: waitTime.confidence,
        wait_source: data_quality.wait_time,
        data_quality,
        transfer_count: transferCount,
        transfer_stop: transferStop,
        reliability_score,
        reliability_classification: reliabilityClassificationFor(reliability_score),
        total_journey_minutes: totalJourneyMinutes,
      });
    }
  }

  return candidates;
}

const pickBest = (candidates, compareFn) =>
  candidates.reduce((best, candidate) => (!best || compareFn(candidate, best) < 0 ? candidate : best), null);

const byId = (a, b) => a.id.localeCompare(b.id);

const reasonFor = (option, isRecommended) => {
  const parts = [];
  const categories = option.categories ?? [option.category].filter(Boolean);

  if (categories.includes('cheapest')) {
    parts.push(`Lowest listed fare in this comparison at PHP ${option.fare}.`);
  }
  if (categories.includes('fastest')) {
    parts.push(
      `Fastest total journey at about ${option.total_journey_minutes} min, including predicted wait${
        option.transfer_count ? ' and transfer time' : ''
      }.`
    );
  }
  if (categories.includes('most_reliable')) {
    parts.push(
      `Highest reliability score (${Math.round(option.reliability_score * 100)}%) based on the available wait and vehicle inputs${
        option.transfer_count ? '' : ', with no transfers'
      }.`
    );
  }

  if (isRecommended) {
    parts.push('Recommended overall for the best balance of fare, travel time, wait, transfers, and reliability.');
  }

  return parts.join(' ');
};

module.exports = {
  async search(ctx) {
    const { origin, destination } = ctx.query;

    if (!origin || !destination) {
      return ctx.badRequest('Both "origin" and "destination" query parameters are required.');
    }

    const allActiveRoutes = await strapi.documents('api::route.route').findMany({
      filters: { route_status: 'active' },
      populate: {
        route_stops: true,
        vehicles: true,
      },
    });

    const matchedRoutes = allActiveRoutes.filter(
      (route) =>
        (matches(route.origin, origin) && matches(route.destination, destination)) ||
        (matches(route.origin, destination) && matches(route.destination, origin))
    );

    const candidates = await buildCandidates(strapi, matchedRoutes, origin, destination);

    if (candidates.length === 0) {
      ctx.body = {
        data: {
          origin,
          destination,
          options: [],
          recommended_option_id: null,
          recommendation_explanation: null,
          demo_mode: isDemoMode(),
        },
      };
      return;
    }

    const cheapest = pickBest(
      candidates,
      (a, b) => (a.fare ?? Infinity) - (b.fare ?? Infinity) || a.total_journey_minutes - b.total_journey_minutes || byId(a, b)
    );

    const fastest = pickBest(
      candidates,
      (a, b) => a.total_journey_minutes - b.total_journey_minutes || (a.fare ?? Infinity) - (b.fare ?? Infinity) || byId(a, b)
    );

    const mostReliable = pickBest(
      candidates,
      (a, b) => b.reliability_score - a.reliability_score || a.total_journey_minutes - b.total_journey_minutes || byId(a, b)
    );

    // A candidate is ranked independently for every label. This deliberately
    // allows one card to be both Fastest and Most Reliable rather than
    // excluding the mathematically best option just to force three cards.
    const labelsByCandidate = new Map();
    for (const [label, candidate] of [
      ['cheapest', cheapest],
      ['fastest', fastest],
      ['most_reliable', mostReliable],
    ]) {
      if (!labelsByCandidate.has(candidate.id)) {
        labelsByCandidate.set(candidate.id, { ...candidate, categories: [] });
      }
      labelsByCandidate.get(candidate.id).categories.push(label);
    }
    const finalists = Array.from(labelsByCandidate.values());

    // Recommended is computed only among the three finalists (never a
    // fourth option) using the existing weighted-normalization approach,
    // extended to also weigh reliability and transfers alongside fare,
    // travel time, and predicted wait.
    const normalizeFare = normalize(finalists.map((f) => f.fare));
    const normalizeTime = normalize(finalists.map((f) => f.total_journey_minutes));
    const normalizeWait = normalize(finalists.map((f) => f.predicted_wait_minutes?.high ?? null));
    const normalizeReliability = normalize(finalists.map((f) => 1 - f.reliability_score));
    const normalizeTransfers = normalize(finalists.map((f) => f.transfer_count));

    const scored = finalists.map((option) => {
      const penalties = [
        [normalizeFare(option.fare), RECOMMENDATION_WEIGHTS.fare],
        [normalizeTime(option.total_journey_minutes), RECOMMENDATION_WEIGHTS.total_time],
        [normalizeWait(option.predicted_wait_minutes?.high ?? null), RECOMMENDATION_WEIGHTS.wait_time],
        [normalizeReliability(1 - option.reliability_score), RECOMMENDATION_WEIGHTS.reliability],
        [normalizeTransfers(option.transfer_count), RECOMMENDATION_WEIGHTS.transfers],
      ].filter(([value]) => typeof value === 'number');

      const totalWeight = penalties.reduce((sum, [, weight]) => sum + weight, 0);
      const weightedPenalty = totalWeight
        ? penalties.reduce((sum, [value, weight]) => sum + value * weight, 0) / totalWeight
        : null;
      // A higher score is better. It remains a relative ranking for the
      // current search, not a claim of model confidence.
      const recommendation_score = weightedPenalty === null ? null : Math.round((1 - weightedPenalty) * 100) / 100;

      return { ...option, recommendation_score };
    });

    const recommended = scored.reduce(
      (best, option) =>
        !best || (option.recommendation_score ?? -Infinity) > (best.recommendation_score ?? -Infinity) ||
        ((option.recommendation_score ?? -Infinity) === (best.recommendation_score ?? -Infinity) && byId(option, best) < 0)
          ? option
          : best,
      null
    );

    const options = scored.map((option) => {
      const isRecommended = option.id === recommended.id;

      return {
        id: option.id,
        category: option.categories[0],
        categories: option.categories,
        is_cheapest: option.categories.includes('cheapest'),
        is_fastest: option.categories.includes('fastest'),
        is_most_reliable: option.categories.includes('most_reliable'),
        route_id: option.route.documentId,
        route_code: option.route.route_code,
        route_name: option.route.route_name,
        direction: option.direction,
        origin: option.origin,
        destination: option.destination,
        service_name: option.service_name,
        vehicle: formatVehicle(option.vehicle, option.data_quality.vehicle, option.vehicle_location),
        pickup_stop: formatStop(option.pickup_stop, option.data_quality.route),
        dropoff_stop: formatStop(option.dropoff_stop, option.data_quality.route),
        transfer_stop: formatStop(option.transfer_stop, option.data_quality.route),
        fare: option.fare,
        fare_source: option.data_quality.fare,
        estimated_travel_minutes: option.estimated_travel_minutes,
        travel_time_source: option.data_quality.travel_time,
        predicted_wait_minutes: option.predicted_wait_minutes,
        wait_source: option.wait_source,
        reliability_score: option.reliability_score,
        reliability_classification: option.reliability_classification,
        confidence: option.confidence,
        transfer_count: option.transfer_count,
        total_journey_minutes: option.total_journey_minutes,
        recommendation_score: option.recommendation_score,
        stops: option.stops.map((stop) => formatStop(stop, option.data_quality.route)),
        is_recommended: isRecommended,
        reason: reasonFor(option, isRecommended),
        recommendation_reason: reasonFor(option, isRecommended),
        data_quality: option.data_quality,
        data_notice: dataNoticeFor(option.data_quality),
      };
    });

    const recommendedOption = options.find((option) => option.id === recommended.id) ?? null;
    const recommendation_explanation = truthy(ctx.query.explain) && recommendedOption
      ? await explainTripRecommendation(recommendedOption)
      : null;

    ctx.body = {
      data: {
        origin,
        destination,
        options,
        recommended_option_id: recommended.id,
        recommendation_explanation,
        demo_mode: isDemoMode(),
      },
    };
  },
};
