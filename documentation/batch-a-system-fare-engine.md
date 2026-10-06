# Batch A: system fare engine and Mexico / San Fernando audit

Implemented on 4 October 2026 (Asia/Manila). Batch B, Batch C, Passenger UI, map changes and explanation redesign are outside this change. Nothing was committed or pushed.

## Outcome and architecture

The existing deterministic `fare-engine.js` remains the fare service. `fare-policy.js` centralizes traditional/modern jeepney parameters, the 20% discount and the exact outbound demo tricycle scope. No provider, LLM or external directions service calculates these fares or their fare distances.

For every newly boarded `PUJ_TRADITIONAL` leg, the raw fare is `14 + max(0, distanceKm - 4) * 2`. For `PUJ_MODERN`, it is `17 + max(0, distanceKm - 4) * 2.4`. Final regular fare is `Math.round(rawFare)`; the optional discounted estimate is `Math.round(rawFare * 0.8)`. `REGULAR` remains the default, and only an explicitly supplied `STUDENT`, `SENIOR` or `PWD` journey category selects the discount. No profile is automatically interpreted as a student. The demo tricycle has no invented discount.

Jeepney passenger estimates use the product policy, including when historical flat FareRule records exist. Those database records and their evidence, dates and verification remain intact. Other modes retain the existing eligible variant-before-route FareRule matching, date checks and incomplete-rule handling. Their passenger amounts also use nearest whole-peso rounding; unknown stored rounding vocabularies remain unavailable. Stored rounding text is retained as evidence, but cannot produce fractional passenger amounts.

`route-distance.js` reads the existing model without adding schema fields. It first uses nonnegative, ordered cumulative `RouteVariantStop.distance_from_variant_start_m` values for the actual boarding/alighting segment. These are the model's existing stored route-distance measurements. Otherwise it measures the corresponding segment of trusted stored GeoJSON or a standard precision-5 encoded polyline. It supports contiguous MultiLineStrings, projects stops onto the stored road line within 30 metres, and refuses ambiguous loops, disconnected lines, unmatched stops or reversed stop ordering. Geometry sources must be one of the existing `FIELD_GPS`, `AUTHORITATIVE`, `GOOGLE_ROAD_MATCHED` or `MANUAL_VERIFIED` values. Missing coordinates remain missing rather than becoming zero.

Polyline segment lengths use geodesic measurements accumulated along the stored road line. Endpoint straight-line distance, access-node Haversine distance, walking distance, car-directions guesses and display-only approximate paths never substitute for fare distance. There is no additional explicit road-distance field in the current Route/RouteVariant schema to fall back to. An enabled jeepney leg with no usable segment returns `status: FARE_DISTANCE_UNAVAILABLE`, with null regular, discounted and payable amounts.

The existing `fare.regularFare`, `fare.discountedFare`, `fare.payableFare` and `fareSummary.totalFare` API fields are preserved. Per-leg provenance adds `sourceType`, `isCalculated`, and `isDemoEstimate`; `roadDistanceSource` identifies a usable stored distance source. Product policies carry no invented verification status. Walking has PHP 0 and `FREE_WALK`; transfer markers remain not applicable. Totals sum the rounded payable vehicle legs. An incomplete journey exposes a known subtotal and a null total, never a misleading full total.

The PHP 100 rule requires all of: TRICYCLE mode, `PILOT-PSU-MEXICO-BAYAN-TRICYCLE`, `PILOT-PSU-MEXICO-BAYAN-TRICYCLE-OUT`, boarding `RCH-PSU-MEXICO-FRONT`, and alighting `RCH-MEXICO-BAYAN-STA-MONICA-TRANSFER`. Its fare source is `DEMO_ESTIMATE`, verification status is null, and a warning explicitly says the estimate is unverified. It does not apply in reverse, to other tricycles, or to simulated variants. This labels fare evidence separately from the existing FIELD_VERIFIED transport leg.

