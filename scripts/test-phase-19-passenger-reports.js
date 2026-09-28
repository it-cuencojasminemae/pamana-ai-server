'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  REPORT_CATEGORIES, REVIEW_STATUSES, redactReport, validateReportInput, validateTransportContext,
} = require('../src/services/passenger-report/report-policy');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

{
  assert.deepEqual(REPORT_CATEGORIES, [
    'VEHICLE_FULL', 'LONG_WAIT', 'NO_SERVICE_OBSERVED', 'STOP_ISSUE',
    'ROUTE_INFORMATION_ISSUE', 'ACCESSIBILITY_ISSUE', 'DISRUPTION', 'OTHER',
  ]);
  assert.deepEqual(REVIEW_STATUSES, ['PENDING', 'REVIEWED', 'VERIFIED', 'DISMISSED']);
  assert.equal(validateReportInput({ report_type: 'LONG_WAIT', description: 'Waited more than thirty minutes.' }).valid, true);
  assert.equal(validateReportInput({ report_type: 'made_up', description: 'Long enough description.' }).valid, false);
  assert.equal(validateReportInput({ report_type: 'LONG_WAIT', description: 'short' }).valid, false);
  assert.ok(validateReportInput({ report_type: 'OTHER', description: 'Valid description', latitude: 0, longitude: 0 }).errors.includes('NULL_ISLAND_REJECTED'));
  assert.ok(validateReportInput({ report_type: 'OTHER', description: 'Valid description', latitude: 15 }).errors.includes('COORDINATE_PAIR_REQUIRED'));
  console.log('ok - structured categories, descriptions, optional GPS and null-island validation are deterministic');
}

{
  const privateRecord = { passenger: { id: 4, email: 'private@example.test' }, latitude: 15.1, longitude: 120.7, location_accuracy_m: 9, review_notes: 'Internal', description: 'Observed issue' };
  const passenger = redactReport(privateRecord);
  assert.equal(passenger.passenger, undefined);
  assert.equal(passenger.latitude, undefined);
  assert.equal(passenger.review_notes, undefined);
  const reviewer = redactReport(privateRecord, { reviewer: true });
  assert.equal(reviewer.passenger, undefined);
  assert.equal(reviewer.latitude, 15.1);
  assert.equal(reviewer.review_notes, 'Internal');
  console.log('ok - passenger identity is never returned and exact location is reviewer-only');
}

async function contextTests() {
  const route = { documentId: 'route-real-01', planning_enabled: true, data_mode: 'REAL' };
  const node = { documentId: 'node-real-001', planning_enabled: true, data_mode: 'REAL' };
  const other = { documentId: 'node-real-999', planning_enabled: true, data_mode: 'REAL' };
  const variant = { documentId: 'variant-real-01', planning_enabled: true, data_mode: 'REAL', route, route_variant_stops: [{ transport_node: node }] };
  const records = new Map([[route.documentId, route], [node.documentId, node], [other.documentId, other], [variant.documentId, variant]]);
  const strapi = { documents: () => ({ findOne: async ({ documentId }) => records.get(documentId) || null }) };
  const valid = await validateTransportContext(strapi, { route: route.documentId, route_variant: variant.documentId, transport_node: node.documentId });
  assert.deepEqual(valid.relations, { route: route.documentId, route_variant: variant.documentId, transport_node: node.documentId });
  await assert.rejects(() => validateTransportContext(strapi, { route_variant: variant.documentId, transport_node: other.documentId }), /RELATION_MISMATCH/);
  await assert.rejects(() => validateTransportContext(strapi, { route: 'missing-id' }), /NOT_FOUND/);
  assert.deepEqual((await validateTransportContext(strapi, { location_note: 'Route name in free text' })).relations, {});
  console.log('ok - exact optional relations are validated together and never guessed from report text');
}

async function main() {
  await contextTests();
  const controller = read('src/api/passenger-report/controllers/passenger-report.js');
  const index = read('src/index.js');
  assert.match(controller, /if \(!ctx\.state\.user\) return ctx\.unauthorized/);
  assert.match(controller, /Only LGU or Administrator reviewers/);
  assert.match(index, /Passenger[\s\S]*passenger-report\.passenger-report\.create/);
  assert.match(index, /LGU[\s\S]*passenger-report\.passenger-report\.update/);
  assert.match(index, /Administrator[\s\S]*passenger-report\.passenger-report\.update/);
  assert.doesNotMatch(controller, /documents\('api::disruption\.disruption'\).*create/s);
  assert.doesNotMatch(controller, /documents\('api::vehicle\.vehicle'\).*update/s);
  assert.doesNotMatch(controller, /planning_enabled\s*:/);
  console.log('ok - authentication, ownership, reviewer permissions and evidence-only isolation are explicit');
}

main().catch((error) => { console.error(`FAIL: ${error.stack || error.message}`); process.exitCode = 1; });
