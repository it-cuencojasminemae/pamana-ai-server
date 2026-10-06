'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
// Read-only database audits, approved-pilot test and existing real-loader
// integration. Phase 23 uses only session-local ON COMMIT DROP fixtures.
// Research insertion/activation seed tests are deliberately not run here.
const selected = ['test:phase-11-db', 'test:phase-12-db', 'test:phase-13-db', 'test:phase-14-db',
  'test:phase-16-db', 'test:phase-17-db', 'test:phase-18a-db', 'test:phase-18b-db',
  'test:phase-19-db', 'test:phase-21-db', 'test:phase-23-db', 'test:pilot-mexico-san-fernando-db',
  'test:phase-24-integration', 'test:batch-a5b-db'];
const scripts = require('../package.json').scripts;
const results = [];
for (const name of selected) {
  const command = scripts[name]; if (!command?.startsWith('node ')) throw new Error(`Missing regression command ${name}`);
  const result = spawnSync(process.execPath, command.slice(5).split(' '), { cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 180000,
    env: { ...process.env, STRAPI_TELEMETRY_DISABLED: 'true' } });
  const pass = result.status === 0; console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
  if (!pass) console.log(result.stdout, result.stderr);
  results.push({ name, command, pass, exit_code: result.status, output: `${result.stdout || ''}${result.stderr || ''}` });
}
const report = { checked_at: new Date().toISOString(), passed: results.filter(r => r.pass).length,
  failed: results.filter(r => !r.pass).length, excluded: 'Research insertion/activation tests: this phase must leave prepared research unapplied', results };
fs.writeFileSync(path.join(__dirname, '../documentation/batch-a5b-database-regressions.json'), JSON.stringify(report, null, 2) + '\n');
if (report.failed) process.exitCode = 1;
