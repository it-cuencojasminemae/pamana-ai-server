'use strict';

const assert = require('node:assert/strict');
const { connect, seed, snapshot, manifest } = require('./seed-phase5b-transfer-research');
const { planningEligibilityFor } = require('../src/services/transport-data/planning-eligibility');

async function main() {
  const client = await connect();
  try {
    await client.query('begin');
    const before = await snapshot(client);
    const first = await seed(client);
    assert.ok(first.records.every((record) => record.action === 'unchanged'), 'Run seed:phase5b before the database regression test');
    const second = await seed(client);
    assert.ok(second.records.every((record) => record.action === 'unchanged'));
    assert.deepEqual(await snapshot(client), before, 'Reseeding changed existing data (including San Luis and Phase 5A endpoints)');

    for (const [table, key, records] of [
      ['transport_nodes', 'node_code', manifest.nodes],
      ['routes', 'route_code', manifest.routes],
      ['route_variants', 'variant_code', manifest.variants],
    ]) {
      const rows = (await client.query(`select * from ${table} where ${key} = any($1::text[])`, [records.map((record) => record[key])])).rows;
      assert.equal(rows.length, records.length);
      assert.equal(new Set(rows.map((row) => row[key])).size, records.length);
      for (const row of rows) {
        assert.equal(row.planning_enabled, false);
        assert.equal(row.verification_status, 'CORROBORATED_RESEARCH');
        assert.equal(row.data_mode, 'REAL');
        assert.equal(planningEligibilityFor(row).eligible, false);
        if (table === 'transport_nodes') {
          for (const field of ['latitude', 'longitude', 'google_place_id', 'covered_waiting_area', 'wheelchair_accessible']) assert.equal(row[field], null);
        }
        if (table === 'routes') {
          assert.equal(row.base_fare, null);
          assert.equal(row.estimated_travel_time, null);
          assert.equal(row.active, false);
        }
        if (table === 'route_variants') {
          assert.equal(row.operating_status, 'UNKNOWN');
          assert.equal(row.geometry_source, 'UNKNOWN');
          assert.equal(row.encoded_polyline, null);
          assert.equal(row.geometry_geojson, null);
        }
      }

      // Roll back future verification fixtures; the seed must never alter them.
      for (const status of ['FIELD_VERIFIED', 'AUTHORITATIVE_CURRENT']) {
        await client.query('savepoint verified_fixture');
        await client.query(`update ${table} set verification_status = $1, planning_enabled = true, notes = 'Future manually maintained operational evidence' where ${key} = $2`, [status, records[0][key]]);
        const protectedBefore = await snapshot(client);
        const result = await seed(client);
        assert.equal(result.records.find((record) => record.code === records[0][key]).action, 'protected');
        assert.deepEqual(await snapshot(client), protectedBefore);
        await client.query('rollback to savepoint verified_fixture');
      }
      // Manual edits with weak status are also not overwritten silently.
      await client.query('savepoint edited_fixture');
      await client.query(`update ${table} set notes = 'Manual research edit' where ${key} = $1`, [records[0][key]]);
      await assert.rejects(seed(client), /reconcile evidence/);
      await client.query('rollback to savepoint edited_fixture');
    }

    const endpoints = (await client.query(`
      select v.variant_code, r.route_code, s.node_code as start_node_code, e.node_code as end_node_code
      from route_variants v
      join route_variants_route_lnk rl on rl.route_variant_id = v.id
      join routes r on r.id = rl.route_id
      join route_variants_start_node_lnk sl on sl.route_variant_id = v.id
      join transport_nodes s on s.id = sl.transport_node_id
      join route_variants_end_node_lnk el on el.route_variant_id = v.id
      join transport_nodes e on e.id = el.transport_node_id
      where v.variant_code = any($1::text[]) order by v.variant_code`, [manifest.variants.map((record) => record.variant_code)])).rows;
    const expected = manifest.variants.map(({ variant_code, route_code, start_node_code, end_node_code }) => ({ variant_code, route_code, start_node_code, end_node_code })).sort((a, b) => a.variant_code.localeCompare(b.variant_code));
    assert.deepEqual(endpoints, expected);
    for (const table of ['route_variant_stops', 'fare_rules', 'service_patterns']) assert.equal(before[table].length, 0);

    // Exercise the actual compatibility controller with actual PostgreSQL research
    // rows. Intentionally return them even though its storage filter excludes them.
    const routes = (await client.query("select * from routes where route_code like 'RCH-%'")).rows;
    let filters;
    global.strapi = { documents(uid) {
      if (uid === 'api::route.route') return { findMany: async (query) => { filters = query.filters; return routes.map((row) => ({ ...row, documentId: row.document_id, route_stops: [], vehicles: [] })); } };
      if (uid === 'api::trip.trip') return { findMany: async () => [], findFirst: async () => null };
      if (uid === 'api::vehicle-location.vehicle-location') return { findFirst: async () => null };
      throw new Error(`Unexpected document query ${uid}`);
    } };
    const controller = require('../src/api/trip-search/controllers/trip-search');
    for (const origin of ['San Juan, Mexico', 'Arayat, Pampanga']) {
      const ctx = { query: { origin, destination: 'SM City Pampanga' }, badRequest(message) { throw new Error(message); } };
      await controller.search(ctx);
      assert.deepEqual(ctx.body.data.options, []);
      assert.equal(filters.planning_enabled, true);
      assert.ok(!filters.verification_status.$in.includes('CORROBORATED_RESEARCH'));
    }
    assert.deepEqual(await snapshot(client), before);
    console.log('ok - real DB seed is idempotent; every prior row and endpoint relation unchanged');
    console.log('ok - strong evidence protected; manual research edits rejected without overwrite');
    console.log('ok - two asymmetric variants; no fare, schedule, geometry, coordinates or stop sequence');
    console.log('ok - actual trip-search controller rejects actual PostgreSQL research routes');
  } finally {
    await client.query('rollback');
    await client.end();
    delete global.strapi;
  }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
