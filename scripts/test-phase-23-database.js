'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const knex = require('knex');
const { connect, snapshot } = require('./seed-phase5b-transfer-research');
const { loadLatestLocations, latestLocationIdsQuery, locationKey } = require('../src/services/pamana-journey/latest-location-loader');
const EXPECTED = require('./helpers/pilot-geometry-expectations').EXPECTED_DIGEST;

(async () => {
  const audit = await connect();
  const params = audit.connectionParameters;
  const db = knex({ client: 'pg', connection: {
    host: params.host, port: params.port, database: params.database, user: params.user,
    password: params.password, ssl: params.ssl,
  }, pool: { min: 0, max: 1 } });
  try {
    const digest = () => snapshot(audit).then(state => crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex'));
    assert.equal(await digest(), EXPECTED);
    // Temporary fixtures shadow public tables only inside this connection.
    // ON COMMIT DROP guarantees no records or schema changes persist.
    await db.transaction(async trx => {
      await trx.raw(`
        create temp table vehicle_locations (id integer primary key, document_id text, recorded_at timestamptz, data_mode text) on commit drop;
        create temp table trips (id integer primary key, document_id text) on commit drop;
        create temp table vehicles (id integer primary key, document_id text) on commit drop;
        create temp table vehicle_locations_trip_lnk (vehicle_location_id integer, trip_id integer) on commit drop;
        create temp table vehicle_locations_vehicle_lnk (vehicle_location_id integer, vehicle_id integer) on commit drop;
        insert into trips values (1,'synthetic-trip-a'),(2,'synthetic-trip-b');
        insert into vehicles values (1,'synthetic-vehicle-a'),(2,'synthetic-vehicle-b');
        insert into vehicle_locations values
          (1,'synthetic-old','2026-09-28T00:00:00Z','REAL'),
          (2,'synthetic-latest','2026-09-28T00:01:00Z','REAL'),
          (3,'synthetic-sim','2026-09-28T00:02:00Z','SIMULATED'),
          (4,'synthetic-wrong-pair','2026-09-28T00:03:00Z','REAL'),
          (5,'synthetic-b','2026-09-28T00:01:00Z','REAL'),
          (6,'synthetic-tie','2026-09-28T00:01:00Z','REAL');
        insert into vehicle_locations_trip_lnk values (1,1),(2,1),(3,1),(4,2),(5,2),(6,1);
        insert into vehicle_locations_vehicle_lnk values (1,1),(2,1),(3,1),(4,1),(5,2),(6,1);
      `);
      const pairs = [
        { tripId: 'synthetic-trip-a', vehicleId: 'synthetic-vehicle-a' },
        { tripId: 'synthetic-trip-b', vehicleId: 'synthetic-vehicle-b' },
      ];
      let hydrationQueries = 0;
      const strapiInstance = { db: { connection: trx }, documents: () => ({ findMany: async query => {
        hydrationQueries++;
        assert.equal(query.filters.data_mode, 'REAL');
        assert.deepEqual([...query.filters.documentId.$in].sort(), ['synthetic-b', 'synthetic-tie']);
        return query.filters.documentId.$in.map(documentId => ({ documentId, data_mode: 'REAL' }));
      } }) };
      const real = await loadLatestLocations({ strapiInstance, pairs });
      assert.equal(real.size, 2); assert.equal(hydrationQueries, 1);
      assert.equal(real.get(locationKey(pairs[0].tripId, pairs[0].vehicleId)).documentId, 'synthetic-tie');
      assert.equal(real.get(locationKey(pairs[1].tripId, pairs[1].vehicleId)).documentId, 'synthetic-b');
      const mixed = await latestLocationIdsQuery(trx, pairs, { allowSimulated: true });
      assert.deepEqual(mixed.map(row => row.locationId).sort(), ['synthetic-b', 'synthetic-sim']);
      assert.equal((await loadLatestLocations({ strapiInstance, pairs: [] })).size, 0);
      console.log('ok - PostgreSQL batches exact trip/vehicle latest pings with REAL filtering and deterministic ties; one document hydration');
    });
    // Compile and execute against the actual schema without reading GPS history into JS.
    await latestLocationIdsQuery(db, [{ tripId: 'phase23-nonexistent-trip', vehicleId: 'phase23-nonexistent-vehicle' }]);
    assert.equal(await digest(), EXPECTED);
    console.log('ok - actual PostgreSQL schema accepts the query; temporary fixtures are gone and pilot digest is unchanged');
  } finally { await db.destroy(); await audit.end(); }
})().catch(error => { console.error(`Phase 23 database test failed (${error.code || error.name}).`); process.exitCode = 1; });
