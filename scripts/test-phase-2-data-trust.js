'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const backendRoot = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(backendRoot, ...parts), 'utf8');
const readJson = (...parts) => JSON.parse(read(...parts));

const expectedStatuses = [
  'AUTHORITATIVE_CURRENT',
  'FIELD_VERIFIED',
  'CORROBORATED_RESEARCH',
  'HISTORICAL_UNVERIFIED',
  'SIMULATED_DEMO',
  'RESEARCH_CANDIDATE',
];
const verificationFields = [
  'planning_enabled',
  'verification_status',
  'data_mode',
  'verified_at',
  'source_name',
  'source_url',
  'source_reference',
  'notes',
];

for (const [apiName, schemaName] of [
  ['route', 'route'],
  ['route-stop', 'route-stop'],
]) {
  const schema = readJson('src', 'api', apiName, 'content-types', schemaName, 'schema.json');

  for (const field of verificationFields) {
    assert.ok(schema.attributes[field], `${apiName} is missing ${field}`);
  }

  assert.strictEqual(schema.attributes.planning_enabled.default, false);
  assert.deepStrictEqual(schema.attributes.verification_status.enum, expectedStatuses);
  assert.deepStrictEqual(schema.attributes.data_mode.enum, ['REAL', 'SIMULATED']);
}

for (const apiName of [
  'cooperative',
  'driver',
  'vehicle',
  'trip',
  'vehicle-location',
  'passenger-report',
  'disruption',
  'passenger-demand-observation',
  'prediction',
]) {
  const schema = readJson(
    'src',
    'api',
    apiName,
    'content-types',
    apiName,
    'schema.json'
  );
  assert.deepStrictEqual(schema.attributes.data_mode.enum, ['REAL', 'SIMULATED']);
  assert.strictEqual(schema.attributes.data_mode.default, 'SIMULATED');
}

const tripSearch = read('src', 'api', 'trip-search', 'controllers', 'trip-search.js');
assert.match(tripSearch, /planningCandidateFilters\(\{ requireActive: true \}\)/);
assert.match(tripSearch, /filterPlanningEligibleRoutes\(planningCandidates\)/);

const bootstrap = read('src', 'index.js');
assert.match(bootstrap, /HISTORICAL_UNVERIFIED/);
assert.match(bootstrap, /whereNull\('planning_enabled'\)\.update\(\{ planning_enabled: false \}\)/);
assert.match(bootstrap, /whereNull\('data_mode'\)\.update\(\{ data_mode: DATA_MODE\.SIMULATED \}\)/);
assert.match(bootstrap, /await hardenDataTrustColumns\(strapi\)/);

console.log('ok - route and stop schemas expose the complete verification model');
console.log('ok - operational schemas distinguish REAL from SIMULATED data');
console.log('ok - passenger trip search applies the shared planning gate');
console.log('ok - legacy rows are conservatively backfilled without deletion');
