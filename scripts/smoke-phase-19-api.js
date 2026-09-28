'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connect } = require('./seed-phase5b-transfer-research');

const BASE_URL = process.env.PAMANA_API_URL || 'http://127.0.0.1:1337';
const marker = crypto.randomBytes(8).toString('hex');
const email = `phase19-${marker}@example.test`;
const password = `P19!${crypto.randomBytes(16).toString('base64url')}`;
let userId = null;
let profileId = null;
let reportId = null;

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

async function cleanup(client) {
  if (reportId) {
    for (const table of ['passenger_reports_route_lnk', 'passenger_reports_route_variant_lnk', 'passenger_reports_transport_node_lnk', 'passenger_reports_vehicle_lnk', 'passenger_reports_trip_lnk', 'passenger_reports_stop_lnk', 'passenger_reports_passenger_lnk']) {
      await client.query(`delete from ${table} where passenger_report_id=$1`, [reportId]).catch(() => {});
    }
    await client.query('delete from passenger_reports where id=$1', [reportId]);
  }
  if (profileId) {
    await client.query('delete from up_users_passenger_profile_lnk where passenger_profile_id=$1', [profileId]).catch(() => {});
    await client.query('delete from passenger_profiles where id=$1', [profileId]);
  }
  if (userId) {
    await client.query('delete from up_users_role_lnk where user_id=$1', [userId]).catch(() => {});
    await client.query('delete from up_users where id=$1', [userId]);
  }
}

async function main() {
  const client = await connect();
  const baseline = (await client.query(`select
    (select count(*)::int from disruptions) disruptions,
    (select md5(string_agg(md5(to_jsonb(v)::text), '' order by v.id)) from vehicles v) vehicles,
    (select md5(string_agg(md5(to_jsonb(r)::text), '' order by r.id)) from routes r) routes`)).rows[0];
  try {
    const unauthenticated = await request('/api/passenger-reports');
    assert.equal(unauthenticated.status, 403);

    const registration = await request('/api/auth/local/register', {
      method: 'POST', body: JSON.stringify({ username: `phase19-${marker}`, email, password }),
    });
    assert.equal(registration.status, 200);
    const token = registration.body.jwt;
    userId = registration.body.user.id;
    const headers = { authorization: `Bearer ${token}` };

    const profile = await request('/api/passenger-profiles', {
      method: 'POST', headers, body: JSON.stringify({ data: { first_name: 'Phase', last_name: 'Nineteen' } }),
    });
    assert.equal(profile.status, 201);
    profileId = profile.body.data.id;

    const invalid = await request('/api/passenger-reports', {
      method: 'POST', headers, body: JSON.stringify({ data: { report_type: 'LONG_WAIT', description: 'Observed a long wait at the stop.', latitude: 0, longitude: 0 } }),
    });
    assert.equal(invalid.status, 400);

    const created = await request('/api/passenger-reports', {
      method: 'POST', headers, body: JSON.stringify({ data: { report_type: 'LONG_WAIT', description: 'Observed a long wait at the loading point.', location_note: 'Pilot smoke test landmark', context_source: 'NONE' } }),
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    reportId = created.body.data.id;
    assert.equal(created.body.data.review_status, 'PENDING');
    assert.equal(created.body.data.passenger, undefined);

    const own = await request('/api/passenger-reports', { headers });
    assert.equal(own.status, 200);
    assert.equal(own.body.data.length, 1);
    assert.equal(own.body.data[0].passenger, undefined);
    assert.equal(own.body.data[0].latitude, undefined);

    const lguRole = (await client.query("select id from up_roles where name='LGU'")).rows[0];
    assert.ok(lguRole);
    await client.query('update up_users_role_lnk set role_id=$1 where user_id=$2', [lguRole.id, userId]);
    const reviewed = await request(`/api/passenger-reports/${created.body.data.documentId}`, {
      method: 'PUT', headers, body: JSON.stringify({ data: { review_status: 'REVIEWED', review_notes: 'Reviewed as passenger evidence only.' } }),
    });
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
    assert.equal(reviewed.body.data.review_status, 'REVIEWED');
    assert.equal(reviewed.body.data.passenger, undefined);

    const unchanged = (await client.query(`select
      (select count(*)::int from disruptions) disruptions,
      (select md5(string_agg(md5(to_jsonb(v)::text), '' order by v.id)) from vehicles v) vehicles,
      (select md5(string_agg(md5(to_jsonb(r)::text), '' order by r.id)) from routes r) routes`)).rows[0];
    assert.deepEqual(unchanged, baseline);
    console.log('ok - authenticated submission, own-report privacy, invalid GPS rejection and LGU review work through the real API');
    console.log('ok - report creation/review changes no route, vehicle occupancy, or disruption row');
  } finally {
    await cleanup(client);
    await client.end();
  }
}

main().catch((error) => { console.error(`FAIL: ${error.message}`); process.exitCode = 1; });
