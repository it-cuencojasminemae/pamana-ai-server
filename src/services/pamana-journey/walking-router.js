'use strict';

const { walkingConfig } = require('./walking-config');

const WALKING_ERROR = Object.freeze({
  CANCELLED: 'ROUTING_CANCELLED',
  INVALID_COORDINATES: 'ROUTING_INVALID_COORDINATES',
  INVALID_RESPONSE: 'ROUTING_INVALID_RESPONSE',
  NETWORK: 'ROUTING_NETWORK_ERROR',
  NOT_CONFIGURED: 'ROUTING_PROVIDER_NOT_CONFIGURED',
  PROVIDER_AUTHORIZATION: 'ROUTING_PROVIDER_AUTHORIZATION_FAILED',
  PROVIDER_UNAVAILABLE: 'ROUTING_PROVIDER_UNAVAILABLE',
  RATE_LIMITED: 'ROUTING_RATE_LIMITED',
  TIMEOUT: 'ROUTING_TIMEOUT',
});

const retryableErrors = new Set([
  WALKING_ERROR.NETWORK,
  WALKING_ERROR.PROVIDER_UNAVAILABLE,
  WALKING_ERROR.RATE_LIMITED,
  WALKING_ERROR.TIMEOUT,
]);

const failure = (code) => Object.freeze({
  ok: false,
  error: Object.freeze({ code, retryable: retryableErrors.has(code) }),
});

function coordinate(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePoint(point) {
  const lat = coordinate(point?.lat);
  const lng = coordinate(point?.lng);
  if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }
  return Object.freeze({
    lat,
    lng,
    ...(typeof point?.label === 'string' && point.label.trim()
      ? { label: point.label.trim() }
      : {}),
  });
}

function nullableMetric(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function validGeometry(geometry) {
  if (!geometry || !['LineString', 'MultiLineString'].includes(geometry.type)) return null;
  if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) return null;
  return Object.freeze({ type: geometry.type, coordinates: structuredClone(geometry.coordinates) });
}

function normalizeInstructions(properties) {
  const legs = Array.isArray(properties?.legs) ? properties.legs : [];
  const instructions = [];
  for (const leg of legs) {
    for (const step of Array.isArray(leg?.steps) ? leg.steps : []) {
      const text = typeof step?.instruction?.text === 'string'
        ? step.instruction.text.trim()
        : (typeof step?.instruction === 'string' ? step.instruction.trim() : '');
      if (!text) continue;
      instructions.push(Object.freeze({
        text,
        distanceMeters: nullableMetric(step.distance),
        durationSeconds: nullableMetric(step.time),
      }));
    }
  }
  return Object.freeze(instructions);
}

function walkingResult({ from, to, feature = null, calculatedAt }) {
  const properties = feature?.properties && typeof feature.properties === 'object'
    ? feature.properties
    : {};
  return Object.freeze({
    type: 'WALK',
    from,
    to,
    distanceMeters: nullableMetric(properties.distance),
    durationSeconds: nullableMetric(properties.time),
    geometry: validGeometry(feature?.geometry),
    instructions: normalizeInstructions(properties),
    source: 'GEOAPIFY',
    calculatedAt,
  });
}

function normalizeGeoapifyResponse(payload, context) {
  if (!payload || payload.type !== 'FeatureCollection' || !Array.isArray(payload.features)) {
    return failure(WALKING_ERROR.INVALID_RESPONSE);
  }
  if (payload.features.length === 0) {
    return Object.freeze({
      ok: true,
      value: walkingResult({ ...context, calculatedAt: context.calculatedAt }),
    });
  }
  const feature = payload.features[0];
  if (!feature || feature.type !== 'Feature' || !feature.properties || typeof feature.properties !== 'object') {
    return failure(WALKING_ERROR.INVALID_RESPONSE);
  }
  const geometry = validGeometry(feature.geometry);
  const distance = nullableMetric(feature.properties.distance);
  const duration = nullableMetric(feature.properties.time);
  if (!geometry || distance === null || duration === null) {
    return failure(WALKING_ERROR.INVALID_RESPONSE);
  }
  return Object.freeze({
    ok: true,
    value: walkingResult({ ...context, feature, calculatedAt: context.calculatedAt }),
  });
}