`transfer-count.js` counts TRANSIT vehicle legs only: `max(0, count - 1)`. Graph planning, walking composition, information enrichment and response normalization use it. Existing exact shared-node transfer permission checks and the planner's one-transfer search limit are preserved. Three-vehicle transfer counting is tested independently; this batch does not expand the search limit. The legacy trip-search candidate models one vehicle on one route, so an intermediate stop called a transfer point no longer invents another boarding. Its jeep fare stays null with `fare_status: FARE_DISTANCE_UNAVAILABLE`, because the legacy model has no trustworthy segment distance.

The two existing AI explanation paths receive final amounts only, use an explicit no-fare-calculation instruction, and no longer format fares with `.00`. The revised path recognizes the new fare status and provenance. This is contract compatibility, not an explanation or UI redesign.

## Actual database audit and journey coverage

The audited database contains 8 Routes, 10 TransportNodes, 4 RouteVariants, 8 RouteVariantStops, 2 FareRules, and 0 ServicePatterns. Three routes, four variants and four nodes are planning-enabled FIELD_VERIFIED / REAL records. All four eligible variants have `geometry_source: UNKNOWN`, null GeoJSON, null encoded polyline, and null cumulative stop distances.

| Pilot journey | Actual coverage | Transfers | Current fare result |
|---|---|---:|---|
| 1. Robinsons Arayat Gate → Mexico Bayan / Sta. Monica | Existing `RCH-MEX-CSF-SM` research route is reused by the prepared disabled inbound variant. Exact operational service and road data remain unverified. | 0 when verified as one vehicle | Unavailable; research excluded |
| 2. Robinsons Arayat Gate → San Juan / PSU frontage | Existing enabled `RCH-SJ-SMROB-IN`; instruction/signboard SAN JUAN preserved. The modeled destination is PSU frontage; no separate San Juan stop is invented. | 0 | FARE_DISTANCE_UNAVAILABLE |
| 3. PSU / San Juan → SM Main Gate | Existing enabled `RCH-SJ-SMROB-OUT`; signboard SM Pampanga preserved. | 0 | FARE_DISTANCE_UNAVAILABLE |
| 4. Same jeep → SM → walking to Robinsons | Existing outbound variant plus the existing walking connector flow. Regression verified against actual pilot coordinates with the walking provider mocked. Live connector availability still depends on Geoapify. | 0 | Jeep unavailable; walking PHP 0 |
| 5. PSU → jeep → Mexico Bayan → jeep → SM | Prepared disabled local jeep research route/variant plus existing enabled `PILOT-ARAYAT-SF-MEXICO-BAYAN-SM-OUT`. No eligible first jeep service exists yet. | 1 when both legs qualify | Research first leg excluded; second jeep distance unavailable |
| 6. PSU → tricycle → Mexico Bayan → jeep → SM | Existing enabled `PILOT-PSU-MEXICO-BAYAN-TRICYCLE-OUT` + `PILOT-ARAYAT-SF-MEXICO-BAYAN-SM-OUT`. | 1 | PHP 100 demo first leg + unavailable jeep; known subtotal 100, total null |
| 7. PSU → jeep → Mexico Bayan → jeep → Robinsons | Prepared disabled local jeep variant and disabled Mexico Bayan → Robinsons variant. | 1 when both legs qualify | Research excluded |

Planning eligibility, operating status, route activity, sources, effective dates, node eligibility, exact pickup/dropoff permissions, transfer gates, and REAL/SIMULATED isolation are unchanged. The broad Arayat route's activation still covers only the existing Mexico Bayan → SM segment; it does not establish every stop on the through-route or a modern-jeep alternative. `RCH-MEX-CSF-SM` retains its existing unknown transport_mode and disabled research status. The proposed local jeep route also leaves transport_mode null until the traditional/modern subtype is verified; its jeepney intent is recorded as research in its name and source. No vehicle classification is silently promoted.

