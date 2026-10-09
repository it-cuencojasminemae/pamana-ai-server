'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTrafficProvider, validTrafficTile } = require('../src/services/pamana-journey/traffic-tiles');
const { createTrafficHandlers } = require('../src/api/pamana-ai/controllers/traffic');
const { resetRateLimits } = require('../src/services/security/request-guard');
const routes = require('../src/api/pamana-ai/routes/pamana-ai').routes;
const tile = [14, Math.floor((120.70 + 180) / 360 * 2 ** 14),
  Math.floor((1 - Math.asinh(Math.tan(15.12 * Math.PI / 180)) / Math.PI) / 2 * 2 ** 14)];
const bytes = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
const png = { ok: true, headers: new Headers({ 'content-type': 'image/png' }), arrayBuffer: async () => bytes };
const ctxFor = (role = 'Passenger') => ({ state: { user: role ? { id: 11, role: { name: role } } : null },
  params: { z: tile[0], x: tile[1], y: tile[2] }, headers: {}, set(name, value) { this.headers[name] = value },
  unauthorized() { this.status = 401 }, forbidden() { this.status = 403 } });

test('traffic tiles validate integers, bounds, zoom and Pampanga coverage', () => {
  assert.equal(validTrafficTile(...tile), true)
  for (const params of [[9,0,0],[19,0,0],[14,0,0],[14,2**14,0],['14','001',0],[14,-1,0],[14,'../../key',0]])
    assert.equal(validTrafficTile(...params), false)
});

test('TomTom key remains server-side and response PNGs are bounded and validated', async () => {
  let requested
  const provider = createTrafficProvider({ apiKey: () => 'fixture-secret', fetcher: async (url, options) => {
    requested = new URL(url); assert.ok(options.signal); assert.equal(options.redirect, 'error'); return png
  } })
  assert.equal(provider.configured(), true)
  assert.deepEqual(await provider.tile(...tile), bytes)
  assert.equal(requested.origin, 'https://api.tomtom.com')
  assert.match(requested.pathname, /\/flow\/relative0\//)
  assert.equal(requested.searchParams.get('key'), 'fixture-secret')
  const ctx = ctxFor(); createTrafficHandlers(provider).find(ctx)
  assert.equal(ctx.body.configured, true); assert.doesNotMatch(JSON.stringify(ctx.body), /fixture-secret|key=/)
});

test('missing key, provider errors and non-PNG bodies remain unavailable', async () => {
  const disabled = createTrafficProvider({ apiKey: () => '' }); assert.equal(disabled.configured(), false)
  assert.equal(await disabled.tile(...tile), null)
  for (const fetcher of [async () => { throw new Error('secret-key') }, async () => ({ ok: false, status: 403 }),
    async () => ({ ...png, headers: new Headers({ 'content-type': 'text/html' }) }),
    async () => ({ ...png, arrayBuffer: async () => Buffer.from('not-png-response') })]) {
    const provider = createTrafficProvider({ apiKey: () => 'fixture-secret', fetcher })
    assert.equal(await provider.tile(...tile), null)
  }
  const ctx = ctxFor(); await createTrafficHandlers({ configured: () => true, tile: async () => null }).tile(ctx)
  assert.equal(ctx.status, 503); assert.deepEqual(ctx.body, { status: 'TRAFFIC_UNAVAILABLE' })
});

test('concurrent requests coalesce without caching old live flow tiles', async () => {
  let calls = 0, release
  const provider = createTrafficProvider({ apiKey: () => 'fixture-secret', fetcher: async () => {
    calls++; await new Promise(resolve => { release = resolve }); return png
  } })
  const first = provider.tile(...tile), second = provider.tile(...tile)
  assert.equal(calls, 1); release(); await Promise.all([first, second])
  const fresh = provider.tile(...tile); assert.equal(calls, 2); release(); await fresh
});

test('traffic proxy retains authentication, existing map scope, role restrictions and no-store', async () => {
  const handlers = createTrafficHandlers({ configured: () => true, tile: async () => bytes })
  for (const role of [null, 'Driver', 'Authenticated']) {
    const ctx = ctxFor(role); await handlers.tile(ctx); assert.equal(ctx.status, role ? 403 : 401)
  }
  resetRateLimits()
  const ctx = ctxFor(); await handlers.tile(ctx)
  assert.equal(ctx.type, 'image/png'); assert.equal(ctx.headers['Cache-Control'], 'no-store')
  for (const route of routes.filter(route => route.handler.startsWith('traffic.')))
    assert.deepEqual(route.config.auth.scope, ['api::pamana-ai.pin-area.find'])
});
