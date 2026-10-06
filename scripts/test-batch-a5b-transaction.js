'use strict';
const assert = require('node:assert/strict');
const { connect } = require('./seed-phase5b-transfer-research');
const { loadApprovedCandidates, databaseSnapshot, application } = require('./apply-batch-a5b-approved-geometry');
async function main() {
  const client = await connect();
  try {
    const candidates = loadApprovedCandidates();
    const baseline = await databaseSnapshot(client);
    await client.query('begin');
    const once = await application(client, candidates, { apply: true });
    const twice = await application(client, candidates, { apply: true });
    assert.ok(once.rows_changed.length === 12 || once.rows_changed.length === 0);
    assert.equal(twice.rows_changed.length, 0);
    assert.equal(twice.before.snapshot.hash, twice.after.snapshot.hash);
    assert.ok(twice.plans.every(p => p.action === 'UNCHANGED'));
    await client.query('rollback');
    assert.deepEqual(await databaseSnapshot(client), baseline);
    console.log('PASS: transactional application and repeat are idempotent; rollback restores all database rows and sequences');
    // On the pre-application state, inject a failure after earlier UPDATEs.
    if (once.rows_changed.length) {
      await client.query('begin');
      const failingClient = { query: async (sql, params) => {
        if (sql.startsWith('update route_variant_stops') && params[1] === candidates[1].definition.stop_ids[1]) throw new Error('SYNTHETIC_MID_APPLY_FAILURE');
        return client.query(sql, params);
      } };
      await assert.rejects(application(failingClient, candidates, { apply: true }), /SYNTHETIC_MID_APPLY_FAILURE/);
      await client.query('rollback');
      assert.deepEqual(await databaseSnapshot(client), baseline);
      console.log('PASS: injected mid-application failure fully rolls back earlier updates; no partial geometry or distance persists');
    }
  } finally { await client.query('rollback'); await client.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
