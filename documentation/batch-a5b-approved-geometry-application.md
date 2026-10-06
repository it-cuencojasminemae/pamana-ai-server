# Batch A.5B: approved pilot geometry application and fare enablement

Completed on **2026-10-05 (Asia/Manila)**. The user stated: “I manually reviewed all four Batch A.5A Geoapify candidate routes and APPROVED all four.” This approval authorized applying these four existing candidates. All four are now stored, with geometry source `MANUAL_VERIFIED`.

Only Batch A.5B was applied. No Batch B/C work, Passenger UI redesign, AI explanation redesign, commit, or push was performed. The existing fare policy and transport modes were preserved.

## Approved artifacts and integrity

The original artifacts remain in `documentation/batch-a5-candidates/`. Their original `candidate_only=true` and `review_status=PENDING_MANUAL_REVIEW` metadata are retained as historical A.5A evidence. The later approval is recorded separately in `scripts/data/batch-a5b-approved-geometry.json`, database notes, and this report. No candidate was regenerated and no new provider routing request was made.

| Variant | Exact approved candidate | SHA-256 |
| --- | --- | --- |
| RCH-SJ-SMROB-OUT | RCH-SJ-SMROB-OUT.candidate.geojson | `ddcf3a262fb70672c73aa2364c6b67c08ad73b9d9c05ecafb5716ed3c15b085c` |
| RCH-SJ-SMROB-IN | RCH-SJ-SMROB-IN.candidate.geojson | `cb957e4df64312dbaf020256d3bd5a64617c26c221af24e236ccea3e085f80c0` |
| PILOT-ARAYAT-SF-MEXICO-BAYAN-SM-OUT | PILOT-ARAYAT-SF-MEXICO-BAYAN-SM-OUT.candidate.geojson | `30113dd9a05f56ca9457b4a122c479d7043e71d5718626e636137b700b17fa6f` |
| PILOT-PSU-MEXICO-BAYAN-TRICYCLE-OUT | PILOT-PSU-MEXICO-BAYAN-TRICYCLE-OUT.candidate.geojson | `92ce5a60d12f9067c70d544c270ac63362d34903a9ba34e3cf588c6257061bb1` |

Before application, validation matched variant codes, exact origin/destination codes and coordinates, independently generated request IDs, valid connected MultiLineString road geometry, archived A.5A metadata, measured lengths, and the configured API-key leak scan. Candidate/report modification times precede receipt of approval. A.5A did not record a pre-review checksum, so a historical byte-for-byte checksum comparison was unavailable; the matching timestamps, metadata, endpoints, request IDs, and exact measured geometry lengths provided the available integrity evidence. SHA-256 values were frozen for this application and checked again afterward.

Only the candidate's geometry object was copied into `geometry_geojson`; no coordinates were reversed or regenerated. Inbound uses its separate approved candidate. Existing notes were preserved and appended with provider **Geoapify**, source stage **Batch A.5A candidate**, manual user approval, approval date **2026-10-05**, artifact path/hash, request ID, distance method, and provider distance. No schema field was added and no API key was stored.

## Before and after database values

All four variants previously had null geometry and source `UNKNOWN`; afterward they contain their exact approved geometry and source `MANUAL_VERIFIED`. All retain `verification_status=FIELD_VERIFIED`, `data_mode=REAL`, `planning_enabled=true`, their existing parent route/mode, and null `encoded_polyline`.

| Variant ID/code | Existing mode | Stop IDs | Before cumulative metres | After cumulative metres |
| --- | --- | --- | --- | --- |
| 3 / RCH-SJ-SMROB-OUT | PUJ_TRADITIONAL | 17, 18 | null, null | 0, 10694 |
| 4 / RCH-SJ-SMROB-IN | PUJ_TRADITIONAL | 19, 20 | null, null | 0, 11165 |
| 9 / PILOT-ARAYAT-SF-MEXICO-BAYAN-SM-OUT | PUJ_TRADITIONAL | 23, 24 | null, null | 0, 3007 |
| 10 / PILOT-PSU-MEXICO-BAYAN-TRICYCLE-OUT | TRICYCLE | 21, 22 | null, null | 0, 7687 |

Exactly **12 existing rows changed**: four `route_variants` (IDs 3, 4, 9, 10) and eight `route_variant_stops` (IDs 17–24). Variant changes were limited to `geometry_geojson`, `geometry_source`, appended `notes`, and `updated_at`. Stop changes were limited to `distance_from_variant_start_m` and `updated_at`. Full before/after database row hashes and sequence comparisons prove that all other rows and sequences were unchanged during application. Protected-field hashes confirm unrelated fields on those 12 rows were preserved.

