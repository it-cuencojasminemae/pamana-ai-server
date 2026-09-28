'use strict';

const assert = require('node:assert/strict');
const { connect } = require('./seed-phase5b-transfer-research');
const { counts, digest } = require('./activate-pilot-field-verified');

const EXPECTED_DIGEST = '3d63fcdb5d9581d71e2c68d54db9c00868510dcc9b91e6e38fcb893373af9139';

async function main() {
  const client = await connect();
  try {
    await client.query('begin read only');
    assert.equal(await digest(client), EXPECTED_DIGEST);
    const before = await counts(client);
    assert.deepEqual(before, {
      transport_nodes: 10, routes: 8, route_variants: 4, route_variant_stops: 8,
      fare_rules: 2, service_patterns: 0, field_verified_nodes: 4,
      field_verified_routes: 3, field_verified_variants: 4, field_verified_fares: 2,
      planning_nodes: 4, planning_routes: 3, planning_variants: 4,
    });
    const permissions = (await client.query(`
      select r.name, array_agg(p.action order by p.action) actions
      from up_permissions p
      join up_permissions_role_lnk l on l.permission_id = p.id
      join up_roles r on r.id = l.role_id
      where p.action like 'api::transport-workbench.%'
      group by r.name order by r.name`)).rows;
    assert.deepEqual(permissions.map((row) => row.name), ['Administrator', 'LGU']);
    assert.ok(permissions.every((row) => row.actions.length === 4));
    const direct = (await client.query(`
      select v.variant_code, v.geometry_geojson, array_agg(s.sequence order by s.sequence) sequences
      from route_variants v
      join route_variant_stops_route_variant_lnk l on l.route_variant_id = v.id
      join route_variant_stops s on s.id = l.route_variant_stop_id
      where v.variant_code in ('RCH-SJ-SMROB-OUT', 'RCH-SJ-SMROB-IN')
      group by v.id, v.variant_code, v.geometry_geojson order by v.variant_code`)).rows;
    assert.equal(direct.length, 2);
    assert.deepEqual(direct.map((row) => row.sequences), [[1, 2], [1, 2]]);
    assert.ok(direct.every((row) => row.geometry_geojson === null));
    await client.query('rollback');
    console.log(`ok - Phase 21 read-only audit preserved pilot digest ${EXPECTED_DIGEST}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
