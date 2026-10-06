# Batch A.5A — standalone candidate geometry review

Historical candidate review (5 October 2026), superseded by Batch A.5B approval.
Original candidate GeoJSON bytes remain immutable. The report and screenshot
links below refer to local historical evidence, excluded from Git. No review
server is started automatically; manual tooling needs locally installed MapLibre.

All four candidates are **PENDING_MANUAL_REVIEW**. They are external Geoapify road artifacts; no route geometry, distance, fare, provenance, eligibility or schema was applied to PostgreSQL. No Batch A.5B, B or C work, commit or push was performed.

Candidate generation timestamp: 2026-10-05T00:46:31.249Z. See the [machine-readable report](batch-a5-candidate-geometry-review.json) for exact metrics, request IDs, endpoint coordinates, safe provider road steps, fare calculations and before/after audits.

## Open the review page

The review server is running at **http://127.0.0.1:8765/**. Open that URL in the Codex browser or your usual browser. It is a separate local MapLibre page and has no dependency on a Passenger login, Strapi server or Nuxt server.

If the server has stopped, run from `E:\Programming Files\Pamana with AI\pamana-backend`:

```powershell
node scripts/serve-batch-a5-review.js
```

Keep the terminal running. Ctrl+C stops it. If port 8765 is occupied, set `$env:BATCH_A5_REVIEW_PORT = "8766"` and run the same command; use the corresponding URL. The server binds only to 127.0.0.1, accepts GET/HEAD, and serves an exact file allowlist. It loads the existing frontend MapLibre 6.11.1 installation. No credentials or database connections are used by the viewer. Internet access is needed for the attributed OpenStreetMap basemap; route artifacts are local.

Choose a variant in the dropdown. Purple lines and arrows show the candidate and travel direction. Green O and red D identify the exact database endpoints; blue markers identify the other known pilot transport nodes. Orange dashed snapping gaps are display-only and are excluded from fare distance. Use zoom and Fit candidate, inspect road segments under the directions disclosure, and download the selected GeoJSON if needed. On narrow screens the controls and map are stacked; scroll within the controls panel for fares, warnings and notes.

A [saved outbound map screenshot](batch-a5-candidates/review-outbound.jpg) records the rendered candidate, exact endpoints and road direction. This is visual evidence of the viewer only, not route approval.

The review notes control downloads a local JSON for all four candidates, tied to their request IDs. It does not send an approval or apply anything. Notes stay in the browser tab until downloaded.

## Candidate road distances