Counts before and after are identical:

| Table | Before | After |
| --- | ---: | ---: |
| transport_nodes | 10 | 10 |
| routes | 8 | 8 |
| route_variants | 4 | 4 |
| route_variant_stops | 8 | 8 |
| fare_rules | 2 | 2 |
| service_patterns | 0 | 0 |

Planning counts remain 4 nodes / 3 routes / 4 variants. Field-verified counts remain 4 nodes / 3 routes / 4 variants / 2 fare rules. No record was inserted or deleted. Prepared Batch A research remains unapplied and excluded; City Proper and every existing route/node/fare/service record are unchanged.

Transport digest before:

`3d63fcdb5d9581d71e2c68d54db9c00868510dcc9b91e6e38fcb893373af9139`

Transport digest after:

`0d24f4205ae5fd89c4e580a2e82afaaa9012bcbf94ad2455d63dfbd87c2d060a`

## Deterministic road distances

The calculation uses the existing production `route-distance.geometryStopOffsets`: project ordered stop coordinates onto the accepted road polyline, measure travel along that polyline, subtract the first stop's offset, then `Math.round()` to integer metres for the existing INTEGER column. The first stop is zero; subsequent distances are positive and ordered. Endpoint-to-endpoint Haversine distance is not used. Small endpoint snapping gaps are not added as payable road travel.

| Variant | Provider metres | Whole geometry metres | Projected stop segment metres, unrounded | Exact stored/fare metres | Stored minus provider |
| --- | ---: | ---: | ---: | ---: | ---: |
| RCH-SJ-SMROB-OUT | 10709 | 10694.258194344386 | 10694.22430583525 | **10694** | -15 |
| RCH-SJ-SMROB-IN | 11179 | 11164.518804277131 | 11164.518804277131 | **11165** | -14 |
| PILOT-ARAYAT-SF-MEXICO-BAYAN-SM-OUT | 3013 | 3006.7836757819987 | 3006.7477285854698 | **3007** | -6 |
| PILOT-PSU-MEXICO-BAYAN-TRICYCLE-OUT | 7696 | 7687.474760052879 | 7687.415893376462 | **7687** | -9 |

Mexico's first projected offset is 0.002058687394913638 m; the others are zero. These small differences are preserved in the receipt. The provider distance was not forced onto the existing calculation. Production results use `STORED_ROUTE_STOP_DISTANCE`; a separate test also verifies the approved geometry fallback.

## Fare and journey results

All three existing jeep routes are `PUJ_TRADITIONAL`. Fares below come from the stored road distances, existing Batch A policy, and existing whole-peso rounding; no journey fare was hardcoded into production.

| Journey | Stored road metres | Regular PHP | Discounted PHP | Vehicle legs | Transfers | Fare status/source |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| PSU Mexico / San Juan → SM Main Gate | 10694 | **27** | **22** | 1 | 0 | KNOWN / SYSTEM_CALCULATED |
| Robinsons Arayat Gate → PSU Mexico / San Juan | 11165 | **28** | **23** | 1 | 0 | KNOWN / SYSTEM_CALCULATED |
| Mexico Bayan / Sta. Monica → SM Main Gate | 3007 | **14** | **11** | 1 | 0 | KNOWN / SYSTEM_CALCULATED |
| PSU Mexico → Mexico Bayan, tricycle | 7687 | **100** | No discount; payable **100** | 1 | 0 | KNOWN / DEMO_ESTIMATE |
| PSU → tricycle → Mexico Bayan → jeep → SM | 7687 + 3007 | **114** | **111** | 2 | **1** | KNOWN complete total |

The combined journey is computed as 100 plus the calculated jeep fare (14 regular or 11 discounted). `fareSummary.totalFare` is non-null and equals the sum of payable legs. The tricycle remains exactly PHP 100 from `DEMO_ESTIMATE`, has null `discountedFare`, and does not use distance-based jeep pricing. All passenger-facing amounts are integers. Deterministic geometry distances produce the expected traditional-jeep preview fares.

## Transaction and repeatability

`scripts/apply-batch-a5b-approved-geometry.js` defaults to a read-only dry run. Application uses a SERIALIZABLE transaction, advisory/table/row locks, lock/statement timeouts, exact relation/ID checks, frozen file hashes, protected-field assertions, and a backup written before the first update. It rejects missing/ambiguous targets, unexpected geometry/distances/provenance, wrong endpoints/modes, and invalid candidates. A fully matching applied state is a no-op.

The dry run recorded the exact planned fields and stop distances before application. A transaction exercise applied all 12 updates and rolled back, verified a second call was a no-op, and injected a halfway failure to prove full rollback. The actual application then committed the 12 approved updates. A second actual `--apply` invocation changed **zero rows**, preserved timestamps/digest/full snapshot, and created no duplicate records.

