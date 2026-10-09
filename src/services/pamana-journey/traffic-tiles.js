'use strict';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const TRAFFIC_BOUNDS = Object.freeze([120.3, 14.7, 121.1, 15.5]);
function validTrafficTile(z, x, y) {
  if (![z, x, y].every(value => /^(0|[1-9]\d*)$/.test(String(value)))) return false;
  const zoom = Number(z), col = Number(x), row = Number(y), size = 2 ** zoom;
  if (zoom < 10 || zoom > 18 || col >= size || row >= size) return false;
  const longitude = col / size * 360 - 180;
  const latitude = index => Math.atan(Math.sinh(Math.PI * (1 - 2 * index / size))) * 180 / Math.PI;
  return longitude <= TRAFFIC_BOUNDS[2] && longitude + 360 / size >= TRAFFIC_BOUNDS[0]
    && latitude(row) >= TRAFFIC_BOUNDS[1] && latitude(row + 1) <= TRAFFIC_BOUNDS[3];
}

function createTrafficProvider({ fetcher = fetch, apiKey = () => process.env.TOMTOM_API_KEY,
  enabled = () => process.env.PAMANA_TRAFFIC_ENABLED !== 'false' } = {}) {
  const pending = new Map();
  const configured = () => enabled() && typeof apiKey() === 'string' && !!apiKey().trim();
  async function tile(z, x, y) {
    if (!configured() || !validTrafficTile(z, x, y)) return null;
    const identity = `${z}/${x}/${y}`;
    let request = pending.get(identity);
    if (!request) {
      request = (async () => {
        try {
          const url = new URL(`https://api.tomtom.com/traffic/map/4/tile/flow/relative0/${identity}.png`);
          url.searchParams.set('key', apiKey().trim()); url.searchParams.set('tileSize', '256');
          const response = await fetcher(url, { signal: AbortSignal.timeout(7000), redirect: 'error', headers: { Accept: 'image/png' } });
          if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('image/png')) return null;
          const buffer = Buffer.from(await response.arrayBuffer());
          if (buffer.length < 8 || buffer.length > 1024 * 1024 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
          return buffer;
        } catch { return null; }
      })();
      pending.set(identity, request);
    }
    // Coalesce simultaneous tiles only; TomTom specifies no-store for flow.
    try { return await request; } finally { if (pending.get(identity) === request) pending.delete(identity); }
  }
  return { configured, tile };
}

module.exports = { createTrafficProvider, validTrafficTile, TRAFFIC_BOUNDS };
