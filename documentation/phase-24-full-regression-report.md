# Phase 24 — full system regression and acceptance report

Date: 2026-09-30 (Asia/Manila)

**Status: automated regression hardening passed; final manual acceptance is pending the device/vehicle checks below.** Do not treat this report as approval to remove Leaflet or begin Phase 25.

## Approved Phase 23 push

Both non-force pushes succeeded on `feature/pamana-mexico-revision`. Remote heads were rechecked after regression testing:

- Backend: `ebddee6e2eb2888907285aa47aa0777e0fbd148b`.
- Frontend: `262f9226588d2416eaa2e37d88ead6c136d9f3e0`.

At that push checkpoint the backend was clean and the frontend contained only the pre-existing `nuxt.config.ts` edit. Phase 24 changes are separate local commits, not part of those pushes. No merge, force-push or amendment was performed.

The unrelated frontend config was never edited or staged. Its SHA256 before and after this work is `20DCCC32408726EBA10100EEB1F4ECF169BC33F2F0CD330EC3FDAC38A71E5D44`.

## Acceptance matrix

“Automated pass” means a mocked contract, actual database, or HTTP test as specified; it does not claim a manual device test. Existing phase suites cover the previous implementation contracts.

| Area | Result | Evidence and limits |
| --- | --- | --- |
| Authentication | PASS | Browser registration/profile creation, login/logout for Passenger, Driver, LGU and Administrator; session restoration and role redirects. HTTP wrong password, session refresh/rotation, logout/revocation, anonymous denial and invalid JWT pass. Test accounts were disposable and removed. |
| Passenger dashboard / quick destinations | PARTIAL MANUAL | Dashboard, destination cards and planner navigation rendered. Quick-place resolution has automated Phase 8/15 coverage; each card was not manually submitted in this run. |
| Origin / destination | PASS | Live Geoapify suggestions for PSU Mexico and SM City Pampanga selected with keyboard; geographic markers rendered. Provider returned the university's older Don Honorio Ventura name with a Mexico address. Debounce, cancellation, edit invalidation and missing-key states pass automated tests. |
| Current Location | AUTOMATED PASS; DEVICE PENDING | Permission denial, one permission request per composable lifecycle and watch cleanup pass. Real device GPS, GPS marker movement and explicit My Location recenter still need manual acceptance. No browser permission was granted during these tests. |
| Swap / departure / schedule / category | AUTOMATED PASS; MANUAL PARTIAL | Existing frontend selection tests cover these contracts; STUDENT requests retain unknown discounts. This run did not manually exercise every swap/date/category combination. |
| Direct / transfer journeys | PASS | Real Passenger HTTP/UI plan showed the direct PHP 30 journey and one-transfer option with PHP 14 known subtotal. Selected transfer journey changed cards/map and reset its explanation. |
| Return / no journey | AUTOMATED INTEGRATION PASS | Actual Strapi loaders and field-verified graph cover Robinsons return, PSU–Mexico, Mexico–SM and far-away no-access state. External walking is mocked in these tests. Return/no-route were not manually submitted in the browser. |
| Fare / service / ETA | PASS | Browser preserves unknown service, wait and total transit duration; partial fare is a known subtotal, not a fabricated total. PHP 30 and PHP 14 regular fares remain unchanged. |
| Walking / transit geometry | PASS | Live walking access/egress rendered dashed. Transit geometry stays null. Separate approximate road overlay renders with its notice; it is not transit truth and has no planner/fare/ETA effect. Provider failure does not invent a straight transit line. |
| Passenger reports / review | HTTP PASS | Disposable LONG_WAIT report submission, own-report privacy and LGU review succeeded, then the fixture was deleted. Browser LGU review queue rendered; existing reports were not edited. |
| AI explanation | PASS | Actual configured Gemini explanation succeeded for the selected factual direct journey, preserving unknown service/wait information. OpenAI/Gemini failure and provider sanitization have automated coverage. No AI call is required by the core planner. |
| MapLibre / basemap | PASS | Live Geoapify basemap, zoom, keyboard pan, geographic origin/destination and four verified transport markers rendered. Fresh tab: zero console errors, zero hydration warnings, zero MapLibre/Geoapify authorization errors. Two development-only Nuxt warnings remain. |
| Camera / refresh | PASS WITH LIMIT | Manually zoomed and panned the live map, clicked page Refresh, then observed several polling updates. Before/after screenshots show the same corridor/viewport; file hashes differ, so byte equality is not claimed. Feed had zero active vehicles. Nonempty marker movement/no automatic fit is covered by automated Phase 7/16 tests. |
| Driver | AUTOMATED / HTTP PASS; OPERATIONAL MANUAL PENDING | Directional variants, route selection, ownership, GPS bounds, occupancy, active/end trip and no reversal pass Phase 17/22 tests. Real role HTTP reads and unauthorized GPS denial pass. Browser Driver workspace renders; disposable Driver has no assigned vehicle, so manual trip start/GPS/occupancy/end still needs an authorized assigned vehicle. |
| LGU / Administrator | PASS WITH LIMIT | Both transport workbenches now render; node/fare/service tables and role reads pass. Browser disruption form/review queue rendered. Verification/planning/fare/service/geometry mutation validation is covered by Phase 21 tests; no live transport edit was saved. Legacy LGU command-center demo metrics are still labeled seeded/simulated. |
| Journey engine | PASS | Direct, transfer, through-route segment, explicit inbound return, walking access/egress, known/unknown/partial fare, unknown service, fresh/stale availability and blocking/warning disruptions pass deterministic phase tests. No ML/AI dependency introduced. |
| Simulation | AUTOMATED PASS; MANUAL PARTIAL | Disabled by default, explicit enable, SIMULATED labeling and default production exclusion pass Phase 16/23 tests. Actual default browser feed shows no simulated vehicle. Enabled moving simulation was not manually run in this pass. |
| Security | PASS | Role/ownership boundaries, HttpOnly refresh handling, server logout, refresh concurrency, report privacy, forged GPS rejection and per-user trip-plan rate limit pass. Exact local credential scan found zero matches in source, acceptance logs and public assets as described below. |
| Responsive / browser | PASS | Current Chromium in-app browser at actual CSS widths 360, 430, 768 and 1440: no horizontal overflow and nonzero correctly sized map canvas. No second browser was readily connected; no claim of Safari/Firefox/device testing. |

