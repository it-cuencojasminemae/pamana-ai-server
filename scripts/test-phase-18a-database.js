'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connect, snapshot } = require('./seed-phase5b-transfer-research');

const EXPECTED_TRANSPORT_DIGEST = require('./helpers/pilot-geometry-expectations').EXPECTED_DIGEST;

async function main() {
  const client = await connect();
  try {
    await client.query('begin read only');
    const disruptionRows = (await client.query('select * from disruptions order by id')).rows;
    const disruptionDigest = crypto.createHash('sha256').update(JSON.stringify(disruptionRows)).digest('hex');
    const columns = (await client.query(`
      select column_name, is_nullable, column_default
      from information_schema.columns
      where table_schema = current_schema() and table_name = 'disruptions'`)).rows;
    const byName = Object.fromEntries(columns.map((column) => [column.column_name, column]));
    for (const name of [
      'effect', 'planning_enabled', 'verification_status', 'verified_at',
      'source_name', 'source_url', 'source_reference', 'notes', 'resolved_at',
      'resolution_notes', 'geometry_source', 'geometry_geojson',
    ]) assert.ok(byName[name], `missing disruptions.${name}`);
    assert.equal(byName.planning_enabled.is_nullable, 'NO');
    assert.match(byName.planning_enabled.column_default || '', /false/);
    assert.equal(byName.verification_status.is_nullable, 'NO');
    assert.match(byName.verification_status.column_default || '', /RESEARCH_CANDIDATE/);
    assert.equal(byName.geometry_source.is_nullable, 'NO');
    assert.match(byName.geometry_source.column_default || '', /UNKNOWN/);

    const relationTargets = (await client.query(`
      select distinct ccu.table_name as target_table
      from information_schema.table_constraints tc
      join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
      where tc.table_schema = current_schema()
        and tc.constraint_type = 'FOREIGN KEY'
        and tc.table_name like 'disruptions%lnk'
      order by ccu.table_name`)).rows.map((row) => row.target_table);
    for (const target of ['routes', 'route_variants', 'transport_nodes']) {
      assert.ok(relationTargets.includes(target), `missing explicit disruption relation to ${target}`);
    }
    const relationIndexes = (await client.query(`
      select tc.table_name, kcu.column_name,
        exists (
          select 1 from pg_indexes i
          where i.schemaname = current_schema()
            and i.tablename = tc.table_name
            and i.indexdef ilike '%(' || kcu.column_name || '%'
        ) as indexed
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on kcu.constraint_name = tc.constraint_name
        and kcu.constraint_schema = tc.constraint_schema
      where tc.constraint_type = 'FOREIGN KEY'
        and tc.table_schema = current_schema()
        and tc.table_name like 'disruptions%lnk'`)).rows;
    assert.ok(relationIndexes.length >= 6);
    assert.ok(relationIndexes.every((relation) => relation.indexed), 'every disruption relation FK must be indexed');

    const roleActions = (await client.query(`
      select r.name, p.action
      from up_permissions p
      join up_permissions_role_lnk link on link.permission_id = p.id
      join up_roles r on r.id = link.role_id
      where p.action in (
        'api::disruption.disruption.create', 'api::disruption.disruption.update',
        'api::disruption.disruption.find', 'api::disruption.disruption.findOne',
        'api::disruption.disruption.options'
      )
      order by p.action, r.name`)).rows;
    for (const action of ['create', 'update', 'options']) {
      const roles = roleActions.filter((row) => row.action.endsWith(`.${action}`)).map((row) => row.name);
      assert.deepEqual(roles, ['Administrator', 'LGU'], `${action} disruption permission`);
    }
    for (const action of ['find', 'findOne']) {
      const roles = roleActions.filter((row) => row.action.endsWith(`.${action}`)).map((row) => row.name);
      assert.ok(roles.includes('Administrator') && roles.includes('LGU'), `${action} management read permission`);
    }
    const writers = roleActions
      .filter((row) => row.action.endsWith('.create') || row.action.endsWith('.update'))
      .map((row) => row.name);
    assert.ok(!writers.includes('Passenger') && !writers.includes('Driver') && !writers.includes('Public'));

    const counts = (await client.query(`
      select
        (select count(*)::int from disruptions) disruptions,
        (select count(*)::int from disruptions where planning_enabled is true) planning_disruptions,
        (select count(*)::int from routes where planning_enabled is true) planning_routes,
        (select count(*)::int from route_variants where planning_enabled is true) planning_variants,
        (select count(*)::int from transport_nodes where planning_enabled is true) planning_nodes`)).rows[0];
    assert.equal(counts.planning_disruptions, 0);
    assert.equal(counts.planning_routes, 3);
    assert.equal(counts.planning_variants, 4);
    assert.equal(counts.planning_nodes, 4);

    const transportDigest = crypto.createHash('sha256').update(JSON.stringify(await snapshot(client))).digest('hex');
    assert.equal(transportDigest, EXPECTED_TRANSPORT_DIGEST);
    assert.deepEqual((await client.query('select * from disruptions order by id')).rows, disruptionRows);
    console.log(`Disruption rows: ${counts.disruptions}; digest: ${disruptionDigest}`);
    console.log(`Transport row digest: ${transportDigest}`);
    console.log('ok - Phase 18A schema is additive, disruption rows are preserved, and pilot planning remains unchanged');
    console.log('ok - only LGU and Administrator can use structured options or manage disruptions');
  } finally {
    await client.query('rollback');
    await client.end();
  }
}

main().catch((error) => {
  console.error(`FAIL: ${error.stack || error.message}`);
  process.exitCode = 1;
});
