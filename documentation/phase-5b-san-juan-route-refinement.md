# Phase 5B — San Juan / Mexico journey research refinement

## NOT YET VERIFIED FOR PASSENGER ROUTING

REMOTE VISUAL CORROBORATION — NOT PHYSICAL FIELD VERIFICATION.

Recorded 2026-09-23. All five new database records are `CORROBORATED_RESEARCH`, `REAL`, and `planning_enabled = false`. No trust enum, schema, permissions, frontend, Maps integration, or journey endpoint is changed.

## CONFLICTING / MULTIPLE SERVICE PATTERNS

Earlier commuter evidence supports a direct PSU Mexico / San Juan → SM/Rob service. Separate local testimony describes a commonly used two-leg journey: PSU/San Juan → local jeep → Mexico Bayan / Sta. Monica area → transfer to a mostly Arayat/San Fernando-bound jeep → SM Pampanga, Robinsons, or San Fernando Palengke.

These accounts need not conflict. Both remain candidate patterns, not universally available services. Limited hours, school demand, operating days, or differing reliability are possible explanations, not established facts. The direct evidence and original route are preserved. The transfer journey exists only in the manifest and this documentation; it is not executable by `/api/trip-search`.

## Records and endpoint relations

All `RCH-` codes are PAMANA internal research identifiers, not official LTFRB identifiers.

| Type / code | Research concept | Evidence / limitation |
| --- | --- | --- |
| Node `RCH-PSU-MEXICO-FRONT` | Pampanga State University Mexico Campus – Front Waiting Area; `DESIGNATED_STOP`, San Juan, Mexico, Pampanga | Commuters report jeepneys/tricycles waiting in front, space reportedly provided by university, and return drop-off at the same point. Formal terminal/designation unconfirmed. |
| Node `RCH-MEXICO-BAYAN-STA-MONICA-TRANSFER` | Mexico Bayan – Sta. Monica Parish Church Transfer Area; `TRANSFER_POINT`, Mexico, Pampanga | Local transfer testimony plus remote review and temporary municipal pickup/drop evidence. Not proof of a permanent everyday terminal. |
| Route `RCH-ARAYAT-SF-VIA-STAANA-MEXICO` | Arayat – San Fernando via Sta. Ana, Mexico | LPTRP through-route inventory. Inactive research candidate, not an active fleet or service claim. |
| Variant `RCH-SJ-SMROB-OUT` | PSU front → SM City Pampanga Main Gate Drop-off Area | Parent `RCH-SJ-CSF-SM-ROB`; `OUTBOUND`; reported signboard `SM/Rob`. |
| Variant `RCH-SJ-SMROB-IN` | Robinsons Starmills Arayat Gate Return Loading Area → PSU front | Same parent; `INBOUND`; inbound signboard unknown/null. Not an automatic reversal of outbound. |

Existing `RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF` and `RCH-ROB-STARMILLS-ARAYAT-GATE-LOAD` remain unchanged. A single PSU node represents both reported boarding and return alighting. No pickup/dropoff sequence is asserted yet. Both variants have `operating_status = UNKNOWN`, `geometry_source = UNKNOWN`, and null polyline/GeoJSON. Both new nodes have null latitude, longitude, Place ID and unassessed accessibility.

## Evidence chain and limits

The versioned manifest is `scripts/data/phase5b-san-juan-transfer-research.json`. Each record references named sources; database `source_reference` points to this manifest. Local testimony is supplied in the Phase 5B brief; respondent identity and interview date are not provided or invented. The team reports Street View review on 2026-09-23; screenshots/capture dates were not supplied to this implementation. No private browser or screenshot metadata is retained.