The City Proper / Public Market node `RCH-NODE-CSF-PUBLIC-MARKET-CITY-PROPER` is still RESEARCH_CANDIDATE, disabled, without coordinates or an eligible exact stop/variant path. No City Proper route, geometry or service was invented. `RCH-SJ-CSF-SAN-JOSE`, `RCH-MEX-CSF-SJ-LAG`, unrelated destination nodes and historical simulated legacy routes are unchanged.

## Actual fare examples and missing distances

There is **no actual available pilot jeep road distance**, so a numeric pilot jeep fare cannot responsibly be reported. Historical PHP 30 and PHP 14 FareRule values remain in PostgreSQL as supplied field evidence; the new formulas do not infer distances from those amounts.

- Actual modeled PSU frontage → Mexico Bayan tricycle: PHP 100, DEMO_ESTIMATE, zero transfers.
- Actual modeled direct PSU → SM jeep: regular/discounted/payable amounts null, FARE_DISTANCE_UNAVAILABLE, zero transfers.
- Actual modeled PSU tricycle → Mexico Bayan jeep → SM: first leg 100, second leg null, known subtotal 100, total null, one transfer.
- Walking connections: PHP 0, no new boarding or base fare.

Tests use clearly synthetic distances: traditional 6 km → 18; modern 6 km → 22; modern 8.45 km raw 27.68 → 28; raw 33.42 discounted before rounding → 27. These are calculation tests, not invented kilometre values for the real corridors.

Missing geometry/distance: `RCH-SJ-SMROB-OUT`, `RCH-SJ-SMROB-IN`, `PILOT-ARAYAT-SF-MEXICO-BAYAN-SM-OUT`, and `PILOT-PSU-MEXICO-BAYAN-TRICYCLE-OUT`. The tricycle fixed estimate does not require geometry. All three proposed research variants also have no road geometry or cumulative distances. City Proper additionally lacks exact operational stops.

## Database changes prepared for review

No schema migration is required. No persistent transport row was created, updated, deleted, renamed or promoted. The seed was audited in dry-run mode and applied twice inside one test transaction, then rolled back. Existing-record equality and the original transport digest were verified after rollback:

`3d63fcdb5d9581d71e2c68d54db9c00868510dcc9b91e6e38fcb893373af9139`

PostgreSQL identity sequences can advance during rolled-back insert tests; transport row contents, counts and planning eligibility are unchanged.

`scripts/seed-batch-a-research.js` defaults to a read-only dry run. Its opt-in `--apply` is transactional and insert-only, with bounded lock/statement timeouts, a shared seed lock and semantic corridor checks before creating records. It reuses matching variant endpoints and vehicle mode regardless of names, refuses conflicting codes or ambiguous matches, and does not repair/overwrite an existing record merely to make a demo work.

The current dry run would create exactly:

| Entity | Code / relationship | State |
|---|---|---|
| Route | `RCH-PSU-MEXICO-BAYAN-JEEP` | RESEARCH_CANDIDATE / REAL, inactive, planning disabled |
| Variant | `RCH-PSU-MEXICO-BAYAN-JEEP-OUT` on that route | RESEARCH_CANDIDATE / REAL, UNKNOWN operating/geometry, planning disabled |
| Variant | `RCH-MEX-CSF-SM-ROB-BAYAN-IN` on existing `RCH-MEX-CSF-SM` | Same disabled research state; supplied Mexico boarding instruction |
| Variant | `RCH-MEX-CSF-SM-BAYAN-ROB-OUT` on existing `RCH-MEX-CSF-SM` | Same disabled research state; no invented signboard |
| Stops | Two ordered endpoint stops per proposed variant, six total | Existing PSU, Mexico Bayan and Robinsons Arayat Gate nodes reused; cumulative distances null |

