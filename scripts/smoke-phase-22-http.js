'use strict';

const assert = require('node:assert/strict');
const { compileStrapi, createStrapi } = require('@strapi/strapi');

const baseUrl = process.env.PAMANA_API_URL || 'http://127.0.0.1:1337';
const roles = ['Passenger', 'Driver', 'LGU', 'Administrator'];

async function request(path, { token, method = 'GET', body } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

(async () => {
  for (const [method, path] of [
    ['POST', '/api/pamana-ai/trip-plan'], ['POST', '/api/pamana-ai/journey-explanation'],
    ['GET', '/api/pamana-demo/live-vehicles'], ['GET', '/api/transport-workbench/routes'],
    ['POST', '/api/passenger-reports'], ['POST', '/api/vehicle-locations'],
    ['POST', '/api/disruptions'],
  ]) {
    const response = await request(path, { method, body: method === 'POST' ? { data: {} } : undefined });
    assert.ok([401, 403].includes(response.status), `${method} ${path} was public (${response.status})`);
  }

  const app = await createStrapi(await compileStrapi()).load();
  const issuedSessions = [];
  try {
    const users = await app.db.query('plugin::users-permissions.user').findMany({
      where: { blocked: false }, populate: ['role'],
    });
    const byRole = Object.fromEntries(users.filter((user) => roles.includes(user.role?.name))
      .map((user) => [user.role.name, user]));
    assert.equal(Object.keys(byRole).length, roles.length, 'one enabled local test user is required for every PAMANA role');
    const sessionManager = app.sessionManager('users-permissions');
    const tokenEntries = [];
    for (const roleName of roles) {
      const userId = String(byRole[roleName].id);
      const refresh = await sessionManager.generateRefreshToken(userId, undefined, {
        type: 'refresh', metadata: { purpose: 'phase-22-http-smoke' },
      });
      const access = await sessionManager.generateAccessToken(refresh.token);
      assert.ok(!('error' in access), `could not issue ${roleName} access token`);
      issuedSessions.push({ userId, sessionId: refresh.sessionId });
      tokenEntries.push([roleName, access.token]);
    }
    const tokens = Object.fromEntries(tokenEntries);

    const cases = [
      ['Passenger', 'POST', '/api/pamana-ai/trip-plan', {}, 400],
      ['Passenger', 'POST', '/api/pamana-ai/journey-explanation', {}, 400],
      ['Passenger', 'GET', '/api/transport-workbench/routes', undefined, 403],
      ['Passenger', 'POST', '/api/vehicle-locations', { data: {} }, 403],
      ['Driver', 'GET', '/api/driver-trip-options', undefined, 200],
      ['Driver', 'POST', '/api/pamana-ai/trip-plan', {}, 403],
      ['Driver', 'GET', '/api/transport-workbench/routes', undefined, 403],
      ['LGU', 'GET', '/api/transport-workbench/routes', undefined, 200],
      ['LGU', 'GET', '/api/disruption-target-options', undefined, 200],
      ['LGU', 'POST', '/api/passenger-reports', { data: {} }, 403],
      ['Administrator', 'GET', '/api/transport-workbench/routes', undefined, 200],
      ['Administrator', 'POST', '/api/pamana-ai/journey-explanation', {}, 400],
      ['Administrator', 'POST', '/api/vehicle-locations', { data: {} }, 403],
    ];
    for (const [roleName, method, path, body, expected] of cases) {
      const response = await request(path, { token: tokens[roleName], method, body });
      assert.equal(response.status, expected, `${roleName} ${method} ${path} returned ${response.status}`);
    }
    console.log('ok - direct HTTP checks enforce anonymous, Passenger, Driver, LGU and Administrator boundaries');
  } finally {
    const sessionManager = app.sessionManager('users-permissions');
    for (const session of issuedSessions) {
      await sessionManager.revokeSessionById(session.userId, session.sessionId);
    }
    await app.destroy();
  }
})().catch((error) => { console.error(`FAIL: ${error.message}`); process.exitCode = 1; });
