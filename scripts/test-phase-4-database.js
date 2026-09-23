'use strict';

const assert = require('assert');
const { Client } = require('pg');
const { manifest, seed } = require('./seed-phase4-research-data');

const LEGACY_COUNTS = Object.freeze({
  route_stops: 7,
  vehicles: 4,
  trips: 0,
  vehicle_locations: 0,
  disruptions: 0,
  passenger_reports: 4,
});

function config() {
  const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false;
  return process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl }
    : {
        host: process.env.DATABASE_HOST || '127.0.0.1',
        port: Number(process.env.DATABASE_PORT || 5432),
        database: process.env.DATABASE_NAME,
        user: process.env.DATABASE_USERNAME,
        password: process.env.DATABASE_PASSWORD,
        ssl,
      };
}

const count = async (client, table) =>
  (await client.query(`select count(*)::int as count from ${table}`)).rows[0].count;

(async () => {
  const client = new Client(config());
  await client.connect();

  try {
    for (const [table, expected] of Object.entries(LEGACY_COUNTS)) {
      assert.strictEqual(await count(client, table), expected, `${table} legacy count changed`);
    }

    assert.ok((await count(client, 'routes')) >= 2 + manifest.route_candidates.length);
    assert.ok(
      (await count(client, 'transport_nodes')) >= manifest.transport_node_candidates.length,
      'Phase 4 transport nodes were removed'
    );
    for (const table of ['route_variant_stops', 'fare_rules', 'service_patterns']) {
      assert.strictEqual(await count(client, table), 0, `${table} must remain empty`);
    }

    const routeCodes = manifest.route_candidates.map((record) => record.internal_code);
    const routes = (
      await client.query(
        `select route_code, route_name, origin, destination, base_fare,
                estimated_travel_time, transport_mode, route_status, active,
                planning_enabled, verification_status, data_mode
           from routes
          where route_code = any($1::text[])
          order by route_code`,
        [routeCodes]
      )
    ).rows;
    assert.strictEqual(routes.length, routeCodes.length);
    assert.ok(routes.every((route) => route.planning_enabled === false));
    assert.ok(routes.every((route) => route.active === false && route.route_status === 'inactive'));
    assert.ok(routes.every((route) => route.verification_status === 'CORROBORATED_RESEARCH'));
    assert.ok(routes.every((route) => route.data_mode === 'REAL'));
    assert.ok(routes.every((route) => route.base_fare === null));
    assert.ok(routes.every((route) => route.estimated_travel_time === null));
    assert.ok(routes.every((route) => route.transport_mode === null));
    assert.ok(routes.every((route) => !/San Luis/i.test(JSON.stringify(route))));

    const duplicateRoutes = await client.query(
      `select route_code from routes where route_code = any($1::text[]) group by route_code having count(*) > 1`,
      [routeCodes]
    );
    assert.strictEqual(duplicateRoutes.rowCount, 0, 'duplicate research route codes exist');

    const nodeCodes = manifest.transport_node_candidates.map((record) => record.internal_code);
    const nodes = (
      await client.query(
        `select node_code, latitude, longitude, google_place_id,
                covered_waiting_area, wheelchair_accessible,
                planning_enabled, verification_status, data_mode
           from transport_nodes
          where node_code = any($1::text[])
          order by node_code`,
        [nodeCodes]
      )
    ).rows;
    assert.strictEqual(nodes.length, nodeCodes.length);
    assert.ok(nodes.every((node) => node.latitude === null && node.longitude === null));
    assert.ok(nodes.every((node) => node.google_place_id === null));
    assert.ok(nodes.every((node) => node.covered_waiting_area === null));
    assert.ok(nodes.every((node) => node.wheelchair_accessible === null));
    assert.ok(nodes.every((node) => node.planning_enabled === false));
    assert.ok(nodes.every((node) => node.data_mode === 'REAL'));
    assert.strictEqual(
      nodes.filter((node) => node.verification_status === 'CORROBORATED_RESEARCH').length,
      2
    );
    assert.strictEqual(
      nodes.filter((node) => node.verification_status === 'RESEARCH_CANDIDATE').length,
      4
    );

    const duplicateNodes = await client.query(
      `select node_code from transport_nodes where node_code = any($1::text[]) group by node_code having count(*) > 1`,
      [nodeCodes]
    );
    assert.strictEqual(duplicateNodes.rowCount, 0, 'duplicate research node codes exist');

    const unsafe = await client.query(
      `select
         (select count(*)::int from routes where route_code like 'RCH-%' and planning_enabled is true) as routes,
         (select count(*)::int from transport_nodes where node_code like 'RCH-%' and planning_enabled is true) as nodes`
    );
    assert.deepStrictEqual(unsafe.rows[0], { routes: 0, nodes: 0 });

    // Exercise the protection rule against the real database without leaving
    // test data behind. The outer rollback restores the original research row.
    await client.query('begin');
    try {
      await client.query(
        `update routes
            set verification_status = 'FIELD_VERIFIED',
                route_name = 'Manually maintained field record',
                planning_enabled = true
          where route_code = 'RCH-SJ-CSF-SM-ROB'`
      );
      const reseed = await seed(client);
      const protectedRoute = reseed.routes.find(
        (route) => route.code === 'RCH-SJ-CSF-SM-ROB'
      );
      assert.strictEqual(protectedRoute.action, 'protected');

      const protectedValues = (
        await client.query(
          `select verification_status, route_name, planning_enabled
             from routes
            where route_code = 'RCH-SJ-CSF-SM-ROB'`
        )
      ).rows[0];
      assert.deepStrictEqual(protectedValues, {
        verification_status: 'FIELD_VERIFIED',
        route_name: 'Manually maintained field record',
        planning_enabled: true,
      });
    } finally {
      await client.query('rollback');
    }

    console.log('ok - Phase 4 database rows are unique and planning-disabled');
    console.log('ok - no fare, travel time, geometry proxy, coordinates, or accessibility guess was stored');
    console.log('ok - legacy rows remain present and operational tables remain empty');
    console.log('ok - transactional reseed cannot downgrade a field-verified record');
  } finally {
    await client.end();
  }
})().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exit(1);
});