function statusFailure(status) {
  if (status === 401 || status === 403) return failure(WALKING_ERROR.PROVIDER_AUTHORIZATION);
  if (status === 429) return failure(WALKING_ERROR.RATE_LIMITED);
  return failure(WALKING_ERROR.PROVIDER_UNAVAILABLE);
}

function createWalkingRouter({
  apiKey = process.env.GEOAPIFY_SERVER_API_KEY,
  fetcher = global.fetch,
  config: configOverrides = {},
  now = () => new Date(),
} = {}) {
  const config = walkingConfig(configOverrides);
  const cache = new Map();

  function cacheKey(from, to) {
    const precision = config.coordinatePrecision;
    return [from.lat, from.lng, to.lat, to.lng]
      .map((value) => value.toFixed(precision))
      .concat('walk')
      .join('|');
  }

  function readCache(key, timestamp) {
    const cached = cache.get(key);
    if (!cached) return null;
    if (timestamp - cached.storedAt >= config.cacheTtlMs) {
      cache.delete(key);
      return null;
    }
    cache.delete(key);
    cache.set(key, cached);
    return cached.result;
  }

  function writeCache(key, result, timestamp) {
    cache.set(key, { result, storedAt: timestamp });
    while (cache.size > config.cacheMaxEntries) cache.delete(cache.keys().next().value);
  }

  async function routeWalk({ from: rawFrom, to: rawTo, signal } = {}) {
    const from = normalizePoint(rawFrom);
    const to = normalizePoint(rawTo);
    if (!from || !to) return failure(WALKING_ERROR.INVALID_COORDINATES);
    if (typeof apiKey !== 'string' || !apiKey.trim()) return failure(WALKING_ERROR.NOT_CONFIGURED);
    if (typeof fetcher !== 'function') return failure(WALKING_ERROR.NETWORK);

    const timestamp = now();
    const timestampMs = timestamp instanceof Date ? timestamp.getTime() : new Date(timestamp).getTime();
    const key = cacheKey(from, to);
    const cached = readCache(key, timestampMs);
    if (cached) return cached;

    const url = new URL(config.routingUrl);
    url.searchParams.set('waypoints', `${from.lat},${from.lng}|${to.lat},${to.lng}`);
    url.searchParams.set('mode', 'walk');
    url.searchParams.set('format', 'geojson');
    url.searchParams.set('apiKey', apiKey.trim());

    const controller = new AbortController();
    let timedOut = false;
    let cancelled = false;
    const cancel = () => {
      cancelled = true;
      controller.abort();
    };
    if (signal?.aborted) return failure(WALKING_ERROR.CANCELLED);
    signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, config.requestTimeoutMs);

    try {
      const response = await fetcher(url.toString(), {
        method: 'GET',
        headers: { Accept: 'application/geo+json, application/json' },
        signal: controller.signal,
      });
      if (!response?.ok) return statusFailure(Number(response?.status));
      let payload;
      try {
        payload = await response.json();
      } catch {
        return failure(WALKING_ERROR.INVALID_RESPONSE);
      }
      const result = normalizeGeoapifyResponse(payload, {
        from,
        to,
        calculatedAt: new Date(timestampMs).toISOString(),
      });
      if (result.ok) writeCache(key, result, timestampMs);
      return result;
    } catch {
      if (timedOut) return failure(WALKING_ERROR.TIMEOUT);
      if (cancelled || signal?.aborted) return failure(WALKING_ERROR.CANCELLED);
      return failure(WALKING_ERROR.NETWORK);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    }
  }

  return Object.freeze({ routeWalk });
}

module.exports = {
  WALKING_ERROR,
  createWalkingRouter,
  normalizeGeoapifyResponse,
  normalizePoint,
};
