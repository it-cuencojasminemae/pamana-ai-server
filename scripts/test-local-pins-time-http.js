'use strict';

// Explicit local acceptance run. Requires a disposable Passenger account; creates no transport data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { connect } = require('./seed-phase5b-transfer-research');
const { digest, counts } = require('./activate-pilot-field-verified');
const base = process.env.PAMANA_TEST_API_URL || 'http://127.0.0.1:1338';
assert.ok(/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(base), 'Acceptance script is local-only');
assert.match(process.env.PAMANA_TEST_USERNAME || '', /^phase24-browser-[0-9-]+$/);
assert.ok(process.env.PAMANA_TEST_PASSWORD, 'Disposable test password is required');
const refs = require('../src/services/pamana-journey/data/san-juan-boundary-verification.json').referencePoints;
const point = (index, source) => ({ lat: refs[index].lat, lng: refs[index].lng, label: refs[index].name, source });
const report = { checkedAt: new Date().toISOString(), api: base, cases: [] };

(async () => {
  const login = await fetch(`${base}/api/auth/local`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: process.env.PAMANA_TEST_USERNAME, password: process.env.PAMANA_TEST_PASSWORD }) });
  const session = await login.json(); assert.ok(login.ok && session.jwt, 'Test sign-in succeeds');
  const headers = { Authorization: `Bearer ${session.jwt}`, 'Content-Type': 'application/json' };
  const call = async (endpoint, body) => {
    const start = Date.now();
    const response = await fetch(`${base}${endpoint}`, { method: body ? 'POST' : 'GET', headers,
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(45000) });
    return { httpStatus: response.status, body: await response.json(), elapsedMs: Date.now() - start };
  };
  const area = await call('/api/pamana-ai/pin-area');
  assert.equal(area.httpStatus, 200); assert.equal(area.body.enabled, true); assert.equal(area.body.verified, true);
  assert.equal(area.body.boundary.properties.psgc_10d, '0305413031');
  report.cases.push({ case: 'authenticated sourced pin area', status: 'PASS' });

  const request = { origin: point(0, 'MAP_PIN'), destination: point(2, 'GEOAPIFY'), departureAt: new Date().toISOString(), passengerCategory: 'REGULAR' };
  const result = await call('/api/pamana-ai/trip-plan', request);
  assert.equal(result.httpStatus, 200); assert.equal(result.body.status, 'JOURNEYS_FOUND');
  assert.ok(result.body.journeys.some(j => j.transferCount === 0 && j.fareSummary.totalFare === 27));
  assert.ok(result.body.journeys.some(j => j.transferCount === 1 && j.fareSummary.totalFare === 114));
  report.cases.push({ case: 'PSU local pin to searched SM, regular fares', status: 'PASS', fares: result.body.journeys.map(j => j.fareSummary.totalFare) });
  const selected = result.body.journeys.find(j => j.transferCount === 0);
  const time = await call('/api/pamana-ai/travel-time', { request, journeyId: selected.id });
  assert.equal(time.httpStatus, 200); assert.equal(time.body.journeyId, selected.id);
  assert.ok(['COMPLETE', 'PARTIAL', 'UNAVAILABLE'].includes(time.body.status));
  assert.equal(selected.durationSummary.totalJourneyDurationSeconds, null);
  assert.equal(result.body.recommendations.fastest.journeyId, null);
  if (time.body.status !== 'UNAVAILABLE') assert.ok(time.body.exclusions.includes('WAITING'));
  report.cases.push({ case: 'live optional road estimate', status: 'PASS', elapsedMs: time.elapsedMs, estimate: time.body });

  const student = await call('/api/pamana-ai/trip-plan', { ...request, passengerCategory: 'STUDENT' });
  assert.ok(student.body.journeys.some(j => j.transferCount === 0 && j.fareSummary.totalFare === 22));
  assert.ok(student.body.journeys.some(j => j.transferCount === 1 && j.fareSummary.totalFare === 111));
  report.cases.push({ case: 'Student pin journey fares', status: 'PASS', fares: student.body.journeys.map(j => j.fareSummary.totalFare) });

  const inbound = await call('/api/pamana-ai/trip-plan', { ...request, origin: point(3, 'GEOAPIFY'), destination: point(0, 'MAP_PIN') });
  assert.equal(inbound.body.status, 'JOURNEYS_FOUND'); assert.ok(inbound.body.journeys.some(j => j.fareSummary.totalFare === 28));
  assert.ok(inbound.body.journeys.some(j => j.legs.some(leg => leg.signboard === 'SAN JUAN')));
  report.cases.push({ case: 'Robinsons searched origin to local pin', status: 'PASS' });

  const outside = await call('/api/pamana-ai/trip-plan', { ...request, destination: point(2, 'MAP_PIN') });
  assert.equal(outside.httpStatus, 400);
  const unsupported = await call('/api/pamana-ai/trip-plan', { ...request, origin: { lat: 15.1142, lng: 120.700, source: 'MAP_PIN', label: 'Local coverage test' } });
  assert.equal(unsupported.httpStatus, 200); assert.equal(unsupported.body.status, 'NO_ELIGIBLE_ACCESS_NODES');
  report.cases.push({ case: 'outside pin rejected; in-area unsupported location explained', status: 'PASS' });
  const forged = await call('/api/pamana-ai/travel-time', { request, journeyId: selected.id, seconds: 1 });
  assert.equal(forged.httpStatus, 400);
  const unknown = await call('/api/pamana-ai/travel-time', { request, journeyId: 'invalid-journey' });
  assert.equal(unknown.body.status, 'UNAVAILABLE');
  const anonymous = await fetch(`${base}/api/pamana-ai/pin-area`); assert.ok([401, 403].includes(anonymous.status));
  report.cases.push({ case: 'anonymous, forged and stale requests rejected safely', status: 'PASS' });

  const client = await connect();
  try {
    await client.query('BEGIN READ ONLY');
    report.transportDigest = await digest(client); report.transportCounts = await counts(client);
    if (process.env.PAMANA_TEST_EXPECTED_DIGEST) assert.equal(report.transportDigest, process.env.PAMANA_TEST_EXPECTED_DIGEST);
    await client.query('ROLLBACK');
  } finally { await client.end(); }
  const file = path.join(__dirname, '../documentation/local-pins-time-acceptance.json');
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ casesPassed: report.cases.length, timeStatus: time.body.status, transportDigest: report.transportDigest }));
})().catch(error => { console.error('Local pin/time acceptance failed: ' + (error.code || error.name) + ' ' + error.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted]')); process.exitCode = 1; });
