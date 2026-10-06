'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connect } = require('./seed-phase5b-transfer-research');
const manifest = require('./data/batch-a-mexico-san-fernando-research.json');

const TABLES = new Set(['routes', 'route_variants', 'route_variant_stops',
  'route_variants_route_lnk', 'route_variants_start_node_lnk', 'route_variants_end_node_lnk',
  'route_variant_stops_route_variant_lnk', 'route_variant_stops_transport_node_lnk']);
const NOTES = 'Research-only Batch A corridor. Exact service, stop permissions, vehicle type and road distance/geometry need field verification. No eligibility promotion.';
const JEEP_MODES = new Set(['PUJ_TRADITIONAL', 'PUJ_MODERN']);
const evidence = {
  planning_enabled: false, verification_status: 'RESEARCH_CANDIDATE', data_mode: 'REAL',
  verified_at: null, source_name: manifest.source_name, source_reference: manifest.source_reference, notes: NOTES,
};

async function insert(client, table, values) {
  assert.ok(TABLES.has(table));
  const fields = Object.keys(values);
  assert.ok(fields.every((key) => /^[a-z_]+$/.test(key)));
  const sql = `insert into ${table} (${fields.join(',')}) values (${fields.map((_, i) => `$${i + 1}`).join(',')}) returning *`;
  return (await client.query(sql, Object.values(values))).rows[0];
}

function record(values) {
  return { document_id: crypto.randomBytes(12).toString('hex'), ...values,
    created_at: new Date(), updated_at: new Date(), published_at: new Date() };
}

async function inventory(client) {
  const routes = (await client.query('select * from routes order by id')).rows;
  const nodes = (await client.query('select * from transport_nodes order by id')).rows;
  const variants = (await client.query(`select v.*, r.route_code, r.transport_mode,
    a.node_code from_code, b.node_code to_code from route_variants v
    left join route_variants_route_lnk rl on rl.route_variant_id=v.id left join routes r on r.id=rl.route_id
    left join route_variants_start_node_lnk al on al.route_variant_id=v.id left join transport_nodes a on a.id=al.transport_node_id
    left join route_variants_end_node_lnk bl on bl.route_variant_id=v.id left join transport_nodes b on b.id=bl.transport_node_id
    order by v.id`)).rows;
  return { routes, nodes, variants };
}

function one(rows, field, value) {
  const matches = rows.filter((row) => row[field] === value);
  assert.ok(matches.length <= 1, `Duplicate ${field}: ${value}`);
  return matches[0];
}

function expansionPlan(state) {
  const routes = [...state.routes];
  const actions = [];
  for (const wanted of manifest.routes) {
    const byCode = one(routes, 'route_code', wanted.route_code);
    const equivalents = state.variants.filter((v) => v.from_code === 'RCH-PSU-MEXICO-FRONT'
      && v.to_code === 'RCH-MEXICO-BAYAN-STA-MONICA-TRANSFER' && JEEP_MODES.has(v.transport_mode));
    assert.ok(equivalents.length <= 1, 'Ambiguous existing local jeep services; manual audit required');
    const equivalent = equivalents[0];
    const modeMatches = (r) => wanted.transport_mode ? r.transport_mode === wanted.transport_mode
      : r.transport_mode == null || JEEP_MODES.has(r.transport_mode);
    const existing = byCode || routes.find((r) => r.route_code === equivalent?.route_code)
      || routes.find((r) => modeMatches(r) && r.origin === wanted.origin && r.destination === wanted.destination);
    if (existing) assert.ok(modeMatches(existing), 'Route code conflicts with vehicle mode');
    const route = existing || { ...wanted, id: null };
    routes.push({ ...route, requested_code: wanted.route_code });
    actions.push({ entity: 'route', action: existing ? 'UNCHANGED' : 'CREATE_RESEARCH', code: route.route_code, data: wanted });
  }
  for (const wanted of manifest.variants) {
    const route = routes.find((r) => r.requested_code === wanted.route_code) || one(routes, 'route_code', wanted.route_code);
    assert.ok(route, `Missing existing route: ${wanted.route_code}`);
    assert.ok(one(state.nodes, 'node_code', wanted.from) && one(state.nodes, 'node_code', wanted.to), 'Missing existing pilot node');
    const byCode = one(state.variants, 'variant_code', wanted.variant_code);
    if (byCode) assert.ok(byCode.from_code === wanted.from && byCode.to_code === wanted.to
      && byCode.route_code === route.route_code, 'Variant code conflicts with corridor');
    const equivalents = state.variants.filter((v) => v.from_code === wanted.from && v.to_code === wanted.to
      && (v.route_code === route.route_code || JEEP_MODES.has(v.transport_mode)));
    assert.ok(equivalents.length <= 1, 'Ambiguous equivalent variants; manual audit required');
    const existing = byCode || equivalents[0];
    actions.push({ entity: 'variant', action: existing ? 'UNCHANGED' : 'CREATE_RESEARCH',
      code: existing?.variant_code || wanted.variant_code, routeCode: route.route_code,
      stopCount: existing ? 0 : 2, data: wanted });
  }
  return actions;
}

