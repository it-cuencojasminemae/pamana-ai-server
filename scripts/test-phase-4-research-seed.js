'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  manifest,
  buildRouteData,
  buildNodeData,
  validateManifest,
  shouldProtectEvidence,
} = require('./seed-phase4-research-data');
const {
  routePlanningEligibilityFor,
} = require('../src/services/transport-data/planning-eligibility');

const root = path.join(__dirname, '..');

async function main() {
  assert.doesNotThrow(validateManifest);

  const liveRecords = [...manifest.route_candidates, ...manifest.transport_node_candidates];
  const allResearchRecords = [
    ...liveRecords,
    ...manifest.historical_toda_research,
    ...manifest.disruption_research,
  ];
  const codes = allResearchRecords.map((record) => record.internal_code);
  assert.strictEqual(new Set(codes).size, codes.length, 'manifest research codes must be unique');
  assert.ok(codes.every((code) => code.startsWith('RCH-')));
  assert.ok(allResearchRecords.every((record) => record.planning_allowed === false));

  assert.strictEqual(manifest.route_candidates.length, 4);
  assert.strictEqual(manifest.transport_node_candidates.length, 6);
  assert.ok(manifest.route_candidates.every((route) => route.data_mode === 'REAL'));
  assert.ok(
    manifest.route_candidates.every(
      (route) => route.research_status === 'CORROBORATED_RESEARCH'
    )
  );

  for (const route of manifest.route_candidates) {
    const data = buildRouteData(route);
    assert.strictEqual(data.planning_enabled, false);
    assert.strictEqual(data.active, false);
    assert.strictEqual(data.route_status, 'inactive');
    assert.strictEqual(data.data_mode, 'REAL');
    assert.strictEqual(data.verification_status, 'CORROBORATED_RESEARCH');
    assert.ok(!Object.hasOwn(data, 'base_fare'));
    assert.ok(!Object.hasOwn(data, 'estimated_travel_time'));
    assert.ok(!Object.hasOwn(data, 'transport_mode'));
    assert.doesNotMatch(JSON.stringify(route), /San Luis/i);

    const eligibility = routePlanningEligibilityFor({
      ...data,
      route_code: route.internal_code,
      route_stops: [],
    });
    assert.strictEqual(eligibility.eligible, false);
    assert.ok(eligibility.reasons.includes('ROUTE_PLANNING_DISABLED'));
  }

  for (const node of manifest.transport_node_candidates) {
    const data = buildNodeData(node);
    assert.strictEqual(node.latitude, null);
    assert.strictEqual(node.longitude, null);
    assert.strictEqual(data.planning_enabled, false);
    assert.ok(!Object.hasOwn(data, 'latitude'));
    assert.ok(!Object.hasOwn(data, 'longitude'));
    assert.ok(!Object.hasOwn(data, 'covered_waiting_area'));
    assert.ok(!Object.hasOwn(data, 'wheelchair_accessible'));
  }

  for (const key of ['route_variants', 'route_variant_stops', 'fare_rules', 'service_patterns']) {
    assert.deepStrictEqual(manifest.operational_seed_policy[key], []);
  }

  assert.strictEqual(manifest.historical_toda_research.length, 8);
  assert.ok(
    manifest.historical_toda_research.every(
      (record) => record.research_status === 'HISTORICAL_UNVERIFIED'
    )
  );
  assert.ok(
    manifest.historical_toda_research.every((record) => record.data_mode === 'REAL')
  );

  assert.strictEqual(shouldProtectEvidence('FIELD_VERIFIED', 'CORROBORATED_RESEARCH'), true);
  assert.strictEqual(shouldProtectEvidence('AUTHORITATIVE_CURRENT', 'RESEARCH_CANDIDATE'), true);
  assert.strictEqual(shouldProtectEvidence('CORROBORATED_RESEARCH', 'RESEARCH_CANDIDATE'), true);
  assert.strictEqual(shouldProtectEvidence('RESEARCH_CANDIDATE', 'CORROBORATED_RESEARCH'), false);

  const seedSource = fs.readFileSync(
    path.join(root, 'scripts', 'seed-phase4-research-data.js'),
    'utf8'
  );
  assert.match(seedSource, /await client\.query\('begin'\)/);
  assert.match(seedSource, /pg_advisory_xact_lock/);
  assert.match(seedSource, /PROTECTED_STATUSES/);
  assert.doesNotMatch(seedSource, /\b(drop|truncate|delete)\b/i);
  assert.doesNotMatch(seedSource, /planning_enabled\s*:\s*true/);

  const researchRoute = {
    id: 44,
    documentId: 'phase4-route',
    route_code: 'RCH-SJ-CSF-SM-ROB',
    route_name: 'Research route',
    origin: 'San Juan, Mexico, Pampanga',
    destination: 'City of San Fernando, Pampanga',
    route_status: 'inactive',
    route_stops: [],
    vehicles: [],
    ...buildRouteData(manifest.route_candidates[0]),
  };
  let queryFilters;
  global.strapi = {
    documents(uid) {
      if (uid === 'api::route.route') {
        return {
          findMany: async ({ filters }) => {
            queryFilters = filters;
            return [researchRoute];
          },
        };
      }
      throw new Error(`Unexpected document service: ${uid}`);
    },
  };
  const controller = require('../src/api/trip-search/controllers/trip-search');
  const ctx = {
    query: {
      origin: 'San Juan, Mexico, Pampanga',
      destination: 'City of San Fernando, Pampanga',
    },
    badRequest(message) {
      throw new Error(message);
    },
  };
  await controller.search(ctx);
  assert.strictEqual(queryFilters.planning_enabled, true);
  assert.deepStrictEqual(ctx.body.data.options, []);
  assert.strictEqual(ctx.body.data.recommended_option_id, null);

  console.log('ok - Phase 4 manifest is versioned, sourced, and code-unique');
  console.log('ok - research routes and nodes contain no fabricated operational facts');
  console.log('ok - historical TODA evidence remains manifest-only and historical');
  console.log('ok - stronger evidence is protected from downgrade');
  console.log('ok - trip search excludes the San Juan research route');
}

main().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exit(1);
});
