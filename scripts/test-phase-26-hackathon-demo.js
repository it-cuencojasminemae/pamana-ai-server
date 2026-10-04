'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { check, reachable, configurationStatus } = require('./check-hackathon-demo');
const { rehearse } = require('./rehearse-hackathon-demo');
const manifest = require('./data/pilot-mexico-san-fernando-field-verified.json');
const fixture = require('./fixtures/phase10-synthetic-network');
const { fareRule } = require('./fixtures/phase12-synthetic-information');
const { summarizeRecord } = require('../src/services/transport-data/workbench');

test('workbench summary accepts stored numeric stop sequences without changing the record', () => {
  const record = { sequence: 1, route_variant: 'test-variant', transport_node: 'test-node' };
  const before = JSON.stringify(record);
  assert.deepEqual(summarizeRecord('route-variant-stops', record).workbench.missingCriticalFields, []);
  for (const sequence of [null, '', 0, -1, 1.5]) {
    assert.ok(summarizeRecord('route-variant-stops', { ...record, sequence }).workbench.missingCriticalFields.includes('sequence'));
  }
  assert.equal(JSON.stringify(record), before);
});

test('startup configuration reports selected provider and gates without exposing keys or making requests', () => {
  const backend = { AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'synthetic-private-secret', OPENAI_API_KEY: 'unused-private-secret',
    GEMINI_MODEL: 'private-model-setting', GEOAPIFY_SERVER_API_KEY: 'geo-private-secret', PAMANA_DEMO_MODE_ENABLED: 'false' };
  const frontend = { NUXT_PUBLIC_GEOAPIFY_API_KEY: 'geo-browser-secret', NUXT_PUBLIC_PAMANA_DEMO_MODE_ENABLED: 'true' };
  const status = configurationStatus(backend, frontend);
  assert.equal(status.ai, 'GEMINI CONFIGURED'); assert.equal(status.aiModel, 'EXPLICIT_MODEL');
  assert.equal(status.demoBackend, 'DISABLED'); assert.equal(status.demoFrontend, 'ENABLED');
  assert.equal(status.providerNetworkTested, false);
  assert.doesNotMatch(JSON.stringify(status), /secret|private-model/);
  assert.equal(configurationStatus({ ...backend, AI_PROVIDER: 'openai' }, frontend).ai, 'OPENAI CONFIGURED');
  assert.equal(configurationStatus({ AI_PROVIDER: 'other' }, {}).aiModel, 'INVALID_PROVIDER');
  assert.equal(configurationStatus({}, {}).ai, 'NOT_CONFIGURED');
});

test('reachability handles health 204, failure and timeout with bounded sanitized local checks', async () => {
  assert.equal(await reachable('http://localhost/_health', async (_, options) => {
    assert.ok(options.signal); assert.equal(options.redirect, 'manual'); return { status: 204 };
  }), 'REACHABLE');
  assert.equal(await reachable('http://localhost/_health', async () => ({ status: 503 })), 'UNAVAILABLE');
  assert.equal(await reachable('http://localhost/_health', async () => { throw Error('private-secret'); }), 'UNAVAILABLE');
});

test('startup failure does not leak connection credentials or check paid provider endpoints', async () => {
  const urls = [];
  const status = await check({ backend: {}, frontend: {}, connection: async () => { throw Error('database-private-secret'); },
    fetcher: async url => { urls.push(url); return { status: 200 }; } });
  assert.equal(status.status, 'ACTION_REQUIRED'); assert.equal(status.postgresql, 'UNAVAILABLE');
  assert.equal(status.fullDemoConfigurationReady, false); assert.equal(status.simulationReady, false);
  assert.deepEqual(urls, ['http://127.0.0.1:1337/_health', 'http://localhost:3000/login']);
  assert.doesNotMatch(JSON.stringify(status), /database-private-secret/);
});

