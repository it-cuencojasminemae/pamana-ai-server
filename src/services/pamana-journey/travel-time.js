'use strict';

const { roadLine, offsetOnLine, segmentLength } = require('./route-distance');
const { mapWithConcurrency } = require('./access-node-finder');
const { withProviderSlot } = require('./provider-budget');

const EXCLUSIONS = Object.freeze(['WAITING', 'BOARDING', 'TRANSFER_DELAYS', 'UNSCHEDULED_STOPS', 'LIVE_TRAFFIC']);
const validMetric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const validPosition = p => Array.isArray(p) && p.length >= 2 && p.slice(0, 2).every(Number.isFinite)
  && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;

function clipCorridor(leg) {
  if (leg.type !== 'TRANSIT') return null;
  // The server's eligible planner supplies this geometry; client geometry is never accepted.
  const line = roadLine({ geometry_source: 'MANUAL_VERIFIED', geometry_geojson: leg.geometry });
  if (!line) return null;
  const start = offsetOnLine(line, leg.boardAt), end = offsetOnLine(line, leg.alightAt);
  if (start === null || end === null || end <= start) return null;
  const clipped = [];
  let offset = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], length = segmentLength(a, b);
    if (length > 0 && offset + length > start && offset < end) {
      const interpolate = distance => {
        const t = Math.max(0, Math.min(1, (distance - offset) / length));
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      };
      const from = interpolate(Math.max(start, offset)), to = interpolate(Math.min(end, offset + length));
      if (!clipped.length) clipped.push(from);
      clipped.push(to);
    }
    offset += length;
  }
  return clipped.length >= 2 ? clipped : null;
}

function samples(line, spacing = 25) {
  const points = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], count = Math.max(1, Math.ceil(segmentLength(a, b) / spacing));
    if (points.length + count > 5000) return null;
    for (let j = 1; j <= count; j++) points.push([a[0] + (b[0] - a[0]) * j / count, a[1] + (b[1] - a[1]) * j / count]);
  }
  return points;
}

function distanceToLine(point, line) {
  const scale = Math.cos(point[1] * Math.PI / 180);
  let nearest = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const dx = (b[0] - a[0]) * scale, dy = b[1] - a[1], square = dx * dx + dy * dy;
    const t = square ? Math.max(0, Math.min(1, (((point[0] - a[0]) * scale) * dx + (point[1] - a[1]) * dy) / square)) : 0;
    nearest = Math.min(nearest, segmentLength(point, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]));
  }
  return nearest;
}

function corridorMatches(expected, actual) {
  if (!Array.isArray(actual) || actual.length < 2 || actual.length > 10000 || !actual.every(validPosition)) return false;
  if (segmentLength(expected[0], actual[0]) > 50 || segmentLength(expected.at(-1), actual.at(-1)) > 50) return false;
  const first = samples(expected), second = samples(actual);
  if (!first || !second) return false;
  // Both directions catch shortcuts as well as detours; 50 m allows road centerline differences.
  return first.every(p => distanceToLine(p, actual) <= 50) && second.every(p => distanceToLine(p, expected) <= 50);
}

function routeWaypoints(corridor) {
  if (corridor.length <= 20) return corridor;
  return Array.from({ length: 20 }, (_, i) => corridor[Math.round(i * (corridor.length - 1) / 19)]);
}

function connectedProviderLine(geometry) {
  const parts = geometry?.type === 'LineString' ? [geometry.coordinates]
    : geometry?.type === 'MultiLineString' ? geometry.coordinates : null;
  if (!Array.isArray(parts) || !parts.length) return null;
  const line = [];
  for (const part of parts) {
    if (!Array.isArray(part) || part.length < 2 || !part.every(validPosition) || line.length + part.length > 10000) return null;
    if (line.length && segmentLength(line.at(-1), part[0]) > 0.1) return null;
    line.push(...(line.length ? part.slice(1) : part));
  }
  return line;
}

