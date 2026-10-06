'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const configure = require('../config/plugins');
function envFor(values = {}) {
  const env = (key, fallback) => values[key] ?? fallback;
  env.bool = (key, fallback) => values[key] === undefined ? fallback : values[key] === 'true';
  env.array = (key, fallback) => values[key] === undefined ? fallback : values[key].split(',');
  return env;
}
const sessions = values => configure({ env: envFor(values) })['users-permissions'].config.sessions;
test('local HTTP and production HTTPS session defaults remain secure and explicit', () => {
  assert.deepEqual(sessions(), { httpOnly: true, cookie: { sameSite: 'lax', secure: false, path: '/' } });
  assert.equal(sessions({ NODE_ENV: 'production' }).cookie.secure, true);
  assert.equal(sessions({ NODE_ENV: 'production' }).cookie.sameSite, 'lax');
});
test('configured cross-site cookies use HTTPS, HttpOnly and identical login/refresh/logout options', () => {
  const config = sessions({ NODE_ENV: 'production', SESSION_COOKIE_SAME_SITE: 'none', SESSION_COOKIE_SECURE: 'true' });
  const { buildRefreshCookieOptions } = require('../node_modules/@strapi/plugin-users-permissions/dist/server/utils/refresh-cookie-options.js').__require();
  const options = buildRefreshCookieOptions(config, true);
  assert.equal(options.sameSite, 'none'); assert.equal(options.secure, true);
  assert.equal(options.httpOnly, true); assert.equal(options.path, '/');
  assert.throws(() => sessions({ SESSION_COOKIE_SAME_SITE: 'none', SESSION_COOKIE_SECURE: 'false' }), /require/);
  assert.throws(() => sessions({ SESSION_COOKIE_SAME_SITE: 'invalid' }), /must be/);
});
test('credentialed CORS takes exact environment origins', () => {
  const cors = require('../config/middlewares')({ env: envFor({ CORS_ORIGINS: 'https://frontend.example.test' }) }).find(m => m.name === 'strapi::cors');
  assert.deepEqual(cors.config.origin, ['https://frontend.example.test']);
  assert.equal(cors.config.credentials, true);
  assert.throws(() => require('../config/middlewares')({ env: envFor({ CORS_ORIGINS: '*' }) }), /wildcard/);
});

test('production middleware preserves the complete generic policy for Strapi Cloud', () => {
  const options = { env: envFor({ CORS_ORIGINS: 'https://frontend.example.test' }) };
  assert.deepEqual(require('../config/env/production/middlewares')(options), require('../config/middlewares')(options));
  const names = require('../config/env/production/middlewares')(options).map(m => typeof m === 'string' ? m : m.name);
  assert.equal(names.length, 10); assert.equal(new Set(names).size, 10);
});
