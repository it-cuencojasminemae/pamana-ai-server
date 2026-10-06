# Batch A.5: read-only pilot audit and provenance stop

Historical record (4 October 2026), superseded by the approved Batch A.5B
application. Descriptions of missing geometry below refer to that earlier audit.
The machine-readable database evidence remains private/local and is not a
portable regression dependency.

Audit completed 4 October 2026, Asia/Manila. Implementation stopped at the user's A.5.6 condition. No application code, schema, route geometry, cumulative distances, planning flags or verification values were changed. Geoapify routing requests were not made; no candidate distances or fares have been invented. These two audit documents are the only new files for this request.

## Why implementation stopped

The request says: “If no semantically correct geometry provenance exists, STOP before changing the schema and report the issue.”

The exact current `RouteVariant.geometry_source` enum is:

`FIELD_GPS`, `AUTHORITATIVE`, `GOOGLE_ROAD_MATCHED`, `MANUAL_VERIFIED`, `SIMULATED`, `UNKNOWN`.

There is no provider-derived/candidate value appropriate for an unreviewed Geoapify driving route. GOOGLE_ROAD_MATCHED would misidentify the provider. FIELD_GPS, AUTHORITATIVE and MANUAL_VERIFIED would claim evidence that generation alone does not supply. SIMULATED would misrepresent the real road-routing provenance, and UNKNOWN cannot establish a trusted fare geometry source. The frontend has an existing display-only APPROXIMATE_ROAD_PATH classification, but it is not a RouteVariant geometry_source and cannot authorize fare calculation.

The backend's configured Geoapify server key is present. Existing backend Geoapify routing supports walking; existing frontend driving-route support produces display-only approximate road paths. These implementations were inspected without changing them or exposing the key.

A possible continuation is to generate standalone GeoJSON candidates with explicit Geoapify provider metadata while leaving the database enum and all route records untouched. Those files would remain untrusted review artifacts. Following actual manual review, a separately authorized application step could use MANUAL_VERIFIED only if that review establishes the geometry's suitability for the actual jeepney corridor, while retaining Geoapify provenance. If a provider-specific database source is desired instead, a schema proposal would need a separate decision before implementation. Neither continuation has been implemented here.

## Exact current pilot variants

All four variants have:

- `geometry_geojson: null`
- `geometry_source: UNKNOWN`
- `encoded_polyline: null`
- `planning_enabled: true`
- `verification_status: FIELD_VERIFIED`
- `data_mode: REAL`
- two ordered RouteVariantStops, each with `distance_from_variant_start_m: null`
- loaded `effective_from: 2026-09-26`, `effective_to: null`

| Variant / row ID | Direction | Signboard | Ordered node codes / stop row IDs |
|---|---|---|---|
| RCH-SJ-SMROB-OUT / 3 | OUTBOUND | SM Pampanga | 1: RCH-PSU-MEXICO-FRONT / 17; 2: RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF / 18 |
| RCH-SJ-SMROB-IN / 4 | INBOUND | SAN JUAN | 1: RCH-ROB-STARMILLS-ARAYAT-GATE-LOAD / 19; 2: RCH-PSU-MEXICO-FRONT / 20 |
| PILOT-ARAYAT-SF-MEXICO-BAYAN-SM-OUT / 9 | OUTBOUND | SM Pampanga | 1: RCH-MEXICO-BAYAN-STA-MONICA-TRANSFER / 23; 2: RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF / 24 |
| PILOT-PSU-MEXICO-BAYAN-TRICYCLE-OUT / 10 | OUTBOUND | null | 1: RCH-PSU-MEXICO-FRONT / 21; 2: RCH-MEXICO-BAYAN-STA-MONICA-TRANSFER / 22 |

Each referenced node is planning-enabled, FIELD_VERIFIED and REAL. Exact loaded coordinates:

| Node code | Latitude | Longitude |
|---|---:|---:|
| RCH-PSU-MEXICO-FRONT | 15.128026422211173 | 120.69826461388278 |
| RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF | 15.05158520927461 | 120.69885494898818 |
| RCH-ROB-STARMILLS-ARAYAT-GATE-LOAD | 15.050605637995128 | 120.69778203294244 |
| RCH-MEXICO-BAYAN-STA-MONICA-TRANSFER | 15.064333794084051 | 120.72025022065026 |

Exact stop permissions:

| Stop row ID | Sequence | Pickup | Dropoff | Transfer | Cumulative metres |
|---|---:|---|---|---|---|
| 17 | 1 | true | true | false | null |
| 18 | 2 | false | true | false | null |
| 19 | 1 | true | false | false | null |
| 20 | 2 | false | true | false | null |
| 23 | 1 | true | false | true | null |
| 24 | 2 | false | true | false | null |
| 21 | 1 | true | false | false | null |
| 22 | 2 | false | true | true | null |

No additional passenger stops or waypoint coordinates were inferred from the research locality sequence. Outbound and inbound geometries remain separate missing records; neither was created by reversing the other.

## Distance, fare and review state

| Variant | Candidate road distance | Candidate regular / discounted fare | State |
|---|---|---|---|
| RCH-SJ-SMROB-OUT | Not generated | Unavailable / unavailable | Provenance decision pending |
| RCH-SJ-SMROB-IN | Not generated | Unavailable / unavailable | Provenance decision pending |
| PILOT-ARAYAT-SF-MEXICO-BAYAN-SM-OUT | Not generated | Unavailable / unavailable | Provenance decision pending |
| PILOT-PSU-MEXICO-BAYAN-TRICYCLE-OUT | Not generated; not required for fixed fare | PHP 100 DEMO_ESTIMATE; no invented discount | Existing fixed estimate unchanged |

The actual jeep road paths are still uncertain because only endpoint transport coordinates exist. No road-path or candidate-fare review map is available yet. Existing Passenger journeys retain the Batch A behavior: unavailable jeep distance remains FARE_DISTANCE_UNAVAILABLE; tricycle-plus-jeep has known subtotal 100 and a null full total. The direct/return jeep journey has zero transfers; the tricycle-plus-jeep journey has one.

The prepared Batch A research records were not applied. City Proper was not modified. No planning gate, transport verification, source evidence, REAL/SIMULATED separation or frontend presentation was altered.

## Database and checks

The audit used a read-only transaction and existing variant-loading helpers. Transport counts remain: 10 nodes, 8 routes, 4 variants, 8 variant stops, 2 fare rules and 0 service patterns. Planning-enabled counts remain 4 nodes, 3 routes and 4 variants.

Before and after transport digest:

`3d63fcdb5d9581d71e2c68d54db9c00868510dcc9b91e6e38fcb893373af9139`

The exact machine-readable audit, including loaded names, coordinates, permissions and status fields, is saved in `documentation/batch-a5-pilot-audit.json`. No database writes, schema changes, commits or pushes occurred. No implementation regression suite or build was run for this stopped read-only audit; the previously reported Batch A results are not claimed as a new Batch A.5 test run. `git diff --check` was run for the audit documentation.

Batch B and Batch C have not started. A decision on the candidate geometry provenance/workflow is required before continuing Batch A.5.