- [City of San Fernando LPTRP research copy](https://www.scribd.com/document/863526648/Final-Draft-LPTRP-CSF-Rev-compressed): Table 16, printed page 41, includes Arayat–San Fernando via Sta. Ana/Mexico, attributed to the LTFRB Region III inventory. Cover/body year labels differ (2024–2026 / 2023–2026). Non-city hosting limits this to corroborated research. Authorized units are not current active fleet counts. No fares, exact stops, or schedules are inferred.
- [Municipality of Mexico temporary Libreng Sakay advisory](https://www.mexicopampanga.gov.ph/libreng-sakay-continues-for-affected-communities/): identifies the Mexico Bayan area in front of Sta. Monica Parish Church for temporary transport-strike service. This does not prove a permanent terminal or the exact Arayat/San Juan bay. Event hours are not ordinary jeepney hours.
- Earlier direct-service evidence remains in the Phase 4/5A manifests and evidence document. New local testimony supplements, rather than replaces, it.

## Waypoints are not verified passenger stops

Preserved earlier reported outbound sequence: PSU / San Juan → Santa Cruz → Laput → Balas → San Carlos → Mexico Bayan → Sto. Cristo → Lagundi → SM/Rob.

These may be landmarks/localities, not formal stops. Pickup/dropoff behavior is unknown. **No RouteVariantStops are created.** The team-reviewed Robinsons–PSU Google driving route is a geographic road-reference only, not transit geometry. Camera coordinates and mall centroids are not transport-point coordinates.

## Fare, dispatch and approximate service end

[RA 11314, Sections 3–5](https://lawphil.net/statutes/repacts/ra2019/ra_11314_2019.html) establishes a 20% discount on domestic regular fares for eligible students, subject to its coverage and documentation requirements. This is policy/documentation only. Regular fares for both legs remain unknown. Remembered discounted payments and road distance are not reliable regular-fare sources. No fare or total student payment is calculated; FareRules remain zero.

Reported dispatch is `LEAVE_WHEN_FULL`, particularly at the campus/waiting area; it is not independently established for every leg. Campus jeepneys are reportedly usually unavailable after approximately 16:30. This is not a guaranteed last trip. No ServicePatterns are created, no fixed headway is inferred, and no `last_trip_time` is stored.

## Safe seed and validation

Run `npm run seed:phase5b`. The explicit transactional seed creates missing records and endpoint relations under short locks. Matching research is a no-op. Field-verified, authoritative, planning-enabled, or dated verified records are protected. Other manually edited research causes a failure for reconciliation, not silent replacement. Existing rows are hash-compared before commit; no update/delete of existing records is performed. Earlier phases must be seeded first.

Run `npm run test:phase-5b` and `npm run test:phase-5b-db` after seeding. Database tests reseed twice, exercise stronger-evidence protection using rolled-back fixtures, verify asymmetric relations and null facts, and pass actual database research routes into the existing trip-search controller to confirm exclusion. No future journey model is added.

Earlier database tests now allow additive Phase 5B research variants/routes while retaining their legacy-preservation, no-operational-data, and planning-gate assertions. The field checklist remains at `documentation/phase-5-san-juan-field-verification-checklist.md`.

## Local PostgreSQL seed receipt — 2026-09-23

| Table | Before | After |
| --- | ---: | ---: |
| routes | 6 | 7 |
| transport_nodes | 8 | 10 |
| route_variants | 0 | 2 |
| route_variant_stops | 0 | 0 |
| fare_rules | 0 | 0 |
| service_patterns | 0 | 0 |

Unchanged legacy counts: route stops 7, vehicles 4, trips 0, vehicle locations 0, disruptions 0, passenger reports 4, drivers 1. The seed compared full-row hashes for all existing records in these tables plus the new knowledge tables and variant endpoint/route links: none changed or disappeared. Second committed seed run was a no-op. Five new research records: `CORROBORATED_RESEARCH = 5`, `REAL = 5`, `planning_enabled = true: 0`.

Local record/document IDs (other databases will allocate their own IDs):

| Internal code | Row ID | Document ID |
| --- | ---: | --- |
| RCH-PSU-MEXICO-FRONT | 11 | 3780fd3ecbea93498b9291d0 |
| RCH-MEXICO-BAYAN-STA-MONICA-TRANSFER | 12 | 89f160d2fe6d1a1e259539f3 |
| RCH-ARAYAT-SF-VIA-STAANA-MEXICO | 8 | c26109b17b1d918e48139a46 |
| RCH-SJ-SMROB-OUT | 3 | 8bc5f7bcd7f6ef3b633aa631 |
| RCH-SJ-SMROB-IN | 4 | cc642aaf4b6afc5a263649d3 |

Sequence gaps reflect the intentionally rolled-back dry run; they are not missing/deleted records. No Strapi schema synchronization or startup backfill was needed for this data-only phase.

Validation passed: Phase 1, 2, 3, 4, 5A and 5B suites; Phase 3/4/5A/5B database suites; planning eligibility; trip-search planning gate; time-slot tests (18 cases); frontend trip-planner selection contract; backend and frontend production builds. Conflict-marker, whitespace, prohibited-file and configured-secret scans passed. Frontend source remains unchanged. No Phase 6 work was performed.
