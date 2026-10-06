'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const scripts = require('../package.json').scripts;
const database = process.argv.includes('--database');
const selected = Object.entries(scripts).filter(([name]) => {
  if (!name.startsWith('test:') || name.endsWith(':regressions') || name === 'test:ai-provider') return false;
  const isDatabase = name.endsWith('-db') || name === 'test:phase-24-integration' || name === 'test:legacy-trip-search-route-data';
  return database === isDatabase;
});
const results = selected.map(([name, command]) => {
  if (!command.startsWith('node ')) throw new Error(`Unsupported test command: ${name}`);
  const started = Date.now();
  const result = spawnSync(process.execPath, command.slice(5).split(' '), {
    cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 180000,
    env: { ...process.env, STRAPI_TELEMETRY_DISABLED: 'true' },
  });
  const pass = result.status === 0;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} (${Date.now() - started}ms)`);
  if (!pass) console.log(result.stdout, result.stderr, result.error?.message || '');
  return { name, command, pass, exitCode: result.status, durationMs: Date.now() - started,
    output: `${result.stdout || ''}${result.stderr || ''}`.trim() };
});
const report = { generatedAt: new Date().toISOString(), group: database ? 'database' : 'unit',
  passed: results.filter(r => r.pass).length, failed: results.filter(r => !r.pass).length, results };
fs.writeFileSync(path.join(__dirname, '../documentation', `batch-a-${report.group}-validation.json`), `${JSON.stringify(report, null, 2)}\n`);
console.log(`${report.passed} passed; ${report.failed} failed`);
if (report.failed) process.exitCode = 1;