test('repeatable manifest-contract rehearsal validates direct/transfer/inbound, fares, unknown ETA, targeting and reset', async () => {
  // In-memory unit fixture, never inserted in Strapi. Uses the existing manifest contract.
  const nodes = manifest.nodes.map(value => fixture.node(value.node_code, { ...value, name: `Test ${value.node_code}` }));
  const routes = manifest.routes.map(value => fixture.route(value.route_code, value.transport_mode));
  const variants = manifest.variants.map(value => fixture.variant(value.variant_code, value.direction,
    routes.find(route => route.route_code === value.route_code), manifest.stops.filter(stop => stop.variant_code === value.variant_code)
      .map(value => fixture.stop(value.variant_code, nodes.find(node => node.node_code === value.node_code), value.sequence, value)),
    { signboard_text: value.signboard_text, geometry: null }));
  const fareRules = manifest.fare_rules.map(value => fareRule(value.key, { regularFare: value.regular_base_fare,
    variantRecord: variants.find(variant => variant.variant_code === value.variant_code) }));
  const facts = { nodes, variants, fareRules }, before = JSON.stringify(facts);
  const first = await rehearse(facts, '2026-10-02T00:00:00Z');
  assert.deepEqual(await rehearse(facts, '2026-10-02T00:00:00Z'), first);
  assert.equal(first.externalProviderRequests, 0); assert.equal(first.persistentWrites, 0);
  assert.equal(JSON.stringify(facts), before);
});

test('report/controller and demo scripts cannot promote simulation into official transport truth', () => {
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const controller = read('src/api/passenger-report/controllers/passenger-report.js');
  assert.match(controller, /review_status: 'PENDING'/); assert.match(controller, /passenger: passengerProfile/);
  assert.doesNotMatch(controller, /documents\('api::(?:disruption|transport-node|route-variant|vehicle)\.[^']+'\)\.(?:create|update)/);
  for (const file of ['scripts/check-hackathon-demo.js', 'scripts/rehearse-hackathon-demo.js']) {
    const code = read(file); assert.match(code, /begin read only/); assert.match(code, /rollback/);
    assert.doesNotMatch(code, /client\.query\(['"`](?:insert|update|delete|alter|create)|activate\(|seed\(/i);
  }
  assert.match(read('src/services/pamana-journey/trip-plan-orchestrator.js'), /allowSimulated: false/);
});

test('mocked Passenger submit/My Reports writes evidence only and scopes results to the current Passenger', async () => {
  const writes = [], reads = [];
  const profile = { id: 910026, documentId: 'test-only-passenger' };
  const strapi = {
    documents: uid => {
      reads.push(uid);
      if (uid === 'api::passenger-profile.passenger-profile') return { findFirst: async () => profile };
      assert.equal(uid, 'api::passenger-report.passenger-report');
      return { findFirst: async () => null, create: async options => {
        writes.push({ uid, ...options }); return { documentId: 'test-only-report', ...options.data };
      } };
    },
    service: uid => ({ find: async query => {
      assert.equal(uid, 'api::passenger-report.passenger-report');
      assert.deepEqual(JSON.parse(JSON.stringify(query.filters)), { $and: [{ review_status: 'PENDING' }, { passenger: { id: profile.id } }] });
      return { results: [{ documentId: 'test-only-report', report_type: 'OTHER', passenger: profile, latitude: 14, longitude: 119 }], pagination: { total: 1 } };
    } }),
  };
  const sandbox = { module: { exports: {} }, require: name => name === '@strapi/strapi'
    ? { factories: { createCoreController: (_, factory) => factory({ strapi }) } }
    : require(path.resolve(__dirname, '../src/api/passenger-report/controllers', name)) };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/api/passenger-report/controllers/passenger-report.js'), 'utf8'), sandbox);
  const controller = sandbox.module.exports;
  Object.assign(controller, { sanitizeOutput: async value => value, transformResponse: data => ({ data }),
    validateQuery: async () => {}, sanitizeQuery: async () => ({ filters: { review_status: 'PENDING' } }) });
  const ctx = { state: { user: { id: profile.id, role: { name: 'Passenger' } } }, request: { body: { data: {
    report_type: 'OTHER', description: 'Mocked test report; no operational observation asserted.', context_source: 'NONE',
  } } }, badRequest: message => assert.fail(message), unauthorized: () => assert.fail('unexpected unauthorized'), forbidden: () => assert.fail('unexpected forbidden'),
    set() {}, query: {} };
  const result = await controller.create(ctx);
  assert.equal(ctx.status, 201); assert.equal(writes.length, 1); assert.equal(writes[0].uid, 'api::passenger-report.passenger-report');
  assert.equal(writes[0].data.review_status, 'PENDING'); assert.equal(writes[0].data.passenger, profile.documentId);
  assert.equal(writes[0].data.planning_enabled, undefined); assert.equal(result.data.passenger, undefined);
  const own = await controller.find(ctx);
  assert.equal(own.data.length, 1); assert.equal(own.data[0].latitude, undefined); assert.equal(own.data[0].passenger, undefined);
  assert.ok(reads.every(uid => /passenger-(?:profile|report)/.test(uid)));
});
