# PAMANA backend deployment preparation

Current target: Nuxt on Vercel, Strapi 5.52.1 on Render, PostgreSQL on Neon.
The source remains a standard Strapi project, portable to Strapi Cloud. Hosting
choices live in environment variables and service settings. Application source
requires neither a Render/Neon hostname, Docker, nor `render.yaml`. The former
Northflank preparation note is retained locally as historical evidence.

## Generic Strapi requirements

Use `npm ci` and the committed npm lockfile; never copy `node_modules` manually.
`.node-version` pins locally validated Node 24.15.0; select supported Node 24 on
each host. Standard scripts remain `npm run build` and `npm run start`.

PowerShell validation:

```powershell
node 'C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js' ci
$env:NODE_ENV='production'
node 'C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js' run build
```

Set `PUBLIC_URL` to the actual public backend HTTPS origin at build and runtime.
Configure `HOST`, `PORT`, `IS_PROXIED`, `MAX_IPS_COUNT` for the host's topology.
Validate the trusted proxy count with actual forwarded headers; do not assume
one hop is correct everywhere. URL changes require an admin rebuild. See
[Strapi server configuration](https://docs.strapi.io/cms/configurations/server).

Secret variable names: `APP_KEYS`, `ADMIN_JWT_SECRET`, `API_TOKEN_SALT`,
`TRANSFER_TOKEN_SALT`, `JWT_SECRET`, `ENCRYPTION_KEY`, `OPENAI_API_KEY`.
Supply private values via host secret settings. Never copy example placeholders
into production or expose backend secrets to frontend public configuration.

Set `DATABASE_CLIENT=postgres` and either `DATABASE_URL` or the complete
`DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USERNAME`,
`DATABASE_PASSWORD` set. Optional controls: `DATABASE_SCHEMA`,
`DATABASE_POOL_MIN`, `DATABASE_POOL_MAX`, `DATABASE_CONNECTION_TIMEOUT`,
`DATABASE_SSL`, `DATABASE_SSL_CA`, `DATABASE_SSL_REJECT_UNAUTHORIZED`.
SQLite/MySQL drivers are not installed; explicitly select PostgreSQL here.

This deployment uses `AI_PROVIDER=openai`; `OPENAI_MODEL` is optional.
`gemini` remains an explicit alternative using `GEMINI_API_KEY` / `GEMINI_MODEL`.
There is no automatic provider fallback. Missing AI configuration leaves
deterministic planning available. `GEOAPIFY_SERVER_API_KEY` enables walking
access/egress; missing configuration produces honest unavailable states.
Keep `DEMO_MODE` and `PAMANA_DEMO_MODE_ENABLED` aligned with verified data and
the intended nonpersistent demo; clients cannot enable server-owned gates.

## Generic CORS and session behavior

PAMANA uses an HttpOnly refresh cookie; the Nuxt API client sends credentials.
Set `CORS_ORIGINS` to exact frontend origins, comma-separated if necessary.
Wildcard origins are rejected. CORS does not replace authentication or roles.

Local HTTP defaults: `SESSION_COOKIE_SAME_SITE=lax`, secure false. Production
defaults: lax, secure true. For HTTPS frontend/backend on different sites use
`SESSION_COOKIE_SAME_SITE=none` and `SESSION_COOKIE_SECURE=true`.
Cookies remain HttpOnly, host-only, path `/`. Login, refresh, custom registration
and logout share that policy. Insecure cross-site configuration fails at startup.
Do not copy local cookie settings into production unchanged.

Browsers blocking third-party cookies can still prevent refresh between
`vercel.app` and `onrender.com`, despite correct CORS and cookie attributes.
Test actual browsers with those cookies blocked. Same-site HTTPS custom domains
or a separately reviewed frontend proxy are possible follow-ups; neither is
implemented here. See [MDN third-party cookies](https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/Third-party_cookies).

## Render-specific service settings

Create a native Node web service from the reviewed branch after push approval.
Root directory is this repository's root.

| Setting | Value |
| --- | --- |
| Build | `npm ci && npm run build` |
| Start | `npm run start` |
| Health | `/_health` (HTTP 204) |
| Node | Node 24, `.node-version` pin |
| Environment | `NODE_ENV=production`, `HOST=0.0.0.0` |
| Port | Render's supplied `PORT` |
| Public origin | Actual backend HTTPS origin in `PUBLIC_URL` |
| Proxy | `IS_PROXIED=true`, verified `MAX_IPS_COUNT` |

Keep build/runtime variables consistent and provide memory for the admin build.
No platform flag or blueprint is required. See [Render web services](https://render.com/docs/web-services)
and [Node version selection](https://render.com/docs/node-version).

The local upload provider is unchanged. PAMANA schemas contain no media fields
and current frontend flows do not use Media Library uploads. Render storage is
ephemeral; do not promise persistent uploads. If media becomes required, review
durable storage before launch. Deploying schema/source does not transfer local
content, users or approved pilot rows to Neon. Plan a separately authorized data
transfer; never commit a dump. See [Render Strapi storage/content guidance](https://render.com/docs/deploy-strapi).

## Neon-specific database settings

Use Neon-provided settings and a role permitted to run normal Strapi schema
synchronization. Use verified TLS: `DATABASE_SSL=true` and
`DATABASE_SSL_REJECT_UNAUTHORIZED=true` with explicit connection variables, or a
URL configured for equivalent certificate verification. Do not disable TLS
verification merely to silence a connection error.

URL parameters `sslmode`, `sslcert`, `sslkey`, `sslrootcert` replace node-postgres
SSL options; avoid competing configuration sources. Verify the chosen driver's
TLS behavior rather than assuming both configurations combine. See
[node-postgres TLS configuration](https://node-postgres.com/features/ssl).

Prefer a direct endpoint for initial schema synchronization/migration; evaluate
pooler compatibility separately. Bound `DATABASE_POOL_MAX` to the connection
budget across replicas and administrative clients. Choose nearby regions. No
Neon or production-target database is used by local validation.

## Strapi Cloud-specific future deployment

Connect the same GitHub repository, select the branch/base directory, and choose
supported Node 24 in the Cloud dashboard. The npm lockfile remains present.
Change environment secrets, `PUBLIC_URL`, CORS origins and cookie policy for
new origins. Application code does not require Render deployment files. See
[Cloud Git deployment](https://docs.strapi.io/cloud/getting-started/deployment)
and [Cloud project settings](https://docs.strapi.io/cloud/projects/settings).

For Cloud managed PostgreSQL, remove custom `DATABASE_*` settings to allow Cloud
to inject its defaults. Adding any such variable selects an external database
and suppresses the managed DB variables; configure the complete external
connection if retaining Neon. See [Cloud database configuration](https://docs.strapi.io/cloud/advanced/database).

Cloud requires middleware overrides in `config/env/production/middlewares.js`.
Both production and global entry points call the same source-owned factory,
preserving exact CORS origins, request limits and ordering on all hosts. See
[Cloud middleware configuration](https://docs.strapi.io/cloud/advanced/middlewares).
The local upload provider remains eligible for Cloud; future external storage
needs its own configuration review. See [Cloud upload configuration](https://docs.strapi.io/cloud/advanced/upload).

## Dependency security review

Strapi stays on 5.52.1. The lockfile resolves Express's existing `^2.0.7`
range to `proxy-addr` 2.0.8 without an override. The upload package pins Sharp
exactly, so the only override is `@strapi/upload@5.52.1` → `sharp` 0.35.4.
Its platform binaries follow that patch. Both changes were tested in isolation
before the original repository, including native image processing. See the
[proxy advisory](https://github.com/advisories/GHSA-jqcg-44mw-7w3h) and
[Sharp advisory](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c).

The production dependency audit still has findings; preview readiness does not
mean a zero-finding audit. Review these remaining high-severity paths:

| Package | Exposure / follow-up |
| --- | --- |
| Nodemailer 9.0.1 | Runtime account-email provider. No SMTP provider is configured here; the default sendmail path still composes mail. Fixing every advisory requires Nodemailer 10.0.6, a major change outside this preparation. Review provider compatibility before relying on public email workflows. |
| Axios 1.19.0 | Strapi admin and Cloud CLI dependency. PAMANA does not use it for public outbound requests; advisory-specific adapter/input exposure remains a framework review item. 1.20.0 is a compatible minor candidate, but exact framework pins require separate integration review. |
| Undici 6.28.0 | Strapi core dependency. Core uses Node's global fetch; this package supplies an optional fetch proxy. PAMANA does not enable its WebSocket or retry-interceptor paths. 6.28.1 is a compatible patch candidate; defer unrelated optional-path changes. |
| fast-uri 3.1.6 | AJV/framework schema tooling; no PAMANA URI-based authorization uses it. 3.1.8 is a compatible patch candidate. Custom schema/import reachability needs further review. |
| js-yaml 4.3.1 | Configuration/tooling loader; no public YAML importer. 4.3.2 is a compatible patch candidate. |
| brace-expansion 1.1.18 / 5.0.9; braces 3.0.3 | Glob/development tooling, with no public glob-pattern endpoint. Review nested callers before further changes. |
| source-map-js 1.2.1 | Build/source-map tooling; no public source-map parser. 1.2.2 is a compatible patch candidate. |
| Vite 5.4.21; webpack-dev-middleware 6.1.3 | Development servers. Production must use the compiled build with `npm run start`; do not expose these development servers. |

Other high package records propagate these advisories through Strapi parents;
they are not separate proven PAMANA exploits. These exposure assessments are
source-review inferences, not exploit demonstrations. Keep preview access
controlled and schedule framework/security follow-up. Never accept npm's
Strapi 4 downgrade recommendation or use `npm audit fix --force`.

## Portable validation and historical tools

`npm run test:batch-a:regressions` runs portable backend tests without `.env`,
generated reports, sibling repositories or paid API calls. Viewer tests inject
tiny vendor-serving mocks; real MapLibre is optional manual tooling. Explicit
sibling integration: `node scripts/test-phase-1-no-legacy-defaults.js --frontend`.
The paid-provider check is `npm run smoke:ai-provider`, outside regressions.

`npm run test:batch-a5b:regressions` requires the prepared LOCAL PostgreSQL pilot.
It includes read-only checks, temporary tables and existing idempotent Strapi
bootstrap. Never aim it casually at production. Historical geometry application
tools still require the original private review report and frozen checksum;
portable artifact verification never authorizes applying geometry.

Receipts/checkpoints/API captures/generated validation JSON, `.env`, `.tmp`
recovery copies, database dumps and `.tmp/northflank-npm-audit.json` stay local.
Reviewed GeoJSON and source manifests remain legitimate project data. Review
exact staged paths and `git diff --check` before commits. Review
`npm audit --omit=dev` separately; no automatic fixes, Strapi downgrade or major
remediation changes are authorized by this preparation workflow.
