# Phase 4 — Mexico to San Fernando Research Knowledge Seed

## NOT YET VERIFIED FOR PASSENGER ROUTING

Every Route and Transport Node created by this phase has `planning_enabled = false`. The records contain research leads, not passenger instructions. There are no seeded fares, schedules, travel times, route geometries, stop sequences, terminal claims, loading-bay claims, signboards, or guessed coordinates.

The `RCH-` codes below are PAMANA internal research identifiers. They are not official LTFRB route codes.

## Seeded database records

### Routes

| Internal code | Candidate | Status | Data mode | Planning | Database ID / document ID |
|---|---|---|---|---|---|
| `RCH-SJ-CSF-SM-ROB` | San Juan ↔ City of San Fernando via SM City / Robinsons Starmills | `CORROBORATED_RESEARCH` | `REAL` | false | `3` / `25093a7f635ec36fa4a871d6` |
| `RCH-SJ-CSF-SAN-JOSE` | San Juan ↔ City of San Fernando via San Jose | `CORROBORATED_RESEARCH` | `REAL` | false | `4` / `b4150ba997287897ad143df9` |
| `RCH-MEX-CSF-SM` | Mexico ↔ City of San Fernando via SM City | `CORROBORATED_RESEARCH` | `REAL` | false | `5` / `fac3768d0d71b59b0c6ce280` |
| `RCH-MEX-CSF-SJ-LAG` | Mexico ↔ City of San Fernando via San Jose / Lagundi | `CORROBORATED_RESEARCH` | `REAL` | false | `6` / `37fa5a2d05d25d21e8e7ef29` |

These Route rows use only broad place names needed by the existing compatibility schema. `base_fare`, `estimated_travel_time`, and `transport_mode` remain null. Routes are inactive as well as planning-disabled.

### Transport-node research candidates

| Internal code | Candidate classification | Status | Coordinates | Planning | Database ID / document ID |
|---|---|---|---|---|---|
| `RCH-NODE-CSF-SM-CITY` | SM City Pampanga — `DESTINATION` | `CORROBORATED_RESEARCH` | null / null | false | `1` / `a70c5019ff7dc2820c5e1745` |
| `RCH-NODE-CSF-ROBINSONS-STARMILLS` | Robinsons Starmills — `DESTINATION` | `CORROBORATED_RESEARCH` | null / null | false | `2` / `153845dfa8cc7772b3cf0201` |
| `RCH-NODE-CSF-DOLORES-INTERSECTION` | Dolores / Intersection — `TRANSFER_POINT` candidate | `RESEARCH_CANDIDATE` | null / null | false | `3` / `6d92d554bd4c0f6f4daac524` |
| `RCH-NODE-CSF-PUBLIC-MARKET-CITY-PROPER` | Public Market / City Proper — `DESTINATION` | `RESEARCH_CANDIDATE` | null / null | false | `4` / `19b4a3d546e60cedbea79d6d` |
| `RCH-NODE-CSF-JBLMGH` | JBLMGH — `ESSENTIAL_SERVICE` | `RESEARCH_CANDIDATE` | null / null | false | `5` / `dc00a91681769617b45f063e` |
| `RCH-NODE-CSF-DMGC-MAIMPIS` | Government Center / Maimpis — `ESSENTIAL_SERVICE` | `RESEARCH_CANDIDATE` | null / null | false | `6` / `4b791e9b2080db00ba89d7ba` |

These are place-resolution candidates, not verified passenger transport points. No route, variant, or stop relations are created.

### Intentionally empty operational tables

- Route variants: 0 Phase 4 records
- Route variant stops: 0 Phase 4 records
- Fare rules: 0 Phase 4 records
- Service patterns: 0 Phase 4 records

## Geographic context retained in the manifest

The PSA PSGC source supports Mexico's 2024 population context (187,597) and the rural classification/population facts for San Juan (4,600), Tangle (5,657), San Patricio (5,051), San Vicente (4,717), San Carlos (3,430), San Pablo (3,196), Nueva Victoria (3,181), Culubasa (3,177), and San Lorenzo (3,170).

San Juan is marked as the primary pilot candidate. The authoritative status applies only to its geographic/population fact. It does not make a San Juan transport service authoritative. No barangay centroid or fictional barangay pickup node is created.

## Evidence chain and limits

| Source | Status/use | What it supports | What it does not support |
|---|---|---|---|
| PSA PSGC — Barangays of Mexico | `AUTHORITATIVE_CURRENT` for geography only | Rural classification and 2024 population context | Transport service, loading point, fare, schedule, path |
| City of San Fernando LPTRP 2023–2026 research copy | `CORROBORATED_RESEARCH` | Named route-inventory candidates and broad via descriptions | Current fleet count, exact path, boarding point, fare, timetable |
| 2009 LTFRB notice in Punto | `HISTORICAL_UNVERIFIED` | Historical San Juan–San Fernando via SM/Robinson route proceeding | Current operation or passenger readiness |
| 2026 City of San Fernando business registry | Research corroboration | Named associations/transport activity; an SM terminal reference for one registry entry | A business address as a boarding point; route operations |
| Municipality of Mexico CLUP/Main Report | `HISTORICAL_UNVERIFIED` | Historical TODA/designated-route descriptions | Current service or route truth |
| Mexico Libreng Sakay advisory | Event evidence | Temporary replacement service during a transport strike | A permanent normal route |
| Mexico road-closure advisory | Event evidence | Need for time-bounded closure/rerouting support | A current active disruption or permanent reroute |
| PIA Pampanga flood reports | Resilience context | Province-wide flood impacts | A specific blocked PAMANA route or road |

Authorized-unit counts in the LPTRP copy are deliberately not stored as current active fleet counts.

## Historical TODA evidence (manifest only)

The manifest retains eight `HISTORICAL_UNVERIFIED`, `REAL`, planning-disabled leads without cluttering the live Route collection: SAN JUAN, SAN VICENTE, SAPA/SAN PATRICIO, SAN CARLOS, NV, SASL, PTBT, and SMP. No live Route records are generated for these entries.

## Seeder behavior

`npm run seed:phase4` reads the versioned JSON manifest and performs a short PostgreSQL transaction protected by an advisory transaction lock. It creates missing `RCH-` Routes and Transport Nodes, updates research-owned metadata only when evidence is not stronger, and makes no update when values already match.

The seed never turns planning on. `FIELD_VERIFIED` and `AUTHORITATIVE_CURRENT` records are protected from all research-seed updates, and a stronger research status is not downgraded. Operational facts such as coordinates, accessibility assessments, fare, travel time, geometry, signboard, relations, and schedules are never updated by this seeder.

## Unresolved field-verification questions

The Phase 5 checklist covers the exact San Juan boarding point and coordinates, signboard, vehicle type, paths in both directions, stops/landmarks, SM/Robinson alighting and reverse boarding points, current fare, operating window, dispatch behavior, observed wait/travel time, operator confirmation, and accessibility/safety observations.

See `documentation/phase-5-san-juan-field-verification-checklist.md`.
