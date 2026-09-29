# Phase 22 security, permissions, and privacy

Phase 22 makes the backend permission matrix an enforced server contract. The Strapi bootstrap reconciles every PAMANA-managed permission: it adds required grants and removes stale or accidental grants from Public, Authenticated, Passenger, Driver, LGU, and Administrator roles. Frontend route hiding is only a user-interface aid.

## Permission matrix

| Capability | Public | Authenticated | Passenger | Driver | LGU | Administrator |
| --- | --- | --- | --- | --- | --- | --- |
| Unified trip plan | No | No | Yes | No | Yes | Yes |
| Journey explanation | No | No | Yes | No | No | Yes |
| Own Passenger profile | No | No | Own only | No | No | No |
| Passenger reports | No | No | Create/read own | No | Review/read | Review/read |
| Real live-vehicle read | No | No | Yes | No | Yes | Yes |
| Server-enabled simulated feed | No | No | Read only | Read only | Read only | Read only |
| Driver trip/GPS/occupancy writes | No | No | No | Own assigned context only | No | No |
| Disruption writes | No | No | No | No | Limited management | Full trust management |
| Transport verification workbench | No | No | No | No | Conservative editing | Full trust editing |
| Transport knowledge writes | No | No | No | No | No | Yes |
| LGU analytics and report confidence | No | No | No | No | Yes | Yes |

The exact action lists live in `src/services/security/access-control.js`. Public and the generic Authenticated role receive no PAMANA API permission. Passenger self-registration is assigned to Passenger by the existing bootstrap setting.

## Ownership and write rules

- Passenger profiles are created for, listed for, read by, and updated by the authenticated Passenger only. A request cannot set the `user` relation.
- Passenger report creation resolves the caller's Passenger profile server-side. Passenger reads are filtered to that profile. Exact report coordinates and internal review notes are removed from Passenger responses. LGU and Administrator may review reports, but cannot change their Passenger owner or transport context.
- Driver trip creation uses the Driver profile and its assigned Vehicle. Trip update accepts only terminal status changes on that Driver's active Trip. GPS and occupancy writes require the same Driver, Vehicle, active Trip, and RouteVariant context.
- LGU workbench edits remain constrained by evidence and confirmation rules. Only Administrator can elevate planning trust fields or manage authoritative transport truth.
- Geoapify geographic results and approximate road paths remain presentation data. They do not become verified transport nodes or transit geometry through these endpoints.

## Endpoint and input protections

Sensitive controllers perform a role check in addition to Strapi action permissions. Request bodies reject unsupported top-level fields, unsupported data fields, invalid coordinates, and route-specific size limits. The global JSON, form, and text body limit is 256 KiB. The unified trip planner retains its stricter 8 KiB contract; AI explanations and workbench/disruption writes allow at most 64 KiB.

In-process per-user limits protect trip planning, AI explanation, Passenger reports, Driver GPS/occupancy/trip writes, workbench/disruption writes, the legacy trip search, and the demo feed. Limits return a generic 429 response with `Retry-After`. They reset on process restart and do not coordinate across multiple backend instances; deployment behind more than one instance should add a shared gateway or datastore limiter.

Provider and unexpected failures return stable application messages. Provider prompts, provider response bodies, JWTs, authorization headers, credentials, and provider URLs containing keys are not logged. Strapi's production error middleware remains responsible for removing stack traces from HTTP responses.

## Secrets and provider keys

The following values are server-only and must be supplied through the backend environment or secret manager:

- `OPENAI_API_KEY`
- `GEMINI_API_KEY`
- `GEOAPIFY_SERVER_API_KEY`
- `DATABASE_PASSWORD` or `DATABASE_URL`
- `APP_KEYS`
- `API_TOKEN_SALT`
- `ADMIN_JWT_SECRET`
- `TRANSFER_TOKEN_SALT`
- `JWT_SECRET`
- `ENCRYPTION_KEY`

Local `.env` files and build output are ignored by Git. The Nuxt Geoapify browser key is intentionally public and must be restricted in Geoapify by allowed origins and API scope. No AI or server-routing key belongs in `NUXT_PUBLIC_*` configuration.

## Privacy handling

- Passenger current location and searched origin/destination are used to plan the current request. PAMANA does not create location-history records from trip planning.
- A Passenger report stores coordinates only when the Passenger explicitly includes them. Passenger-facing report responses omit exact coordinates; authorized reviewers can see them for review.
- Driver GPS is operational data attached to the authenticated Driver's active Trip and assigned Vehicle. Passenger live-map responses expose the current operational position required for the service, not Driver identity or authorization data.
- Passenger identity is resolved server-side and removed from report responses.
- AI explanation is opt-in. Only the bounded factual display contract is sent to the configured server-side provider. Coordinates, geometry, internal identifiers, Passenger identity, and Driver identity are excluded. An AI failure never changes the deterministic journey.
- Application logs should contain status categories and request correlation information only. They must not contain precise personal coordinates unless an explicit incident investigation requires controlled access.

## CORS and session model

`CORS_ORIGINS` must list explicit frontend origins. Local defaults are `http://localhost:3000` and `http://127.0.0.1:3000`; phone testing adds the exact LAN origin. Production must set only the deployed HTTPS frontend origins and must not use `*` with credentials.

The current client sends a JWT in the `Authorization: Bearer` header. These state-changing content API calls do not authenticate from ambient browser cookies, so conventional cookie-based CSRF is not the primary boundary. The refresh session uses an HTTP-only cookie through the users-permissions plugin. If authentication is later changed to cookie-only content API authorization, add origin-bound CSRF tokens at that time.

The access JWT is currently persisted in browser local storage for compatibility with the existing frontend. This increases the impact of an XSS defect; strict content security policy and migration to an HTTP-only same-site access-token session should be evaluated before an internet-facing production release.

## Verification and limitations

`test:phase-22` covers the role matrix, stale-grant removal, request validation, rate limits, provider logging, and tracked-secret patterns. `test:phase-22-db` compares live Strapi permissions with the exact managed matrix. `smoke:phase-22-http` signs short-lived local test tokens without printing them and tests anonymous and cross-role requests over HTTP.

Known limits are the single-process rate limiter, the existing local-storage access JWT, and reliance on provider-side restrictions for the public Geoapify browser key. These are documented deployment decisions and do not relax the Phase 22 authorization boundary.
