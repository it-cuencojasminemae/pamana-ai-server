'use strict';

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { connect } = require('./seed-phase5b-transfer-research');
const { counts, digest } = require('./activate-pilot-field-verified');
const { DEFAULT_PROVIDER } = require('../src/services/pamana-ai/providers');
const { isDemoModeEnabled } = require('../src/services/pamana-demo/demo-config');
const { normalizeEligibleNode } = require('../src/services/pamana-journey/access-node-finder');

const EXPECTED_DIGEST = '3d63fcdb5d9581d71e2c68d54db9c00868510dcc9b91e6e38fcb893373af9139';
const ROLES = ['Passenger', 'Driver', 'LGU', 'Administrator'];
const present = value => typeof value === 'string' && Boolean(value.trim());
function configurationStatus(backend, frontend) {
  const provider = String(backend.AI_PROVIDER || DEFAULT_PROVIDER).trim().toLowerCase();
  const valid = ['gemini', 'openai'].includes(provider);
  const aiKey = provider === 'gemini' ? backend.GEMINI_API_KEY : provider === 'openai' ? backend.OPENAI_API_KEY : null;
  return {
    geoapifyBrowser: present(frontend.NUXT_PUBLIC_GEOAPIFY_API_KEY) ? 'CONFIGURED' : 'NOT_CONFIGURED',
    geoapifyWalking: present(backend.GEOAPIFY_SERVER_API_KEY) ? 'CONFIGURED' : 'NOT_CONFIGURED',
    ai: valid && present(aiKey) ? `${provider.toUpperCase()} CONFIGURED` : 'NOT_CONFIGURED',
    aiModel: valid ? (present(backend[`${provider.toUpperCase()}_MODEL`]) ? 'EXPLICIT_MODEL' : 'PROVIDER_DEFAULT') : 'INVALID_PROVIDER',
    demoBackend: isDemoModeEnabled(backend) ? 'ENABLED' : 'DISABLED',
    demoFrontend: String(frontend.NUXT_PUBLIC_PAMANA_DEMO_MODE_ENABLED || '').trim().toLowerCase() === 'true' ? 'ENABLED' : 'DISABLED',
    providerNetworkTested: false,
  };
}
async function reachable(url, fetcher = fetch) {
  try { const response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) }); return response.status >= 200 && response.status < 400 ? 'REACHABLE' : 'UNAVAILABLE'; }
  catch { return 'UNAVAILABLE'; }
}
async function databaseStatus(client) {
  await client.query('begin read only');
  try {
    const current = await counts(client);
    const currentDigest = await digest(client);
    const eligibleNodes = (await client.query('select * from transport_nodes where planning_enabled')).rows.filter(node => normalizeEligibleNode(node) !== null);
    const roles = (await client.query(`select r.name role, count(u.id)::int enabled_accounts
      from up_roles r left join up_users_role_lnk ur on ur.role_id=r.id
      left join up_users u on u.id=ur.user_id and not u.blocked
      where r.name=any($1::text[]) group by r.name`, [ROLES])).rows;
    const planning = { routes: current.planning_routes, routeVariants: current.planning_variants, eligibleCoordinateNodes: eligibleNodes.length };
    return {
      postgresql: 'REACHABLE', pilot: currentDigest === EXPECTED_DIGEST && planning.routes === 3 && planning.routeVariants === 4 && planning.eligibleCoordinateNodes === 4 ? 'MATCH' : 'MISMATCH',
      digest: currentDigest, planning,
      roles: Object.fromEntries(ROLES.map(role => [role, Number(roles.find(item => item.role === role)?.enabled_accounts || 0) > 0 ? 'ACCOUNT_EXISTS' : 'MISSING_ACCOUNT'])),
    };
  } finally { await client.query('rollback'); }
}
async function check({ backend = process.env, frontend, connection = connect, fetcher = fetch } = {}) {
  if (!frontend) {
    const file = path.resolve(__dirname, '../../pamana-frontend/.env');
    frontend = { ...(fs.existsSync(file) ? dotenv.parse(fs.readFileSync(file)) : {}), ...Object.fromEntries(Object.entries(process.env).filter(([name]) => name.startsWith('NUXT_PUBLIC_'))) };
  }
  const status = configurationStatus(backend, frontend);
  const [backendHttp, frontendHttp] = await Promise.all([
    reachable(`${backend.PAMANA_API_URL || 'http://127.0.0.1:1337'}/_health`, fetcher),
    reachable(`${backend.PAMANA_FRONTEND_URL || 'http://localhost:3000'}/login`, fetcher),
  ]);
  let client, database;
  try { client = await connection(); database = await databaseStatus(client); }
  catch { database = { postgresql: 'UNAVAILABLE', pilot: 'NOT_CHECKED' }; }
  finally { if (client) await client.end(); }
  const mandatory = backendHttp === 'REACHABLE' && frontendHttp === 'REACHABLE' && database.pilot === 'MATCH' && ROLES.every(role => database.roles?.[role] === 'ACCOUNT_EXISTS');
  const simulationReady = status.demoBackend === 'ENABLED' && status.demoFrontend === 'ENABLED';
  return { status: mandatory ? 'CORE_READY' : 'ACTION_REQUIRED', backend: backendHttp, frontend: frontendHttp, ...database, providers: status,
    simulationReady, fullDemoConfigurationReady: mandatory && simulationReady && status.geoapifyBrowser === 'CONFIGURED' && status.geoapifyWalking === 'CONFIGURED' && status.ai !== 'NOT_CONFIGURED',
    notes: ['Configuration presence does not prove provider authorization, model availability or quota.', 'Phase 24.5 remains OPEN; REAL Driver assignment and HTTPS GPS acceptance are separate.', 'No paid provider request or database mutation was performed.'] };
}
if (require.main === module) check().then(result => { console.log(JSON.stringify(result, null, 2)); if (result.status !== 'CORE_READY') process.exitCode = 1; }).catch(() => { console.error('Pre-demo check unavailable. Details withheld.'); process.exitCode = 1; });
module.exports = { check, configurationStatus, databaseStatus, reachable, EXPECTED_DIGEST };
