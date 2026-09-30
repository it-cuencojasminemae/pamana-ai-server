# Phase 23 — performance, provider quota, and cost hardening

Validated locally on 2026-09-30. Scope ends at Phase 23.

## Baseline and measurements

Inspection found that the default walking router was constructed per planning request, discarding its otherwise valid five-minute cache. The location loader made one `findFirst` call per active vehicle after loading trips and assigned vehicles. The planner already loads nodes, graph, disruptions, fares, service patterns and operational evidence once for the bounded result set; it does not repeat those loads per journey.

`node scripts/benchmark-phase-23.js` runs ten identical synthetic direct plans with eight active synthetic vehicles, a mocked 5 ms walking-provider delay and a mocked 1 ms location-read delay. It makes no external API request and connects to no database. The original code was measured before modification. A recorded run gave:

| Metric | Before | After |
| --- | ---: | ---: |
| Walking provider calls across ten plans | 20 | 2 |
| Top-level loader/document/query-builder calls across ten plans | 150 | 90 |
| Those calls per plan | 15 | 9 |
| Peak concurrent latest-location lookups | 8 | 1 batched selection |
| Synthetic median plan latency | 47.08 ms | 15.25 ms |
| Synthetic first-plan latency | 110.30 ms | 87.76 ms |

These are controlled measurements of application orchestration, not production HTTP, PostgreSQL SQL-statement counts, provider latency or a guaranteed speedup. Nested Strapi population can execute additional SQL. Cold-start/JIT and machine load affect timings. `--fresh-router` now provides a reproducible uncached/document-only comparison using the current portable adapter, whose concurrency is capped at four; it is not the original implementation.

Before optimization, autocomplete had a same-query generation bug: rescheduling an in-flight normalized query suppressed its eventual result. FROM/TO fields had separate clients and could each call Geoapify for the same query. The regression test now demonstrates one request for two simultaneous normalized queries, independent cancellation, and reuse of the completed result. LGU polling was twelve requests per visible or hidden minute; it is now four per visible minute and zero while hidden, excluding initial/resume loads. Passenger REAL and opt-in SIMULATED feeds already poll every fifteen seconds while visible, without refetching transport nodes.

## Geoapify geography and quota

- The default walking router is process-local and retained across requests. Changing its server key or walking configuration creates a fresh router. No key or endpoint URL is logged.
- Only successful walking geography is cached. Default TTL is five minutes, at most 100 entries and 100 pending unique endpoint pairs. Keys use exact ordered coordinates and walking mode. Nearby GPS points do not share endpoints. Cached geography excludes passenger labels; each caller receives its own labels and cloned data. Errors are not cached.
- Identical concurrent walking requests share one provider operation. A subscriber aborts independently; the upstream operation aborts when its last subscriber leaves. An already-aborted request never returns cached success.
- Haversine prefilter, 800 m initial/1,500 m maximum default radius, 15 m proximity threshold and five candidates per access/egress side remain. Concurrency is at most two per candidate batch. Egress routing is skipped without access candidates. At most ten non-proximity candidates are routed per plan. Default timeout is seven seconds, capped at thirty seconds. There are no application-level walking retries.
- Walking overrides cannot exceed five candidates, concurrency two, five-minute cache TTL or 100 cache entries. The local configured values remain 5/2/7,000 ms/300,000 ms/100.
- The existing frontend Geoapify client now shares successful normalized autocomplete/forward-geocode results across a Nuxt app instance: five-minute TTL, 50 completed entries and 50 pending unique searches. Endpoint, country filter, bias, limit and language partition the cache. Credential changes replace it. SSR apps have separate clients via a WeakMap; no cache is serialized or placed in localStorage.
- Autocomplete retains 320 ms debounce, two-character minimum, six suggestions by default (maximum eight), cancellation and generation checks. Query whitespace/case normalization prevents duplicate work. The field-local suggestion cache is bounded to 20 entries and now also expires after five minutes. Cached no-results expire too; failures remain retryable.
- Reverse geocoding remains optional display enrichment of GPS. Places API is not used by the planner. Search caching does not create or verify transport records.
- Existing presentation-only road geometry retains its six-hour/40-entry browser cache. The key now includes ordered endpoint coordinates as well as variant/node IDs, so coordinate edits cannot reuse an older corridor. It remains `APPROXIMATE_ROAD_PATH`, outside planner facts. Provider failure still returns no fabricated line.

## Request-scoped planning and PostgreSQL

Nodes, graph and disruptions still load fresh on every request. Fares/service and operational evidence still load once for all selected journeys. No result, graph, fare, ServicePattern, disruption, availability or live-vehicle cache was introduced. Current evidence is therefore reevaluated after a workbench edit, driver update or disruption change.

