'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  ROLE, ROLE_PERMISSION_MATRIX, enforceRole, permissionIsManaged, reconcileRolePermissions,
} = require('../src/services/security/access-control');
const {
  consumeRateLimit, resetRateLimits, validateDataEnvelope,
} = require('../src/services/security/request-guard');
const {
  MAX_EXPLANATION_REQUEST_BYTES, sanitizeJourneyExplanationRequest,
} = require('../src/services/pamana-ai/journey-explanation');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const role = (name) => ({ id: name, role: { name } });

function context(user) {
  return {
    state: user ? { user } : {}, request: { ip: '127.0.0.1' },
    unauthorized(message) { this.status = 401; this.body = message; },
    forbidden(message) { this.status = 403; this.body = message; },
    set(name, value) { this.headers = { ...(this.headers || {}), [name]: value }; },
  };
}

{
  assert.equal(enforceRole(context(role(ROLE.PASSENGER)), [ROLE.PASSENGER]), true);
  const crossRole = context(role(ROLE.DRIVER));
  assert.equal(enforceRole(crossRole, [ROLE.PASSENGER]), false);
  assert.equal(crossRole.status, 403);
  const anonymous = context();
  assert.equal(enforceRole(anonymous, [ROLE.PASSENGER]), false);
  assert.equal(anonymous.status, 401);

  const passenger = new Set(ROLE_PERMISSION_MATRIX.Passenger);
  const driver = new Set(ROLE_PERMISSION_MATRIX.Driver);
  const lgu = new Set(ROLE_PERMISSION_MATRIX.LGU);
  const admin = new Set(ROLE_PERMISSION_MATRIX.Administrator);
  assert.ok(passenger.has('api::pamana-ai.trip-plan.create'));
  assert.ok(passenger.has('api::pamana-ai.journey-explanation.create'));
  assert.ok(!passenger.has('api::transport-workbench.transport-workbench.list'));
  assert.ok(!passenger.has('api::vehicle-location.vehicle-location.create'));
  assert.ok(driver.has('api::vehicle-location.vehicle-location.create'));
  assert.ok(!driver.has('api::disruption.disruption.update'));
  assert.ok(lgu.has('api::transport-workbench.transport-workbench.update'));
  assert.ok(!lgu.has('api::route.route.update'));
  assert.ok(admin.has('api::route.route.update'));
  assert.ok(permissionIsManaged('api::pamana-demo.pamana-demo.liveVehicles'));
  console.log('ok - role matrix and controller guard reject anonymous and cross-role access');
}

async function reconciliationTest() {
  const roles = [
    { id: 1, name: 'Public' }, { id: 2, name: 'Authenticated' },
    { id: 3, name: 'Passenger' }, { id: 4, name: 'Driver' },
    { id: 5, name: 'LGU' }, { id: 6, name: 'Administrator' },
  ];
  const permissions = [
    { id: 1, action: 'api::transport-workbench.transport-workbench.list', roleId: 1 },
    { id: 2, action: 'api::vehicle-location.vehicle-location.create', roleId: 3 },
    { id: 3, action: 'plugin::users-permissions.auth.callback', roleId: 1 },
  ];
  let nextId = 10;
  const permissionQuery = {
    async findMany({ where }) { return permissions.filter((item) => item.roleId === where.role.id); },
    async delete({ where }) { const index = permissions.findIndex((item) => item.id === where.id); permissions.splice(index, 1); },
    async create({ data }) { permissions.push({ id: nextId++, action: data.action, roleId: data.role }); },
  };
  await reconcileRolePermissions({ db: { query(uid) {
    return uid.endsWith('.role') ? { findMany: async () => roles } : permissionQuery;
  } } });
  assert.ok(!permissions.some((item) => item.roleId === 1 && permissionIsManaged(item.action)));
  assert.ok(permissions.some((item) => item.roleId === 1 && item.action === 'plugin::users-permissions.auth.callback'));
  assert.ok(!permissions.some((item) => item.roleId === 3 && item.action === 'api::vehicle-location.vehicle-location.create'));
  for (const expected of ROLE_PERMISSION_MATRIX.Passenger) {
    assert.ok(permissions.some((item) => item.roleId === 3 && item.action === expected));
  }
  console.log('ok - bootstrap reconciliation removes stale sensitive grants and preserves unrelated auth permissions');
}

