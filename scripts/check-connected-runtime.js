'use strict';
const fs = require('node:fs');
const { compileStrapi, createStrapi } = require('@strapi/strapi');
const { connect } = require('./seed-phase5b-transfer-research');
const { transportDigest } = require('./activate-san-fernando-expansion');
const { orchestrateTripPlan } = require('../src/services/pamana-journey/trip-plan-orchestrator');
const { validateTripPlanRequest } = require('../src/services/pamana-journey/trip-plan-request-validator');
const { planningContext } = require('../src/services/pamana-journey/planning-context');
const { cases } = require('./helpers/connected-acceptance-cases');
async function main() {
  const audit = await connect(); let app;
  const report = { executedAt: new Date().toISOString(), kind: 'REAL_DATABASE_AND_GEOAPIFY_SERVICE_CHECK_NOT_UI', cases: [] };
  try {
    report.transportDigestBefore = await transportDigest(audit);
    app = await createStrapi(await compileStrapi()).load();
    for (const example of cases) {
      const context = planningContext('RESEARCH_PREVIEW');
      const validation = validateTripPlanRequest(example.request, { now: () => new Date(example.request.departureAt), context });
      const start = Date.now();
      const response = validation.ok ? await orchestrateTripPlan(validation.value, { strapiInstance: app, context }) : validation.error;
      report.cases.push({ id: example.id, request: example.request, elapsedMs: Date.now() - start, response });
      console.log(`${example.id}: ${response.status}; journeys=${response.journeys?.length || 0}; ${Date.now() - start}ms; warnings=${response.warnings?.join(',') || ''}`);
    }
    report.transportDigestAfter = await transportDigest(audit);
    report.transportUnchanged = report.transportDigestBefore === report.transportDigestAfter;
    fs.writeFileSync('documentation/connected-runtime-results.json', JSON.stringify(report, null, 2) + '\n');
    console.log(`Transport unchanged: ${report.transportUnchanged}`);
  } finally { if (app) await app.destroy(); await audit.end(); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