The PostgreSQL latest-location loader uses bound trip/vehicle document IDs and `DISTINCT ON` to select one latest location ID per exact pair. Only those bounded IDs pass to one normal Strapi document hydration, including the operational trip/variant relation when required. It orders by recorded time, then row ID for timestamp ties, reapplies REAL filters and never transfers full GPS histories into application memory. Both planning availability and the authenticated live endpoint reuse this loader. Non-PostgreSQL/document-only adapters retain the prior semantics with at most four concurrent reads. Errors propagate to existing sanitized endpoint handling rather than silently inventing availability.

The existing relationship and document indexes were inspected. The local dataset does not establish a material missing-index bottleneck, so no speculative index or migration was added. PostgreSQL tests use transaction-local temporary fixtures with `ON COMMIT DROP` to prove pair isolation, latest selection, REAL/SIMULATED filtering and ties, then execute the query against the real schema. The field-data digest and planning counts are unchanged.

## AI cost controls

AI remains explicitly requested after a factual selected journey exists. Search, map updates and live polling never trigger explanation. The current successful guide is reused in browser component memory for sixty seconds only when the exact supplied facts match. Selection/search/reset/disposal clears it; changed facts, expiration or provider failure require a new explicit request. No server-wide AI cache or persistent prompt/output storage was added, and output never becomes planner truth.

Existing server protections remain: eight explanation requests and twenty trip-plan requests per authenticated user/IP per minute, bounded validated payloads, output schemas and sanitized failures. OpenAI keeps its existing ten-second timeout, 700-token output limit, `store: false`, and SDK default two retries (up to three attempts within the cancellation budget). Gemini keeps its existing twenty-second timeout, 1,200-token output bound and three-attempt retry policy. Models and providers were not changed. No live AI quota was consumed by tests; no new pricing assumptions were made.

## Polling, map and bundles

LGU live polling now uses fifteen seconds, skips hidden tabs, aborts the current request when hidden/unmounted, prevents overlap and reloads on visibility restoration. Passenger polling keeps its existing fifteen-second visibility policy and separate REAL/SIMULATED contracts. Static transport nodes remain loaded on mount, not on vehicle refresh. No high-frequency animation loop was added.

MapLibre sources/layers and the worker remain alive; updates use `setData()`. Camera changes remain explicit selection/recenter intents. No MapLibre or Leaflet implementation change was needed. Leaflet stays installed for compatibility.

Dependency inspection (`npm ls --depth=0`) reported the expected installed frontend packages with no missing/invalid top-level packages. No dependencies, lockfiles or major versions changed. The largest lazy MapLibre JS chunk remains 1,061,327 bytes and its worker 508,637 bytes before and after; global entry CSS remains 255,510 bytes. Client dynamic loading and development-preview 404 guards were retained. Remaining nonfatal warnings include chunk size, Vite plugin timing, transitive Node `DEP0155` exports and experimental TypeScript stripping in tests. Strapi's build also reports the existing restricted XDG-config lookup warning before successfully building its admin panel. These warnings are recorded rather than hidden or addressed through a broad upgrade.

## Validation and data boundaries

Backend Phase 1–23 unit/contract suites, planning gate, time-slot suite, pilot contracts, frontend Phase 6–23/selection/map suites, PostgreSQL phase checks and both production builds pass. New tests exercise independent cancellation, expiration, cloning, exact endpoints, default-router reuse, candidate caps, bounded portable reads, batch lookup, edited coordinate cache keys, current-guide cost control and actual LGU lifecycle behavior. Secret/conflict scans (tracked/new source and build output) and `git diff --check` passed.

No persistent database writes, schema changes, migrations, seeds or pilot activation changes belong to Phase 23. Pilot digest: `3d63fcdb5d9581d71e2c68d54db9c00868510dcc9b91e6e38fcb893373af9139`. Planning-enabled counts remain three routes, four variants and four coordinate-bearing transport nodes. Verified transit geometry remains null where unresolved. Phase 24 is untouched.

## Remaining limits

Caches, deduplication and rate limits are local to one process/browser app. Separate replicas can each spend provider quota. Geometry may be up to five minutes old; live evidence is fetched afresh. Browser Geoapify keys remain intentionally public and need provider-origin restrictions. Existing JWT storage, deployment TLS/CORS settings and other Phase 22 deployment limitations still apply. Larger fleet histories warrant measured query plans and index review before scale-up. No live-provider or deployed HTTP latency claim is made by this phase.
