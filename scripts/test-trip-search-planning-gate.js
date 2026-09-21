'use strict';

const assert = require('assert');
const {
  DATA_MODE,
  VERIFICATION_STATUS,
} = require('../src/services/transport-data/planning-eligibility');

const evidence = {
  planning_enabled: true,
  verification_status: VERIFICATION_STATUS.FIELD_VERIFIED,
  data_mode: DATA_MODE.REAL,
  verified_at: '2026-09-21T00:00:00.000Z',
  source_name: 'PAMANA field survey',
  source_reference: 'FIELD-SURVEY-2026-09-21',
};

const stop = (id, name, sequence) => ({
  id,
  documentId: `stop-${id}`,
  name,
  sequence,
  latitude: 15 + id / 1000,
  longitude: 120 + id / 1000,
  stop_type: sequence === 1 ? 'pickup' : 'dropoff',
  ...evidence,
});

const verifiedRoute = {
  id: 1,
  documentId: 'verified-route',
  route_code: 'VERIFIED-01',
  route_name: 'Verified route',
  origin: 'Origin, Pampanga',
  destination: 'Destination, Pampanga',
  base_fare: null,
  estimated_travel_time: null,
  route_status: 'active',
  route_stops: [stop(1, 'Verified pickup', 1), stop(2, 'Verified drop-off', 2)],
  vehicles: [],
  ...evidence,
};

const historicalRoute = {
  ...verifiedRoute,
  id: 2,
  documentId: 'historical-route',
  route_code: 'LEGACY-01',
  verification_status: VERIFICATION_STATUS.HISTORICAL_UNVERIFIED,
};

let routeQueryFilters;
global.strapi = {
  documents(uid) {
    if (uid === 'api::route.route') {
      return {
        findMany: async ({ filters }) => {
          routeQueryFilters = filters;
          return [historicalRoute, verifiedRoute];
        },
      };
    }

    if (uid === 'api::trip.trip') {
      return {
        findMany: async () => [],
        findFirst: async () => null,
      };
    }

    if (uid === 'api::vehicle-location.vehicle-location') {
      return { findFirst: async () => null };
    }

    throw new Error(`Unexpected document service: ${uid}`);
  },
};

async function main() {
  const controller = require('../src/api/trip-search/controllers/trip-search');
  const ctx = {
    query: { origin: 'Origin, Pampanga', destination: 'Destination, Pampanga' },
    badRequest(message) {
      throw new Error(message);
    },
  };

  await controller.search(ctx);

  assert.strictEqual(routeQueryFilters.planning_enabled, true);
  assert.strictEqual(routeQueryFilters.data_mode, DATA_MODE.REAL);
  assert.strictEqual(routeQueryFilters.route_status, 'active');
  assert.deepStrictEqual(
    routeQueryFilters.verification_status.$in,
    [VERIFICATION_STATUS.AUTHORITATIVE_CURRENT, VERIFICATION_STATUS.FIELD_VERIFIED]
  );

  assert.ok(ctx.body.data.options.length > 0);
  assert.ok(ctx.body.data.options.every((option) => option.route_code === 'VERIFIED-01'));
  assert.ok(
    ctx.body.data.options.every(
      (option) => option.data_quality.route === VERIFICATION_STATUS.FIELD_VERIFIED
    )
  );
  assert.strictEqual(ctx.body.data.planning_data_only, true);

  console.log('ok - trip search queries only planning candidates');
  console.log('ok - the shared rule excludes a historical route even if returned by storage');
  console.log('ok - eligible route responses carry their verification status');
}

main().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exit(1);
});