Commands from `pamana-backend`:

```powershell
npm run apply:batch-a5b:dry-run
npm run apply:batch-a5b
npm run test:batch-a
node scripts/run-batch-a-regressions.js
npm run test:batch-a5b:regressions
npm run test:batch-a5b-db
node --env-file=.env scripts/smoke-batch-a5b-api.js
npm run build
git diff --check
```

The recorded original backup and application receipt are preserved on rerun. The transaction-failure exercise was run against the pre-application state; it is a historical validation, not a post-application rollback instruction.

## Validation

| Check | Result |
| --- | --- |
| Batch A fare/seed-policy unit suite | 17 tests passed, 0 failed |
| Approved-candidate/application safety unit suite | 7 tests passed, 0 failed |
| Backend unit regression runner | 29 command groups passed, 0 failed; includes the two suites above |
| Pre-application transaction/no-op/injected-failure rollback exercise | Passed; no persistent changes from the exercise |
| Database/integration regressions | 14 command groups passed, 0 failed |
| Existing pilot field-verified DB checks | Passed; included in database runner |
| Production geometry, distance, fare, isolation, research/City Proper checks | Passed; included in database runner |
| Passenger controller smoke | 8 regular/student requests passed; all status 200 / JOURNEYS_FOUND, yielding 10 journeys |
| Frontend fare/map/contract tests | 36 tests passed, 0 failed, including 3 new A.5B contract tests |
| Backend build | Passed |
| git diff --check, backend and frontend | Passed |
| Approved artifact/provenance/API-key scan | Passed |
| Actual application rerun | 0 rows changed |

The Passenger check invokes the actual controller with actual Strapi production database loaders and the existing journey/fare orchestrator. External walking uses a controlled fixture to avoid new Geoapify requests. It validates direct, independently approved inbound, Mexico→SM, tricycle, and tricycle-plus-jeep responses for REGULAR and STUDENT categories, including exact geometry, integer fare, transfer count, and fare/distance provenance. **HTTP transport/authentication and live external walking were not retested.** Full saved DTOs are in `batch-a5b-passenger-api-results.json`.

The small map smoke test passes these saved actual Passenger DTOs through the existing frontend journey/map adapters and MapLibre presentation pipeline, using a map adapter double. It verifies exact approved route coordinates, retained DEVICE current-location point, fit on explicit intent, and no camera reset on geometry updates. Existing related tests cover transport-node rendering, camera preservation, and REAL/SIMULATED isolation. **This was a pipeline smoke test, not a live browser visual inspection.** No map/UI runtime code was changed in A.5B.

Database tests that insert or activate prepared research records were deliberately excluded from this phase. Earlier A.5A reports and `check-batch-a5-database.js` retain their historical pre-application baseline; the current checkpoint is validated by the A.5B tests. Existing database tests that expected missing geometry were updated to verify exact approved geometry against the frozen candidates and committed application receipt.

A broken user-global npm launcher was bypassed with the installed Node.js npm CLI to execute `test:batch-a`; that script and the final regression run passed. No global installation was changed.

## Evidence and remaining limitations

- `scripts/data/batch-a5b-approved-geometry.json`: approval and frozen candidate hashes.
- `batch-a5b-before-application.json`: original target values, counts, digest, all-table row hashes, and sequences.
- `batch-a5b-application-receipt-dry-run.json`: pre-application plan.
- `batch-a5b-application-receipt.json`: exact committed before/after values and 12 changed rows.
- `batch-a5b-application-receipt-reapply.json`: zero-change rerun proof.
- `batch-a5b-production-fare-validation.json`: current database-derived fares and journey totals.
- `batch-a5b-passenger-api-results.json`: real controller response DTOs and test scope.
- `batch-a5b-database-regressions.json`: all 14 database/integration command results.
- `batch-a5b-approved-geometry-application.json`: concise machine-readable completion summary and final audit.

There are **zero remaining pilot `FARE_DISTANCE_UNAVAILABLE` results** in the tested supported journeys. No unresolved pilot geometry/fare-data problem was found. Schedule/service/ETA remain unknown where unsupported; no availability, timetable, or travel-time claim was invented. Historical artifact checksum and API/map validation scope limits are stated above. A.5B is complete and awaits user review.
# Historical approved geometry application

This document records the 5 October 2026 local pilot application. Local receipt,
checkpoint and validation links below are historical evidence, excluded from
Git. They are not required by portable tests; approved assets/manifests retain
their original hashes. Deploying source alone does not copy this data to Neon.