## Minimal regression fixes

1. Logout returned 403 for PAMANA roles and frontend logout did not revoke the server session. Reconcile the existing Strapi logout action for the four roles and call it before local cleanup; offline local logout remains possible.
2. Strapi registration returned a refresh token in JSON despite the configured HttpOnly policy. A narrow plugin extension places it in the configured HttpOnly cookie and removes only that JSON property; legacy token mode and failures retain existing behavior.
3. Concurrent 401 responses could rotate a refresh session twice. Coalesce refresh per Nuxt app and retry with the token already rotated by another request. Server-side requests do not share a global user session.
4. The trip response check accepted incomplete nested payloads. Validate fields consumed by cards, map and explanation with existing Zod before reactive rendering; errors stay sanitized.
5. LGU/Admin transport pages referenced a name absent from Nuxt's actual component registry, leaving a blank workbench. Use the registered component and explicit page titles. A generated-registry regression test prevents recurrence.
6. Authenticated content produced SSR hydration mismatches before client session restoration. Render the existing workspace loading state until mounted. The fresh authenticated map reload has no hydration warning. Nuxt development warnings about initial page detection/Vite remain nonfatal.
7. Driver role icons referenced an unavailable Lucide steering-wheel icon. Use the installed bus-front icon.
8. Update the legacy read-only trip-search audit context to supply the authentication now required by Phase 22. No legacy production behavior was changed.

No product feature, transport schema, planner rule, verified coordinate, fare rule or provider configuration was added.