No new TransportNodes, FareRules or ServicePatterns. Six stops mean: Robinsons→Mexico Bayan sequences 1/2, Mexico Bayan→Robinsons sequences 1/2, PSU→Mexico Bayan sequences 1/2. Variant-to-route, endpoint and stop relation rows are created only for the new research records. Existing nodes/routes/variants/stops/fares/service patterns and all operational records are left unchanged. The manifest contains no invented intermediate stops. Reapplying the seed produces no duplicate rows and no changes to existing records.

## Validation

- `npm run test:batch-a`: 17 tests passed, including all requested fare/discount/demo/walking/transfer/total/distance/trust/idempotency scenarios; legacy trip-search regressions also cover whole-peso output and transfer-point semantics.
- `node scripts/run-batch-a-regressions.js`: all 28 unit regression commands passed. This includes time slots, phases 1–5B, planning eligibility, trip-search gates, phases 10–14, 16–24, 26, pilot manifest checks and presentation-road-path isolation. Stored FareRule tests now use BUS fixtures to continue exercising their original precedence/eligibility/formula guarantees independently from jeepney product policy.
- `node scripts/run-batch-a-regressions.js --database`: all 21 database/integration regression commands passed, including phases 3–5B, 10–14, 16–19, 21–24, the existing pilot and legacy route-data audit, plus the new Batch A transaction/idempotency/preservation test.
- `npm run build`: backend Strapi build succeeded, including the admin panel.
- `git diff --check`: passed.

Full command outputs are saved in `batch-a-unit-validation.json` and `batch-a-database-validation.json`. Network AI-provider calls, paid-provider smoke tests and live browser/UI checks were not needed for this backend-only deterministic change. Walking was mocked in integration checks; no new Geoapify or AI network requests were made by these tests.

## Files changed

All paths below are relative to the backend directory.

New runtime files:

- `src/services/pamana-journey/fare-policy.js`
- `src/services/pamana-journey/route-distance.js`
- `src/services/pamana-journey/transfer-count.js`

Existing runtime files:

- `src/services/pamana-journey/fare-engine.js`
- `src/services/pamana-journey/graph-builder.js`
- `src/services/pamana-journey/journey-planner.js`
- `src/services/pamana-journey/walking-journey-composer.js`
- `src/services/pamana-journey/journey-information-enricher.js`
- `src/services/pamana-journey/transport-data-loader.js`
- `src/services/pamana-journey/trip-plan-orchestrator.js`
- `src/api/trip-search/controllers/trip-search.js`
- `src/services/pamana-ai/explain.js`
- `src/services/pamana-ai/journey-explanation.js`

Seed, tests, tooling and documentation:

- `scripts/data/batch-a-mexico-san-fernando-research.json`
- `scripts/seed-batch-a-research.js`
- `scripts/test-batch-a-fares.js`
- `scripts/test-batch-a-database.js`
- `scripts/run-batch-a-regressions.js`
- `scripts/fixtures/phase12-synthetic-information.js`
- `scripts/test-trip-search-planning-gate.js`
- `scripts/test-phase-12-fare-service-engine.js`
- `scripts/test-phase-14-unified-trip-plan.js`
- `scripts/test-pilot-field-verified-database.js`
- `scripts/test-phase-24-integration.js`
- `scripts/rehearse-hackathon-demo.js`
- `package.json`
- `documentation/phase-12-fare-service-engine.md`
- `documentation/batch-a-system-fare-engine.md`
- `documentation/batch-a-unit-validation.json`
- `documentation/batch-a-database-validation.json`

The initial Batch A backend implementation did not change frontend files. A subsequent Passenger screenshot exposed a frontend contract gap: its fare enum rejected FARE_DISTANCE_UNAVAILABLE. The follow-up updates the frontend fare contract/types and provenance forwarding, with a backend-to-frontend regression suite; see the frontend's `documentation/batch-a-fare-contract-fix.md`. This is compatibility work only. MapLibre, geocoding, current-location behavior, camera preservation, map rendering, layout and simulation code remain unchanged. Batch B/C are not started.
