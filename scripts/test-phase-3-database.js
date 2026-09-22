'use strict';

const assert = require('assert');
const { Client } = require('pg');

const EXPECTED_LEGACY_COUNTS = Object.freeze({
  route_stops: 7,
  vehicles: 4,
  trips: 0,
  vehicle_locations: 0,
  disruptions: 0,
  passenger_reports: 4,
});

const NEW_TABLES = [
  'route_variants',
  'route_variant_stops',
  'fare_rules',
  'service_patterns',
];

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

async function count(client, table) {
  return (await client.query(`select count(*)::int as count from ${table}`)).rows[0].count;
}

(async () => {
  const client = new Client(config());
  await client.connect();

  try {
    for (const [table, expected] of Object.entries(EXPECTED_LEGACY_COUNTS)) {
      assert.strictEqual(await count(client, table), expected, `${table} count changed`);
    }

    const legacyRoutes = await client.query(
      `select count(*)::int as count from routes where route_code not like 'RCH-%'`
    );
    assert.strictEqual(legacyRoutes.rows[0].count, 2, 'legacy route count changed');

    for (const table of NEW_TABLES) {
      assert.strictEqual(await count(client, table), 0, `${table} was unexpectedly seeded`);
    }

    const unsafeRoutes = await client.query(
      `select count(*)::int as count
         from routes
        where planning_enabled is true
           or verification_status in ('AUTHORITATIVE_CURRENT', 'FIELD_VERIFIED')`
    );
    assert.strictEqual(unsafeRoutes.rows[0].count, 0, 'legacy routes became planning-ready');

    const unsafeStops = await client.query(
      `select count(*)::int as count
         from route_stops
        where planning_enabled is true
           or verification_status in ('AUTHORITATIVE_CURRENT', 'FIELD_VERIFIED')`
    );
    assert.strictEqual(unsafeStops.rows[0].count, 0, 'legacy stops became planning-ready');

    const sanLuis = await client.query(
      `select
         (select count(*)::int from routes
           where coalesce(route_name, '') ilike '%San Luis%'
              or coalesce(origin, '') ilike '%San Luis%'
              or coalesce(destination, '') ilike '%San Luis%') as routes,
         (select count(*)::int from route_stops
           where coalesce(name, '') ilike '%San Luis%') as route_stops`
    );
    assert.strictEqual(sanLuis.rows[0].routes, 2, 'San Luis routes were renamed or removed');
    assert.strictEqual(sanLuis.rows[0].route_stops, 2, 'San Luis stops were renamed or removed');

    const unsafeSanJuan = await client.query(
      `select
         (select count(*)::int from routes
           where route_code not like 'RCH-%'
             and (coalesce(route_name, '') ilike '%San Juan%'
              or coalesce(origin, '') ilike '%San Juan%'
              or coalesce(destination, '') ilike '%San Juan%')) as routes,
         (select count(*)::int from route_stops
           where coalesce(name, '') ilike '%San Juan%') as route_stops`
    );
    assert.strictEqual(unsafeSanJuan.rows[0].routes, 0, 'legacy routes were renamed to San Juan');
    assert.strictEqual(unsafeSanJuan.rows[0].route_stops, 0, 'San Juan stop data was fabricated');

    const accessibility = await client.query(
      `select table_name, column_name, is_nullable
         from information_schema.columns
        where table_schema = current_schema()
          and (table_name, column_name) in (
            ('route_stops', 'covered_waiting_area'),
            ('route_stops', 'accessible_toilet_nearby'),
            ('vehicles', 'wheelchair_accessible'),
            ('vehicles', 'low_floor'),
            ('transport_nodes', 'covered_waiting_area'),
            ('transport_nodes', 'wheelchair_accessible')
          )`
    );
    assert.strictEqual(accessibility.rows.length, 6);
    assert.ok(accessibility.rows.every((row) => row.is_nullable === 'YES'));

    const permissions = await client.query(
      `select r.name,
              count(*)::int as total,
              count(*) filter (where p.action ~ '\\.(find|findOne)$')::int as read_actions,
              count(*) filter (where p.action ~ '\\.(create|update|delete)$')::int as write_actions
         from up_permissions p
         join up_permissions_role_lnk link on link.permission_id = p.id
         join up_roles r on r.id = link.role_id
        where p.action ~ '^api::(route-variant|route-variant-stop|transport-node|fare-rule|service-pattern)\\.'
        group by r.name`
    );
    const permissionByRole = Object.fromEntries(
      permissions.rows.map((row) => [row.name, row])
    );
    for (const role of ['Passenger', 'Driver', 'LGU']) {
      assert.strictEqual(permissionByRole[role]?.read_actions, 10, `${role} read permissions`);
      assert.strictEqual(permissionByRole[role]?.write_actions, 0, `${role} must be read-only`);
    }
    assert.strictEqual(permissionByRole.Administrator?.read_actions, 10);
    assert.strictEqual(permissionByRole.Administrator?.write_actions, 15);
    assert.strictEqual(permissionByRole.Public, undefined, 'Public must have no Phase 3 permissions');

    console.log('ok - legacy rows and San Luis records remain intact');
    console.log('ok - operational transport knowledge tables remain unseeded');
    console.log('ok - compatibility records are not planning-ready or authoritative');
    console.log('ok - accessibility columns support unknown/null');
    console.log('ok - role permissions preserve read-only and administrator boundaries');
  } finally {
    await client.end();
  }
})().catch((error) => {
  console.error(`Phase 3 database validation failed: ${error.message}`);
  process.exit(1);
});
