'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { compileStrapi, createStrapi } = require('@strapi/strapi');
const { connect } = require('./seed-phase5b-transfer-research');
const { digest } = require('./activate-pilot-field-verified');
const base = process.env.PAMANA_API_URL || 'http://127.0.0.1:1337';
const marker = `phase24-${crypto.randomBytes(10).toString('hex')}`;
const credentials = { username: marker, email: `${marker}@example.test`, password: crypto.randomBytes(32).toString('base64url') };
const expected = '3d63fcdb5d9581d71e2c68d54db9c00868510dcc9b91e6e38fcb893373af9139';

async function request(endpoint, { method = 'GET', body, token, cookie } = {}) {
  const response = await fetch(`${base}${endpoint}`, { method, signal: AbortSignal.timeout(15000),
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json(), cookies: response.headers.getSetCookie() };
}
const cookieHeader = response => response.cookies.map(cookie => cookie.split(';')[0]).join('; ');

(async () => {
  const audit = await connect(); let app, fixtureId, reportId, reportDocumentId;
  const sessions = [], defects = [];
  try {
    assert.equal(await digest(audit), expected);
    app = await createStrapi(await compileStrapi()).load();
    const registration = await request('/api/auth/local/register', { method: 'POST', body: credentials });
    assert.equal(registration.status, 200, 'registration succeeds'); fixtureId = registration.body.user.id;
    if (registration.body.refreshToken || !registration.cookies.some(cookie => /HttpOnly/i.test(cookie))) defects.push('registration does not use the configured HttpOnly refresh cookie');
    const profile = await request('/api/passenger-profiles', { method: 'POST', token: registration.body.jwt,
      body: { data: { first_name: 'Regression', last_name: 'Fixture' } } });
    assert.equal(profile.status, 201, 'passenger profile is assigned server-side');
    const report = await request('/api/passenger-reports', { method: 'POST', token: registration.body.jwt,
      body: { data: { report_type: 'LONG_WAIT', description: `Disposable acceptance observation ${marker}.`, context_source: 'NONE' } } });
    assert.equal(report.status, 201); reportId = report.body.data.id; reportDocumentId = report.body.data.documentId;
    assert.equal(report.body.data.review_status, 'PENDING'); assert.equal(report.body.data.passenger, undefined);
    const ownReports = await request('/api/passenger-reports', { token: registration.body.jwt });
    assert.equal(ownReports.status, 200); assert.equal(ownReports.body.data.length, 1);
    assert.equal(ownReports.body.data[0].latitude, undefined);
    const wrong = await request('/api/auth/local', { method: 'POST', body: { identifier: credentials.email, password: 'synthetic-wrong-password' } });
    assert.equal(wrong.status, 400);
    const login = await request('/api/auth/local', { method: 'POST', body: { identifier: credentials.email, password: credentials.password } });
    assert.equal(login.status, 200); assert.equal(login.body.refreshToken, undefined);
    assert.ok(login.cookies.some(cookie => /HttpOnly/i.test(cookie)));
    const restored = await request('/api/users/me?populate=role', { token: login.body.jwt });
    assert.equal(restored.status, 200); assert.equal(restored.body.role.name, 'Passenger');
    const refreshed = await request('/api/auth/refresh', { method: 'POST', cookie: cookieHeader(login) });
    assert.equal(refreshed.status, 200); assert.equal(refreshed.body.refreshToken, undefined);
    const logout = await request('/api/auth/logout', { method: 'POST', token: refreshed.body.jwt, cookie: cookieHeader(refreshed) });
    assert.equal(logout.status, 200); assert.equal(logout.body.ok, true);
    const revoked = await request('/api/auth/refresh', { method: 'POST', cookie: cookieHeader(refreshed) });
    assert.equal(revoked.status, 401);
    console.log('ok - registration/profile, Passenger login, wrong-password rejection, restoration, refresh rotation and server logout work over HTTP');
    for (const role of ['Passenger', 'Driver', 'LGU', 'Administrator']) {
      const user = await app.db.query('plugin::users-permissions.user').findOne({ where: { blocked: false, role: { name: role } }, populate: ['role'] });
      assert.ok(user, 'enabled role fixture exists');
      const manager = app.sessionManager('users-permissions');
      const refresh = await manager.generateRefreshToken(String(user.id), undefined, { type: 'refresh', metadata: { purpose: 'phase-24-http-smoke' } });
      sessions.push({ userId: String(user.id), id: refresh.sessionId });
      const access = await manager.generateAccessToken(refresh.token); assert.ok(!access.error);
      const me = await request('/api/users/me?populate=role', { token: access.token });
      assert.equal(me.status, 200); assert.equal(me.body.role.name, role);
      const reads = role === 'Passenger' ? ['/api/passenger-reports', '/api/live-vehicles', '/api/transport-nodes']
        : role === 'Driver' ? ['/api/driver-trip-options', '/api/driver-active-trip']
        : ['/api/transport-workbench/routes', '/api/disruption-target-options', '/api/passenger-reports'];
      for (const endpoint of reads) assert.equal((await request(endpoint, { token: access.token })).status, 200, `${role} ${endpoint} succeeds`);
      if (role === 'LGU') {
        const review = await request(`/api/passenger-reports/${reportDocumentId}`, { method: 'PUT', token: access.token,
          body: { data: { review_status: 'REVIEWED', review_notes: 'Disposable Phase 24 acceptance review.' } } });
        assert.equal(review.status, 200); assert.equal(review.body.data.review_status, 'REVIEWED');
      }
      const invalid = await request('/api/pamana-ai/trip-plan', { method: 'POST', token: access.token, body: {} });
      assert.equal(invalid.status, role === 'Driver' ? 403 : 400);
      const forgedGps = await request('/api/vehicle-locations', { method: 'POST', token: access.token, body: { data: { vehicle: 'synthetic-unauthorized', trip: 'synthetic-unauthorized', latitude: 14, longitude: 119 } } });
      assert.ok([400, 403].includes(forgedGps.status), 'unauthorized GPS cannot be persisted');
    }
    const anonymous = await request('/api/transport-workbench/routes'); assert.ok([401, 403].includes(anonymous.status));
    const expired = await request('/api/users/me', { token: 'synthetic.invalid.token' }); assert.equal(expired.status, 401);
    console.log('ok - four real role sessions, workbench/report/live/driver reads, invalid planning, anonymous access and unauthorized GPS boundaries');
    console.log('ok - Passenger report submission, own-report privacy and LGU evidence review work without altering transport data');
    // Request rate limiting on malformed input cannot consume provider quota.
    const limiting = await request('/api/auth/local', { method: 'POST', body: { identifier: credentials.email, password: credentials.password } });
    let limited = false;
    for (let index = 0; index < 31; index++) {
      const result = await request('/api/pamana-ai/trip-plan', { method: 'POST', token: limiting.body.jwt, body: {} });
      assert.ok([400, 429].includes(result.status));
      if (result.status === 429) limited = true;
    }
    assert.equal(limited, true, 'per-user trip-plan limit is enforced over HTTP');
    console.log('ok - per-user rate limit rejects excess requests before provider work');
    assert.deepEqual(defects, [], defects.join('; '));
  } finally {
    if (app) {
      for (const session of sessions) await app.sessionManager('users-permissions').revokeSessionById(session.userId, session.id);
      // Delete only the uniquely named disposable auth/profile fixture. Transport
      // records, reports, drivers and operational sessions are never modified.
      const fixture = fixtureId ? await app.db.query('plugin::users-permissions.user').findOne({ where: { id: fixtureId } })
        : await app.db.query('plugin::users-permissions.user').findOne({ where: { username: marker } });
      if (fixture && fixture.username === marker) {
        if (reportId) await app.db.query('api::passenger-report.passenger-report').delete({ where: { id: reportId, description: `Disposable acceptance observation ${marker}.` } });
        const manager = app.sessionManager('users-permissions');
        await manager.invalidateRefreshToken(String(fixture.id));
        await app.db.query('api::passenger-profile.passenger-profile').deleteMany({ where: { user: { id: fixture.id } } });
        await app.db.query('plugin::users-permissions.user').delete({ where: { id: fixture.id } });
      }
      assert.equal(await digest(audit), expected, 'pilot unchanged after HTTP acceptance');
      await app.destroy();
    }
    await audit.end();
  }
})().catch(error => { console.error(`FAIL - ${error instanceof assert.AssertionError ? error.message.split('\n')[0] : error.name} (private details withheld)`); process.exitCode = 1; });
