'use strict';

// Dry run: node --env-file=.env scripts/remove-simulated-passenger-reports.js
// Apply:   node --env-file=.env scripts/remove-simulated-passenger-reports.js --apply
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { connect } = require('./seed-phase5b-transfer-research');

const LINK_TABLES = [
  'passenger_reports_passenger_lnk', 'passenger_reports_route_lnk',
  'passenger_reports_stop_lnk', 'passenger_reports_vehicle_lnk',
  'passenger_reports_route_variant_lnk', 'passenger_reports_transport_node_lnk',
  'passenger_reports_trip_lnk',
];

async function main() {
  const apply = process.argv.includes('--apply');
  const client = await connect();
  try {
    await client.query(apply ? 'begin' : 'begin read only');
    await client.query("set local statement_timeout = '10s'");
    await client.query("set local lock_timeout = '3s'");
    const reports = (await client.query(
      `select * from passenger_reports where data_mode = $1 order by id${apply ? ' for update' : ''}`,
      ['SIMULATED'],
    )).rows;
    const ids = reports.map(report => report.id);
    if (!apply || !ids.length) {
      await client.query('rollback');
      console.log(JSON.stringify({ apply, simulatedReports: ids.length, removed: 0 }));
      return;
    }

    // Save full records and their relation links before the cascading delete.
    const links = {};
    for (const table of LINK_TABLES) {
      if ((await client.query('select to_regclass($1) as name', [table])).rows[0].name) {
        links[table] = (await client.query(
          `select * from ${table} where passenger_report_id = any($1::int[]) order by id`, [ids],
        )).rows;
      }
    }
    const realBefore = (await client.query(
      'select * from passenger_reports where data_mode = $1 order by id', ['REAL'],
    )).rows;
    const backupDirectory = path.join(__dirname, '../.tmp/report-history-backups');
    fs.mkdirSync(backupDirectory, { recursive: true });
    const backup = path.join(backupDirectory, `simulated-reports-${Date.now()}.json`);
    fs.writeFileSync(backup, JSON.stringify({ reports, links }, null, 2), { flag: 'wx' });

    const removed = await client.query(
      'delete from passenger_reports where id = any($1::int[]) and data_mode = $2 returning id',
      [ids, 'SIMULATED'],
    );
    assert.equal(removed.rowCount, ids.length);
    const realAfter = (await client.query(
      'select * from passenger_reports where data_mode = $1 order by id', ['REAL'],
    )).rows;
    assert.deepEqual(realAfter, realBefore, 'Real reports must remain unchanged');
    await client.query('commit');
    console.log(JSON.stringify({ removed: removed.rowCount, realReportsPreserved: realAfter.length, backup }));
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