// Caller owns the transaction. No existing row is updated or deleted.
async function seed(client, { apply = false } = {}) {
  if (apply) {
    await client.query("set local lock_timeout = '5s'");
    await client.query("set local statement_timeout = '30s'");
    await client.query("select pg_advisory_xact_lock(hashtext('pamana-batch-a-research'))");
    await client.query(`lock table ${[...TABLES].join(',')}, transport_nodes in share row exclusive mode`);
  }
  const state = await inventory(client);
  const actions = expansionPlan(state);
  if (!apply) return actions;
  const routes = new Map(state.routes.map((r) => [r.route_code, r]));
  const nodes = new Map(state.nodes.map((n) => [n.node_code, n]));
  for (const action of actions) {
    if (action.action !== 'CREATE_RESEARCH') continue;
    if (action.entity === 'route') {
      const route = await insert(client, 'routes', record({ ...action.data, ...evidence, active: false, route_status: 'inactive' }));
      routes.set(action.code, route);
      continue;
    }
    const { route_code, from, to, instruction, ...data } = action.data;
    const variant = await insert(client, 'route_variants', record({ ...data, ...evidence,
      operating_status: 'UNKNOWN', geometry_source: 'UNKNOWN' }));
    await insert(client, 'route_variants_route_lnk', { route_variant_id: variant.id, route_id: routes.get(action.routeCode).id });
    for (const [endpoint, code] of [['start', from], ['end', to]]) {
      await insert(client, `route_variants_${endpoint}_node_lnk`, { route_variant_id: variant.id, transport_node_id: nodes.get(code).id });
    }
    for (const [index, code] of [from, to].entries()) {
      const stop = await insert(client, 'route_variant_stops', record({ sequence: index + 1,
        pickup_allowed: index === 0, dropoff_allowed: index === 1,
        transfer_allowed: code === 'RCH-MEXICO-BAYAN-STA-MONICA-TRANSFER',
        is_timepoint: false, instruction_template: index === 0 ? instruction : null }));
      await insert(client, 'route_variant_stops_route_variant_lnk', { route_variant_stop_id: stop.id, route_variant_id: variant.id });
      await insert(client, 'route_variant_stops_transport_node_lnk', { route_variant_stop_id: stop.id, transport_node_id: nodes.get(code).id });
    }
  }
  return actions;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const client = await connect();
  try {
    await client.query(apply ? 'begin' : 'begin read only');
    const actions = await seed(client, { apply });
    await client.query(apply ? 'commit' : 'rollback');
    console.log(JSON.stringify({ mode: apply ? 'APPLIED_RESEARCH_ONLY' : 'DRY_RUN',
      records: actions.map(({ data, ...action }) => action), updates: 0, deletions: 0, newNodes: 0, newFareRules: 0 }, null, 2));
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally { await client.end(); }
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { manifest, evidence, inventory, expansionPlan, seed };