Geoapify was called independently for all four ordered endpoint pairs with `mode=drive`, `type=balanced`, `units=metric`, `traffic=free_flow`, `format=geojson`, `details=route_details`. No geocoding, waypoint invention, inbound reversal or shortest-path assumption was used. Provider response request properties were discarded; only safe fields were copied. Parameter and metric meanings were checked against [Geoapify routing documentation](https://apidocs.geoapify.com/docs/routing/). These are driving candidates, not confirmation of actual transit corridors.

| Variant | Provider metres | Provider km | Measured metres | Measured − provider (m) | Free-flow seconds |
| --- | ---: | ---: | ---: | ---: | ---: |
| RCH-SJ-SMROB-OUT | 10709 | 10.709 | 10694.258 | -14.742 | 890.5 |
| RCH-SJ-SMROB-IN | 11179 | 11.179 | 11164.519 | -14.481 | 940.8 |
| PILOT-ARAYAT-SF-MEXICO-BAYAN-SM-OUT | 3013 | 3.013 | 3006.784 | -6.216 | 194.082 |
| PILOT-PSU-MEXICO-BAYAN-TRICYCLE-OUT | 7696 | 7.696 | 7687.475 | -8.525 | 696.418 |

Geometry measurement independently sums the great-circle lengths of consecutive road-polyline vertices with Earth radius 6,371,000 m. It does not measure the origin-to-destination chord, add endpoint snapping gaps, or bridge disconnected parts. All current candidates are supported MultiLineString road geometries with no disconnected-part gap. Small differences from provider metrics are recorded, not silently corrected. All distances are candidate road distances and have not become approved fare distances. Durations exclude queues, loading and transit stops.

## CANDIDATE_FARE_PREVIEW

Preview uses provider-reported distance in metres at full precision, with the existing `rawJeepneyFare` Batch A policy: traditional 14 + max(0, km − 4) × 2; modern 17 + max(0, km − 4) × 2.4. Regular = Math.round(raw); 20% discounted = Math.round(raw × 0.8), before rounding the regular amount. These are supplied product-policy previews and do not establish a verified fare matrix or modern service.

| Variant | Traditional raw | Traditional regular | Traditional discounted | Modern raw | Modern regular | Modern discounted |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| RCH-SJ-SMROB-OUT | 27.418 | PHP 27 | PHP 22 | 33.1016 | PHP 33 | PHP 26 |
| RCH-SJ-SMROB-IN | 28.358 | PHP 28 | PHP 23 | 34.229600000000005 | PHP 34 | PHP 27 |
| PILOT-ARAYAT-SF-MEXICO-BAYAN-SM-OUT | 14 | PHP 14 | PHP 11 | 17 | PHP 17 | PHP 14 |

PSU → SM direct: one vehicle leg, zero transfers. Robinsons → PSU return: one vehicle leg, zero transfers, using its independently generated 11.179 km path. Their distances and fares are not assumed equal.

PSU → tricycle → Mexico Bayan → jeep → SM: two vehicle legs, **one transfer**. Leg 1 remains exactly **PHP 100, DEMO_ESTIMATE**, with no distance-based tricycle fare calculation. Leg 2 uses the 3.013 km candidate jeep path. Traditional preview total = 100 + 14 = **PHP 114 regular**, or 100 + 11 = **PHP 111 discounted**. Modern alternative preview = **PHP 117 regular / PHP 114 discounted**. These totals are CANDIDATE_FARE_PREVIEW only; the actual production total remains unavailable.

## Manual review checklist and uncertainty

No inappropriate shortcut or private-road use is established by this generation step. Provider road classes and visual map checks identify places to inspect; they cannot prove vehicle access, the exact operating corridor or mall loading behavior. The visual check confirmed all four lines render with switching, endpoints, direction arrows and known pilot nodes. Manual review is still pending.

### RCH-SJ-SMROB-OUT

Pampanga State University Mexico Campus – Front Waiting Area → SM City Pampanga Main Gate Drop-off Area. OUTBOUND; GEOAPIFY / drive. Review file: [RCH-SJ-SMROB-OUT.candidate.geojson](batch-a5-candidates/RCH-SJ-SMROB-OUT.candidate.geojson).

Confirm the actual San Juan / SM jeep corridor; zoom into the approach and correct SM Main Gate drop-off. The provider uses Mexico-Arayat Road, Jose Abad Santos Avenue and SM Loading and Unloading Bay. Verify that the bay approach is appropriate for the jeep rather than a private or unsuitable access lane.

Exact node-to-road snapping gaps: origin 4.229 m; destination 7.258 m. Original coordinates were neither geocoded nor moved. Do not treat snapped endpoints as replacements for the transport nodes.

- Endpoint-only passenger-car route; actual jeepney corridor is unconfirmed.
- Balanced driving route is not evidence of the fixed jeepney path.
- Duration is free-flow driving time; excludes waiting, loading and transit stops.
- No intermediate waypoint coordinates supplied or invented.
- Road snapping differs from exact nodes: origin 4.23 m; destination 7.26 m. Gaps are not added to fare distance.
- Inspect possibly unsuitable road classes/access: service_other: SM Loading and Unloading Bay. This is a review flag, not a claim that these roads are forbidden.

### RCH-SJ-SMROB-IN

Robinsons Starmills – Arayat Gate Return Loading Area → Pampanga State University Mexico Campus – Front Waiting Area. INBOUND; GEOAPIFY / drive. Review file: [RCH-SJ-SMROB-IN.candidate.geojson](batch-a5-candidates/RCH-SJ-SMROB-IN.candidate.geojson).

Confirm the exact Robinsons Starmills Arayat Gate loading location and San Juan-bound turns. The initial roads include unnamed service_other, unclassified and tertiary segments before Jose Abad Santos Avenue and Mexico-Arayat Road. Inspect those mall/access segments carefully; this route is a separate request, not a reversal.

Exact node-to-road snapping gaps: origin 10.188 m; destination 4.229 m. Original coordinates were neither geocoded nor moved. Do not treat snapped endpoints as replacements for the transport nodes.

- Endpoint-only passenger-car route; actual jeepney corridor is unconfirmed.
- Balanced driving route is not evidence of the fixed jeepney path.
- Duration is free-flow driving time; excludes waiting, loading and transit stops.
- No intermediate waypoint coordinates supplied or invented.
- Road snapping differs from exact nodes: origin 10.19 m; destination 4.23 m. Gaps are not added to fare distance.
- Inspect possibly unsuitable road classes/access: service_other: unnamed; unclassified: unnamed. This is a review flag, not a claim that these roads are forbidden.

### PILOT-ARAYAT-SF-MEXICO-BAYAN-SM-OUT

Mexico Bayan – Sta. Monica Parish Church Transfer Area → SM City Pampanga Main Gate Drop-off Area. OUTBOUND; GEOAPIFY / drive. Review file: [PILOT-ARAYAT-SF-MEXICO-BAYAN-SM-OUT.candidate.geojson](batch-a5-candidates/PILOT-ARAYAT-SF-MEXICO-BAYAN-SM-OUT.candidate.geojson).

Confirm that the departure from Sta. Monica / Mexico Bayan follows the road used by Arayat / San Fernando-bound jeeps. Check Jose Abad Santos Avenue and the SM Loading and Unloading Bay approach against actual jeep operation.

Exact node-to-road snapping gaps: origin 6.558 m; destination 7.258 m. Original coordinates were neither geocoded nor moved. Do not treat snapped endpoints as replacements for the transport nodes.

- Endpoint-only passenger-car route; actual jeepney corridor is unconfirmed.
- Balanced driving route is not evidence of the fixed jeepney path.
- Duration is free-flow driving time; excludes waiting, loading and transit stops.
- No intermediate waypoint coordinates supplied or invented.
- Road snapping differs from exact nodes: origin 6.56 m; destination 7.26 m. Gaps are not added to fare distance.
- Inspect possibly unsuitable road classes/access: service_other: SM Loading and Unloading Bay. This is a review flag, not a claim that these roads are forbidden.

### PILOT-PSU-MEXICO-BAYAN-TRICYCLE-OUT

Pampanga State University Mexico Campus – Front Waiting Area → Mexico Bayan – Sta. Monica Parish Church Transfer Area. OUTBOUND; GEOAPIFY / drive. Review file: [PILOT-PSU-MEXICO-BAYAN-TRICYCLE-OUT.candidate.geojson](batch-a5-candidates/PILOT-PSU-MEXICO-BAYAN-TRICYCLE-OUT.candidate.geojson).

Confirm that the PSU → Mexico Bayan connection follows roads suitable for the actual tricycle. The driving candidate uses Mexico-Arayat Road and Jose Abad Santos Avenue; a drive profile does not establish tricycle suitability. Its fare remains PHP 100 DEMO_ESTIMATE.

Exact node-to-road snapping gaps: origin 4.229 m; destination 6.558 m. Original coordinates were neither geocoded nor moved. Do not treat snapped endpoints as replacements for the transport nodes.

- Endpoint-only passenger-car route; actual tricycle corridor is unconfirmed.
- Balanced driving route is not evidence of the actual tricycle path.
- Duration is free-flow driving time; excludes waiting, loading and transit stops.
- No intermediate waypoint coordinates supplied or invented.
- Road snapping differs from exact nodes: origin 4.23 m; destination 6.56 m. Gaps are not added to fare distance.

## Possible waypoint guidance

Existing research in [Phase 5B refinement](phase-5b-san-juan-route-refinement.md) preserves PSU / San Juan → Santa Cruz → Laput → Balas → San Carlos → Mexico Bayan → Sto. Cristo → Lagundi → SM/Rob. These are locality names, not verified road waypoints or passenger stops. No precise coordinates were supplied, invented, added as nodes or included in routing. Compare the candidates with the actual corridor; if a correction is needed, identify an evidenced point on the intended road for a separate candidate request. Do not automatically route through locality centroids.

## Database and production behavior

Transport-truth digest before and after: `3d63fcdb5d9581d71e2c68d54db9c00868510dcc9b91e6e38fcb893373af9139`. It also matches the preceding A.5 audit.

Full database row-and-sequence digest before and after: `04ecbb100144b5505999541b90f0555916f151b2dfb75b0a18d32bdd6ef2e30d`. The full checkpoint covers all 96 current-schema tables and 96 sequences. It includes relation tables and cumulative stops that the earlier transport checkpoint did not fully cover. Only hashes/counts are recorded, not private record contents.

Generation and fresh validation used repeatable-read, READ ONLY transactions, followed by rollback and connection close. No seed/apply tests, DDL, UPDATE, INSERT, DELETE or sequence-advancing calls were run. Full row/sequence digests, counts and all four pilot field snapshots match. Geometry_geojson, encoded_polyline and cumulative stop distances remain null; geometry_source remains UNKNOWN; planning_enabled=true, verification_status=FIELD_VERIFIED and data_mode=REAL remain unchanged. RouteVariant enum and schema files were not edited.

The production graph and fare modules were exercised with fresh database-loaded records. Direct and inbound jeep legs still return FARE_DISTANCE_UNAVAILABLE; the transfer journey retains PHP 100 DEMO_ESTIMATE known subtotal and a null total. Simulated variants remain excluded from default REAL planning. No production service imports the candidate files, and the review server exposes no write endpoints. City Proper and unapplied research records remain unchanged.

## Validation

- `node --env-file=.env --test scripts/test-batch-a5-candidates.js`: 10 tests passed (exact endpoints, independent requests, valid road geometry, positive distance, segment measurement, Batch A rounding, fixed tricycle and transfer previews, audit integrity, actual-key leak scan, safe failures and read-only file server).
- `node --env-file=.env scripts/check-batch-a5-database.js`: passed fresh full database/sequence and pilot-field equality, real production fare behavior and REAL/SIMULATED isolation checks. This script is strictly read-only.
- `node scripts/run-batch-a-regressions.js`: 28 applicable backend unit regression commands passed; prior unit receipt regenerated. Existing database seed tests were not run because they can advance sequences even when rolled back.
- Frontend `node --test scripts/test-batch-a-contract.mjs`: 4 tests passed.
- Browser visual check: all four choices rendered independent road lines, endpoint markers, arrows, route metrics, appropriate fare previews and local download links. Narrow layout keeps controls scrollable above the map. No route was manually approved.
- `git diff --check`: passed for backend and frontend. No runtime/build-affecting source or dependencies were added in A.5A, so a full Strapi or Nuxt build is unnecessary; Node syntax, relevant script tests and browser execution were checked.

## Files added or updated in A.5A

- `scripts/generate-batch-a5-candidates.js`: independent provider requests, safe output whitelist, candidate measurement/fare preview and read-only database checkpoints.
- `scripts/serve-batch-a5-review.js`: localhost-only, allowlisted read-only viewer server using installed MapLibre.
- `scripts/test-batch-a5-candidates.js` and `scripts/check-batch-a5-database.js`: artifact/server tests and fresh read-only database/production-fare verification.
- `documentation/batch-a5-candidates/`: four candidate GeoJSON files, `review.html`, `review.js` and the outbound review screenshot.
- `documentation/batch-a5-candidate-geometry-review.md` and `.json`: this report and exact machine-readable evidence.
- `documentation/batch-a-unit-validation.json`: refreshed existing unit regression receipt.

The files already modified during Batch A and its frontend compatibility follow-up remain uncommitted; A.5A adds no production backend or frontend behavior. No package or schema edits were needed.

**Stopped for your manual review under A.5A.18.** Any application of approved geometry, cumulative fare distance or provenance requires the separate Batch A.5B request.
