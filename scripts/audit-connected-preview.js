'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { connect } = require('./seed-phase5b-transfer-research');
const { transportDigest, TABLES } = require('./activate-san-fernando-expansion');
const manifest = require('../src/services/pamana-journey/data/connected-research-manifest.json');
(async () => {
  const client = await connect();
  try {
    const report = { executedAt: new Date().toISOString(), transportDigest: await transportDigest(client), counts: {}, reusedInventory: [], permissions: [] };
    for (const table of TABLES) report.counts[table] = Number((await client.query(`select count(*) n from ${table}`)).rows[0].n);
    report.reusedInventory = (await client.query('select node_code,name,node_type,latitude,longitude,planning_enabled,verification_status,data_mode from transport_nodes where node_code=any($1::text[]) order by node_code', [manifest.nodes.map(n => n.node_code)])).rows;
    report.permissions = (await client.query("select r.name role,p.action from up_roles r join up_permissions_role_lnk l on l.role_id=r.id join up_permissions p on p.id=l.permission_id where p.action in ('api::pamana-ai.planning-capabilities.find','api::pamana-ai.journey-details.create') order by r.name,p.action")).rows;
    const baseline = JSON.parse(fs.readFileSync('documentation/connected-runtime-results.json'));
    report.transportUnchanged = report.transportDigest === baseline.transportDigestBefore;
    assert.equal(report.transportUnchanged, true);
    fs.writeFileSync('documentation/connected-database-audit.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally { await client.end(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