function createRoadTimeRouter({ apiKey = process.env.GEOAPIFY_SERVER_API_KEY, fetcher = global.fetch,
  now = () => Date.now(), timeoutMs = 7000, ttlMs = 300000, maxEntries = 100 } = {}) {
  const cache = new Map();
  let active = 0;
  timeoutMs = Math.min(7000, Math.max(1, timeoutMs));
  ttlMs = Math.min(300000, Math.max(1, ttlMs));
  maxEntries = Math.min(100, Math.max(1, maxEntries));

  async function route(corridor, signal) {
    if (signal?.aborted) return { ok: false, reason: 'CANCELLED' };
    if (!apiKey?.trim()) return { ok: false, reason: 'NOT_CONFIGURED' };
    const key = JSON.stringify(corridor);
    const hit = cache.get(key);
    if (hit && now() - hit.storedAt < ttlMs) return structuredClone(hit.value);
    if (hit) cache.delete(key);
    if (active >= 2) return { ok: false, reason: 'PROVIDER_BUSY' };
    active++;
    const controller = new AbortController();
    let timer;
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    const aborted = new Promise(resolve => controller.signal.addEventListener('abort', () =>
      resolve({ ok: false, reason: signal?.aborted ? 'CANCELLED' : 'PROVIDER_TIMEOUT' }), { once: true }));
    timer = setTimeout(cancel, timeoutMs);
    const request = async () => {
      const url = new URL('https://api.geoapify.com/v1/routing');
      url.searchParams.set('apiKey', apiKey.trim());
      url.searchParams.set('mode', 'drive');
      url.searchParams.set('traffic', 'approximated');
      url.searchParams.set('format', 'geojson');
      url.searchParams.set('waypoints', routeWaypoints(corridor).map(p => `${p[1]},${p[0]}`).join('|'));
      const response = await withProviderSlot(() => fetcher(url.toString(), { signal: controller.signal, headers: { Accept: 'application/geo+json' } }), controller.signal);
      if (!response?.ok) return { ok: false, reason: response?.status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_UNAVAILABLE' };
      const payload = await response.json();
      const feature = payload?.type === 'FeatureCollection' ? payload.features?.[0] : null;
      const providerLine = connectedProviderLine(feature?.geometry);
      if (!validMetric(feature?.properties?.time) || !providerLine) return { ok: false, reason: 'INVALID_PROVIDER_RESPONSE' };
      if (!corridorMatches(corridor, providerLine)) return { ok: false, reason: 'CORRIDOR_MISMATCH' };
      return { ok: true, seconds: feature.properties.time, calculatedAt: new Date(now()).toISOString() };
    };
    try {
      const value = await Promise.race([request().catch(() => ({ ok: false, reason: 'PROVIDER_UNAVAILABLE' })), aborted]);
      if (value.ok && !controller.signal.aborted) {
        cache.set(key, { storedAt: now(), value });
        while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
      }
      return value;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); active--; }
  }
  return { route };
}

let defaultRouter, defaultKey;
function getRoadTimeRouter() {
  if (!defaultRouter || defaultKey !== process.env.GEOAPIFY_SERVER_API_KEY) {
    defaultKey = process.env.GEOAPIFY_SERVER_API_KEY;
    defaultRouter = createRoadTimeRouter({ apiKey: defaultKey });
  }
  return defaultRouter;
}

async function estimateJourneyTime(journey, { router = getRoadTimeRouter(), signal, now = () => new Date() } = {}) {
  const walking = journey.legs.filter(leg => leg.type === 'WALK');
  const rides = journey.legs.filter(leg => leg.type === 'TRANSIT');
  const knownWalking = walking.filter(leg => validMetric(leg.durationSeconds));
  const walkingSeconds = knownWalking.length ? knownWalking.reduce((sum, leg) => sum + leg.durationSeconds, 0) : walking.length ? null : 0;
  let rideSeconds = 0, knownRides = 0;
  const reasons = [];
  let oldest = new Date(now()).toISOString();
  const rideResults = await mapWithConcurrency(rides, 2, async leg => {
    if (signal?.aborted) return { ok: false, reason: 'CANCELLED' };
    const corridor = clipCorridor(leg);
    if (!corridor) return { ok: false, reason: 'VERIFIED_CORRIDOR_UNAVAILABLE' };
    try { return await router.route(corridor, signal); }
    catch { return { ok: false, reason: 'PROVIDER_UNAVAILABLE' }; }
  });
  for (const result of rideResults) {
    if (result.ok && validMetric(result.seconds)) {
      rideSeconds += result.seconds; knownRides++;
      if (result.calculatedAt && result.calculatedAt < oldest) oldest = result.calculatedAt;
    } else reasons.push(result.reason || 'PROVIDER_UNAVAILABLE');
  }
  const walkingComplete = knownWalking.length === walking.length;
  const ridesComplete = knownRides === rides.length && rides.length > 0;
  const movingSeconds = walkingComplete && ridesComplete ? walkingSeconds + rideSeconds : null;
  return {
    journeyId: journey.id, status: movingSeconds !== null ? 'COMPLETE' : knownWalking.length || knownRides ? 'PARTIAL' : 'UNAVAILABLE',
    walkingSeconds, rideSeconds: knownRides ? rideSeconds : null, movingSeconds,
    walkingComplete, ridesComplete, knownRideCount: knownRides, rideCount: rides.length,
    calculatedAt: oldest, expiresAt: new Date(new Date(oldest).getTime() + 300000).toISOString(),
    source: 'GEOAPIFY_ROAD_PROXY', exclusions: [...EXCLUSIONS], reasons: [...new Set(reasons)],
  };
}

module.exports = { clipCorridor, corridorMatches, createRoadTimeRouter, estimateJourneyTime };