## Exact pilot state

Final read-only audit and existing pilot database suite passed:

| Record / invariant | Result |
| --- | --- |
| Total TransportNodes / Routes / RouteVariants | 10 / 8 / 4 |
| Coordinate-bearing FIELD_VERIFIED planning nodes | 4 |
| Planning-enabled Routes / RouteVariants | 3 / 4 |
| RouteVariantStops / FareRules / ServicePatterns | 8 / 2 / 0 |
| Verified transit geometry | All existing pilot variant geometry remains null |
| Unrelated research | Unpromoted, unresolved coordinates and disabled planning preserved |
| Remaining Phase 24 acceptance users | 0 |

Transport digest: `3d63fcdb5d9581d71e2c68d54db9c00868510dcc9b91e6e38fcb893373af9139`.

**Transport/pilot database changes: zero.** Session acceptance creates/revokes sessions, and bootstrap reconciles four logout permissions. Disposable auth/profile/report fixtures were removed; no existing user credential or transport record was modified.

## Validation results

- Backend: 26 unit/contract scripts plus authenticated legacy read-only route audit passed.
- Backend: 18 existing database regression scripts (relevant Phase 3–23 and pilot suites) passed.
- Frontend: 16 relevant phase/selection test entries passed, including Phase 6–9 and Phase 15–24.
- New Phase 24 frontend suite: 10 tests passed, no skips when real DTO cache and prepared Nuxt registry were present.
- New integrated backend suite: real Strapi loaders, deterministic graph/fare/service/availability, all four pilot endpoint pairs, far-away state and walking-provider failure passed. Provider geometry is mocked and never stored.
- Phase 22 and new Phase 24 HTTP smoke tests passed; excess malformed planning requests reach 429 before provider work.
- Both production builds passed. Backend build has nonfatal local XDG permission/pg deprecation warnings.
- Production missing-key SSR smoke passed login/register/passenger map/driver/LGU routes; development preview is 404 in production.
- `git diff --check` and conflict scan passed in both repositories.
- Exact local environment credential scan: zero matches in tracked/nonignored source, Phase 24 text logs and frontend public build assets. Server-only credentials are excluded from public assets; the explicitly public Geoapify key remains allowed in runtime browser configuration. Keys and raw provider payloads were not committed.
- Live provider checks are bounded manual smoke tests; unit tests use mocks. Geoapify walking, basemap/autocomplete, approximate corridor overlay and configured Gemini explanation succeeded. A sandbox network denial was reproduced and recovered using the existing service with network access; it did not modify transport truth.

Useful new commands:

```text
Backend:
npm run test:phase-24
npm run test:phase-24-integration
npm run smoke:phase-24-http  (running local backend required)

Frontend:
npm run test:phase-24
node scripts/test-phase-6-smoke.mjs  (production build required)
```

For the optional actual backend-to-frontend DTO assertion, export with `PAMANA_PHASE24_CONTRACT_FILE` pointing to the frontend ignored `.cache/phase24-trip-plan.json`, then run the frontend suite. Without that cache the optional cross-contract test skips; other mocked checks remain independent. Production component-registry assertion requires Nuxt prepare/build.

Ignored local evidence: frontend `logs/phase24-journey-desktop.jpg`, camera before/after screenshots, final sanitized-check console log and build log; backend `.tmp/phase24-*.log`. No provider response was saved to PostgreSQL.

## Phase 25 blocker / delivery

Phase 24 fixes and automated checks are ready for review, but complete manual sign-off still needs real device GPS, an assigned Driver vehicle, and the unexercised manual cases identified above.

Leaflet removal is also unsafe: LGU command-center/disruption/live-mobility and Driver demand maps still use the retained Leaflet compatibility path. Passenger journey maps use MapLibre, but that does not satisfy Phase 25's requirement that all required production map consumers be migrated.

Phase 24 commits are local only pending separate push approval. The exact Phase 23 commits remain the remote heads. Phase 25 was not begun.
