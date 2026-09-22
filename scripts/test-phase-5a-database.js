'use strict';

const assert = require('assert');
const { Client } = require('pg');
const { manifest, seed } = require('./seed-phase5a-passenger-points');

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
    assert.strictEqual(await count(client, 'routes'), 6, 'route count changed');
    assert.strictEqual(await count(client, 'transport_nodes'), 8, 'unexpected node count');
    for (const table of ['route_variants', 'route_variant_stops', 'fare_rules', 'service_patterns']) {
      assert.strictEqual(await count(client, table), 0, `${table} must remain empty`);
    }

    const codes = manifest.transport_nodes.map((node) => node.internal_code);
    const nodes = (
      await client.query(
        `select node_code, name, node_type, barangay, municipality_city, province,
                latitude, longitude, google_place_id, planning_enabled,
                verification_status, data_mode
           from transport_nodes
          where node_code = any($1::text[])
          order by node_code`,
        [codes]
      )
    ).rows;

    assert.strictEqual(nodes.length, 2);
    assert.ok(nodes.every((node) => node.verification_status === 'CORROBORATED_RESEARCH'));
    assert.ok(nodes.every((node) => node.data_mode === 'REAL'));
    assert.ok(nodes.every((node) => node.planning_enabled === false));
    assert.ok(nodes.every((node) => node.latitude === null && node.longitude === null));
    assert.ok(nodes.every((node) => node.google_place_id === null));
    assert.ok(nodes.every((node) => node.municipality_city === 'City of San Fernando'));
    assert.ok(nodes.every((node) => node.province === 'Pampanga'));

    const sm = nodes.find((node) => node.node_code === 'RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF');
    const robinsons = nodes.find(
      (node) => node.node_code === 'RCH-ROB-STARMILLS-ARAYAT-GATE-LOAD'
    );
    assert.strictEqual(sm.node_type, 'DROP_OFF');
    assert.strictEqual(robinsons.node_type, 'LOADING_BAY');
    assert.notStrictEqual(sm.node_code, robinsons.node_code);
    assert.notStrictEqual(sm.name, robinsons.name);

    const duplicates = await client.query(
      `select node_code
         from transport_nodes
        where node_code = any($1::text[])
        group by node_code
       having count(*) > 1`,
      [codes]
    );
    assert.strictEqual(duplicates.rowCount, 0);

    const routeFacts = (
      await client.query(
        `select count(*) filter (where base_fare is not null)::int as fares,
                count(*) filter (where estimated_travel_time is not null)::int as travel_times
           from routes
          where route_code like 'RCH-%'`
      )
    ).rows[0];
    assert.deepStrictEqual(routeFacts, { fares: 0, travel_times: 0 });

    const unsafe = (
      await client.query(
        `select count(*)::int as count
           from transport_nodes
          where node_code = any($1::text[])
            and planning_enabled is true`,
        [codes]
      )
    ).rows[0].count;
    assert.strictEqual(unsafe, 0);

    const variants = await client.query(
      `select variant_code from route_variants where variant_code in ('RCH-SJ-SMROB-OUT', 'RCH-SJ-SMROB-IN')`
    );
    assert.strictEqual(variants.rowCount, 0, 'Phase 5A must not fabricate route variants');

    // Verify the real upsert protects future field verification, then roll
    // back so the Phase 5A research database remains unchanged.
    await client.query('begin');
    try {
      await client.query(
        `update transport_nodes
            set verification_status = 'FIELD_VERIFIED',
                name = 'Manually maintained field endpoint',
                planning_enabled = true
          where node_code = 'RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF'`
      );
      const reseed = await seed(client);
      const protectedNode = reseed.nodes.find(
        (node) => node.code === 'RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF'
      );
      assert.strictEqual(protectedNode.action, 'protected');

      const values = (
        await client.query(
          `select verification_status, name, planning_enabled
             from transport_nodes
            where node_code = 'RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF'`
        )
      ).rows[0];
      assert.deepStrictEqual(values, {
        verification_status: 'FIELD_VERIFIED',
        name: 'Manually maintained field endpoint',
        planning_enabled: true,
      });
    } finally {
      await client.query('rollback');
    }

    console.log('ok - both Phase 5A passenger points exist as separate database records');
    console.log('ok - both remain research-only, planning-disabled, and coordinate-null');
    console.log('ok - fare, schedule, geometry, variants, and stop sequences remain absent');
    console.log('ok - transactional reseed cannot downgrade field-verified endpoint data');
  } finally {
    await client.end();
  }
})().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exit(1);
});