{
  assert.equal(validateDataEnvelope({ data: { latitude: 15, longitude: 120 } }, {
    allowedFields: ['latitude', 'longitude'], maxBytes: 1000,
  }).ok, true);
  assert.equal(validateDataEnvelope({ data: { latitude: 15, admin: true } }, {
    allowedFields: ['latitude'], maxBytes: 1000,
  }).ok, false);
  assert.equal(validateDataEnvelope({ data: { note: 'x'.repeat(2000) } }, {
    allowedFields: ['note'], maxBytes: 100,
  }).ok, false);
  resetRateLimits();
  const limited = context(role(ROLE.PASSENGER));
  assert.equal(consumeRateLimit(limited, 'test', { limit: 2, windowMs: 1000, now: 0 }), true);
  assert.equal(consumeRateLimit(limited, 'test', { limit: 2, windowMs: 1000, now: 1 }), true);
  assert.equal(consumeRateLimit(limited, 'test', { limit: 2, windowMs: 1000, now: 2 }), false);
  assert.equal(limited.status, 429);
  console.log('ok - request envelopes and bounded per-user rate limits fail safely');
}

{
  const base = {
    originLabel: 'Origin', destinationLabel: 'Destination',
    journey: { transferCount: 0, modes: ['WALK'], legs: [{ sequence: 1, type: 'WALK', from: { label: 'A' }, to: { label: 'B' } }], warnings: [] },
  };
  assert.equal(sanitizeJourneyExplanationRequest(base).ok, true);
  assert.equal(sanitizeJourneyExplanationRequest({ ...base, apiKey: 'forbidden' }).ok, false);
  assert.equal(sanitizeJourneyExplanationRequest({ ...base, journey: { ...base.journey, internalId: 'forbidden' } }).ok, false);
  assert.equal(sanitizeJourneyExplanationRequest({ ...base, originLabel: 'x'.repeat(MAX_EXPLANATION_REQUEST_BYTES) }).ok, false);
  console.log('ok - AI explanation accepts only the bounded factual display contract');
}

{
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString('utf8').split('\0').filter(Boolean);
  assert.ok(!tracked.some((file) => /(^|\/)\.env$/i.test(file)), 'a local .env is tracked');
  const textFiles = tracked.filter((file) => {
    try { return fs.statSync(path.join(root, file)).size < 2_000_000; } catch { return false; }
  });
  const forbiddenSecretPatterns = [
    /\bsk-[A-Za-z0-9_-]{24,}\b/g,
    /\bAIza[A-Za-z0-9_-]{30,}\b/g,
    /postgres(?:ql)?:\/\/[^\s:@]+:[^\s@]+@/gi,
  ];
  for (const file of textFiles) {
    const content = read(file);
    for (const pattern of forbiddenSecretPatterns) {
      pattern.lastIndex = 0;
      assert.equal(pattern.test(content), false, `possible secret in tracked file ${file}`);
    }
  }
  const providers = `${read('src/services/pamana-ai/providers/openai-client.js')}\n${read('src/services/pamana-ai/providers/gemini-client.js')}`;
  assert.doesNotMatch(providers, /provider failed:\s*\$\{error\.message\}/);
  assert.doesNotMatch(read('config/middlewares.js'), /origin:\s*['"]\*['"]/);
  assert.match(read('config/middlewares.js'), /jsonLimit:\s*'256kb'/);
  console.log('ok - tracked source excludes credential formats and provider logs remain sanitized');
}

{
  const controllers = [
    'src/api/pamana-ai/controllers/trip-plan.js',
    'src/api/pamana-ai/controllers/journey-explanation.js',
    'src/api/passenger-report/controllers/passenger-report.js',
    'src/api/vehicle-location/controllers/vehicle-location.js',
    'src/api/transport-workbench/controllers/transport-workbench.js',
  ].map(read).join('\n');
  assert.match(controllers, /enforceRole|authenticatedWorkbenchUser/);
  assert.match(controllers, /consumeRateLimit/);
  assert.ok(fs.existsSync(path.join(root, 'documentation/phase-22-security-permissions-privacy.md')));
  console.log('ok - sensitive controller boundaries, privacy documentation and cost controls are present');
}

reconciliationTest().catch((error) => { console.error(`FAIL: ${error.message}`); process.exitCode = 1; });
