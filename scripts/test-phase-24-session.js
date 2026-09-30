'use strict';
const assert = require('node:assert/strict');
const extend = require('../src/extensions/users-permissions/strapi-server');
const { ROLE_PERMISSION_MATRIX, permissionIsManaged } = require('../src/services/security/access-control');

(async () => {
  for (const factory of [false, true]) {
    const controller = { login() {}, async register(ctx) { ctx.body = { jwt: 'synthetic-access', refreshToken: 'synthetic-refresh', user: { id: 1 } }; } };
    const plugin = extend({ controllers: { auth: factory ? () => controller : controller } });
    const auth = factory ? plugin.controllers.auth({}) : plugin.controllers.auth;
    const cookies = [];
    global.strapi = { config: { get: key => key.endsWith('jwtManagement') ? 'refresh' : { httpOnly: true, cookie: { name: 'synthetic-cookie', secure: true, sameSite: 'strict', path: '/api', maxAge: 1000 } } } };
    const ctx = { cookies: { set: (...args) => cookies.push(args) } };
    await auth.register(ctx);
    assert.equal(ctx.body.refreshToken, undefined);
    assert.equal(ctx.body.jwt, 'synthetic-access'); assert.equal(ctx.body.user.id, 1);
    assert.equal(cookies[0][0], 'synthetic-cookie');
    assert.deepEqual(cookies[0][2], { httpOnly: true, secure: true, sameSite: 'strict', path: '/api', domain: undefined, maxAge: 1000, overwrite: true });
    assert.equal(auth.login, controller.login);
    const failure = extend({ controllers: { auth: { register: async () => { throw new Error('synthetic failure') } } } });
    await assert.rejects(failure.controllers.auth.register(ctx));
    global.strapi.config.get = key => key.endsWith('jwtManagement') ? 'legacy-support' : { httpOnly: true };
    const legacy = { cookies: { set: () => assert.fail('legacy registration must be unchanged') } };
    await auth.register(legacy); assert.equal(legacy.body.refreshToken, 'synthetic-refresh');
  }
  const action = 'plugin::users-permissions.auth.logout';
  assert.equal(permissionIsManaged(action), true);
  for (const role of ['Passenger', 'Driver', 'LGU', 'Administrator']) assert.ok(ROLE_PERMISSION_MATRIX[role].includes(action));
  for (const role of ['Public', 'Authenticated']) assert.ok(!ROLE_PERMISSION_MATRIX[role]?.includes(action));
  delete global.strapi;
  console.log('ok - registration honors configured HttpOnly cookie, redacts refresh JSON and preserves legacy/failure behavior');
  console.log('ok - only the four PAMANA roles can revoke their authenticated sessions');
})().catch(error => { console.error(`FAIL: ${error.message}`); process.exitCode = 1; });
