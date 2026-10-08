# Connected passenger routing — implementation and acceptance report

Recorded 2026-10-08, Asia/Manila. Final authenticated API run: 2026-10-08T10:41:58.906Z.

Implemented one shared planner with explicit operational/research authorization, directional corridor connectors, curated landmarks, pin authorization, and optional selected-journey enrichment. All requested A–J research journeys and the additional San Fernando pin case K passed actual desktop/mobile Passenger UI checks. New research services remain **NOT YET ELIGIBLE** for normal verified planning.

Risk remains **moderate**. Passing software checks does not establish official service availability, curb-side safety, formal termini, or field verification. Zero breakage cannot be guaranteed.

## Root cause and reused inventory

City Proper services were excluded by normal verification gates. The graph attached passengers to eligible point nodes, so it could not board/alight at intermediate corridor positions; absent closer eligible points could favor PSU. The existing Robinsons return variant also denied transfer at its Arayat Gate boarding stop. Research preview now applies a scoped in-memory permission overlay and temporary directional connectors, without changing those stored operational permissions.

Pin controls intentionally fail closed when their independent flag, boundary identity/source/hash review, or authorization is unavailable. Geographic pin permission still does not imply transport coverage.

Reused graph builder, transport loader, journey planner, transfer engine, fare engine/discount policy, disruption logic, availability enrichment, ranking, Geoapify walking/routing, MapLibre infrastructure, pin-area validation, landmark overlay, and existing authentication/rate controls. There is no second planner or developer-only research screen.

| Existing node reused | Stored type | Stored planning status |
|---|---|---|
| RCH-MEXICO-BAYAN-STA-MONICA-TRANSFER | TRANSFER_POINT | FIELD_VERIFIED; REAL; enabled=true |
| RCH-PSU-MEXICO-FRONT | DESIGNATED_STOP | FIELD_VERIFIED; REAL; enabled=true |
| RCH-ROB-STARMILLS-ARAYAT-GATE-LOAD | LOADING_BAY | FIELD_VERIFIED; REAL; enabled=true |
| RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF | DROP_OFF | FIELD_VERIFIED; REAL; enabled=true |

The database currently has 13 transport nodes, 9 routes, 6 variants, 12 variant stops, 2 fare rules, and 0 stored service patterns. These counts include preexisting nonoperational/demo records; only eligible records enter operational planning.

## Database changes and safety

- **No transport schema migration, transport record insertion/update, geometry rewrite, fare rewrite, verification promotion, or stored transfer-permission change.** Research additions and connectors are runtime records.
- Registered two authenticated API actions through the existing role-permission reconciliation: planning-capabilities and journey-details, each for Passenger, LGU, and Administrator (six scoped mappings). Anonymous and Driver access are denied. Existing pin-area/landmarks/travel-time permissions are preserved.
- A disposable localhost Passenger user/profile and associated authentication sessions were created solely for browser acceptance. They were signed out and removed after testing. Existing users were not used or edited.
- Activation/rollback database tests used session-local TEMP tables shadowing public tables. Synthetic verification never reached public transport data.
- Full transport digest before this revision and after cleanup is unchanged: 6e46cafdfcd17b27d30a869ce866fa1075dbe119d7c963299dc50aa521c9647f.

[Final read-only audit](<E:/Programming Files/Pamana with AI/pamana-backend/documentation/connected-database-audit.json>) · [Original inventory/digest](<E:/Programming Files/Pamana with AI/pamana-backend/documentation/connected-routing-before-audit.json>) · [Disposable account cleanup](<E:/Programming Files/Pamana with AI/pamana-backend/documentation/connected-test-account-cleanup.log>)

## Evidence and shared graph behavior

Manifest SAN-JUAN-CSF-LOCAL-RESEARCH-2026-10-08, version 1.0.0: original report 2026-10-07; subsequent receipt 2026-10-08; observation date and field reviewer remain unknown. Software/map review is recorded separately and expressly is not field/LGU/LTFRB verification.

Research records retain REAL + RESEARCH_CANDIDATE with operational planning disabled and no invented verification date. User-reported service behavior, provider-derived research geometry/placement, and simulated observations are labeled separately. REAL alone never grants operational eligibility.

Six separately directed preview variants cover San Juan → Mexico, the two Mexico → City Proper endpoint patterns, SM terminal → Palengke, City Proper → Robinsons, and applicable Arayat → Robinsons. Parent services remain distinct even where corridors overlap. Inbound geometry was generated independently; outbound geometry/order is not reversed to manufacture return service.

Five reviewed preview sections specify service identity, direction, ordered metre range, access/alighting permission, source, and placement provenance. Projection creates temporary hashed connectors, inserts them in directional geometry order, and trims rides to actual boarding/alighting positions. Unknown San Juan roadside permissions remain unavailable. Building coordinates stay landmark references.

San Juan terminal, St. Nicolas alighting, City Proper return loading, both supplied downtown drop-offs, Victory Liner, and McDonald’s retain the supplied full-precision coordinates. Compatible code reuse checks type/position within 15 metres; compatible nearby identity reuse also checks ambiguity. Existing Robinsons Arayat Gate is reused.

The directed SM drop-off → terminal walking link uses Geoapify pedestrian routing. Its observed test route is 392 m rather than hard-coded 350 m. Required pedestrian failure excludes dependent journeys while preserving eligible alternatives. No reverse walk or SM–Robinsons walk is inferred. Instructions visibly warn that exact gate/crossing rules are not field verified.

Return examples use the supported City Proper/roadside → Robinsons service, transfer to the existing SAN JUAN service ending at PSU, then road-based egress to the exact San Juan destination. The tested San Juan terminal egress is 1,386 m. A separate Mexico → San Juan return service was not invented.

[Versioned research manifest](<E:/Programming Files/Pamana with AI/pamana-backend/src/services/pamana-journey/data/connected-research-manifest.json>) · [Research geometry preparation receipt](<E:/Programming Files/Pamana with AI/pamana-backend/documentation/connected-research-geometry-receipt.json>)

## Access, feeders, fares, and categories

Candidate search remains 1,500 m, independently of configurable preferred walking 500 m / hard walking maximum 1,500 m. Preferred must not exceed maximum. Road walking over the hard cap is rejected for access and egress. Minimize-walking influences preference only; it does not establish accessibility or override the cap.

AUTO prefers practical short walking, then considers supported initial feeder alternatives. WALK_ONLY filters initial tricycle services while retaining jeepney use of shared boarding points. FEEDER uses eligible stored tricycle boarding/services. Geographic pins never fabricate door-to-door tricycle coverage. The existing PSU → Mexico tricycle can be used; unsupported San Juan → terminal feeder service remains unreported. No final feeder is added.

Maximum three public-transit rides plus one optional initial feeder is supported. Vehicle changes derive transfer counts; walking is free and does not add a vehicle change. Cycles are rejected. Candidates are grouped by ordered service/directional/endpoint pattern before the five-option limit, with shortest walking and stable tie-breakers.

Each boarding uses the existing fare/discount engine. Research distances are permitted only in preview and carry research provenance. Unknown paid fares yield a partial subtotal and unknown total. Existing demo-estimate tricycle pricing remains expressly demo pricing.

Operational Fastest requires complete comparable duration including waits and walking; Geoapify moving time never supplies that ranking. Cheapest requires complete comparable fares. Most Reliable is unavailable without distinguishing availability evidence. Preview uses separately labeled generated vehicle/headway/duration scenario observations through the same enrichment/ranking pipeline. No field reliability score is invented; one journey can win several categories.

Additional authenticated calculations:

| Scenario | Paid legs | Total | Interpretation |
|---|---|---|---|
| STUDENT_C | RCH-SJ-MEXICO-OUT: ₱15 (SYSTEM_CALCULATED); CSF-MEXICO-MARKET-OUT: ₱13 (SYSTEM_CALCULATED) | ₱28 | Existing rounding/discount rules: ₱15 + ₱13 = ₱28 |
| SUPPORTED_PSU_FEEDER | PILOT-PSU-MEXICO-BAYAN-TRICYCLE-OUT: ₱100 (DEMO_ESTIMATE); CSF-MEXICO-MARKET-OUT: ₱16 (SYSTEM_CALCULATED) | ₱116 | Stored PSU feeder; 127 m walking; ₱100 is a DEMO_ESTIMATE, not a verified tricycle fare |
| SAN_JUAN_ACCESS_TO_STORED_FEEDER | PILOT-PSU-MEXICO-BAYAN-TRICYCLE-OUT: ₱100 (DEMO_ESTIMATE); CSF-MEXICO-MARKET-OUT: ₱16 (SYSTEM_CALCULATED) | ₱116 | Stored PSU feeder; 1422 m walking; ₱100 is a DEMO_ESTIMATE, not a verified tricycle fare |

[Additional fare/feeder responses](<E:/Programming Files/Pamana with AI/pamana-backend/documentation/connected-options-results.json>)

## Backend and frontend changes

Authenticated existing trip-plan accepts optional planningMode and accessPreference, defaulting to Operational/AUTO. Authorization is resolved before request validation/loading. Research requires BOTH PAMANA_DEMO_MODE_ENABLED and PAMANA_RESEARCH_PREVIEW_ENABLED plus an explicit mode request. Capabilities expose effective access policy and authorized references. No operational-to-research retry exists.

Authenticated journey-details is a thin recomputation operation over the same orchestrator, accepting the original request/mode and selected journey ID. Travel-time likewise recomputes the eligible selected journey. Invented journey IDs returned UNAVAILABLE; client routes/durations are never trusted. Controllers retain rate limits, anonymous rejection, Passenger/LGU/Admin scope, and no-store responses.

The actual Passenger Trip Planner has Operational / Research Preview selection, initial-access preference, research badges, separate simulation badges, deterministic preview guides, per-leg fares, ordered access/transfer/egress walking, signboard/driver checks, exact-coordinate persistence, cancellation, stale-response protection, and selected details/estimates. Mode switching clears results and outstanding requests. IDs survive refresh, swapping and Live Map handoff; unavailable IDs never geocode their labels.

Initial client allowance is 12 seconds, selected details/estimate allowance 20 seconds. Provider requests use a seven-second timeout, shared maximum concurrency two, bounded five-minute geography/time caches, and cancellation-aware queues. Provider-phase planning budget is 10 seconds; details/estimates 15 seconds. Independent calculations run concurrently. Optional failure preserves established directions/fares; unresolved access remains pending and required physical-walk failure excludes the candidate.

The details watcher originally repeated requests when enriched objects replaced selected results. Browser acceptance caught it; the watcher now observes the request value and selected ID, and a Vue regression test verifies one details/time request per unchanged selection. A further regression ensures WALK_ONLY retains jeepneys at shared feeder/jeepney stops.

The thirteen curated landmarks are displayed on both passenger maps with category icons/collision-managed labels, selection actions, and style-reload restoration. Makabali remains an alias/reference without an invented coordinate. Palengke search visibly offers named Downtown/Wet Market/Market Plaza choices.

Map style remains runtime/env configurable; local osm-bright was used. Operational rides remain green; research-derived rides are amber. Exact endpoints, roadside connectors, loading/transfer/alighting features and simulated/live vehicles are distinct. Each leg uses routed/stored geometry; unavailable geometry is not filled by a confirmed straight-line shortcut. Context-only research markers do not distort journey camera fit.

Existing San Juan pin verification remains intact. San Fernando uses the same source/hash/identity mechanism with a minimally sourced 35-barangay PSA indicative boundary via DOST GeoRisk. Source reviewed 2026-10-08; these June 2016/PSA2015 indicative boundaries are geographic authorization, not a legal survey or transit verification. The SF pin flag is independent.

[San Fernando boundary source/review](<E:/Programming Files/Pamana with AI/pamana-backend/src/services/pamana-journey/data/san-fernando-boundary-verification.json>)

## Mandatory actual Passenger UI acceptance

All below were submitted in the actual Passenger Trip Planner with Research Preview explicitly authorized. Desktop viewport was 1309×909 CSS pixels; mobile 355×767 CSS pixels under a 390×844 browser override. Every case has desktop/mobile screenshots and DOM evidence; no horizontal document overflow was recorded. Case K also was refreshed, swapped twice, and submitted from mobile. Live Map landmark handoff preserved canonical ID and research mode.

NORMAL VERIFIED PLANNING is NOT YET ELIGIBLE for these new research-service journeys. Existing PSU → SM/Robinsons operational regressions separately PASS. UI PASS means the labeled research journey rendered and could be inspected; it does not mean road-time estimates or field reliability became known.

| Case | Journey | AUTOMATED FIXTURE | RESEARCH PREVIEW UI | NORMAL VERIFIED PLANNING | Evidence |
|---|---|---|---|---|---|
| A | PSU Mexico frontage → St. Nicolas College | PASS | PASS — desktop and mobile | NOT YET ELIGIBLE | [desktop](<E:/Programming Files/Pamana with AI/pamana-frontend/documentation/connected-routing-ui/A-desktop.jpg>) / [mobile](<E:/Programming Files/Pamana with AI/pamana-frontend/documentation/connected-routing-ui/A-mobile.jpg>) |
| B | Exact San Juan acceptance pin → St. Nicolas College | PASS | PASS — desktop and mobile | NOT YET ELIGIBLE | [desktop](<E:/Programming Files/Pamana with AI/pamana-frontend/documentation/connected-routing-ui/B-desktop.jpg>) / [mobile](<E:/Programming Files/Pamana with AI/pamana-frontend/documentation/connected-routing-ui/B-mobile.jpg>) |
| C | San Juan Jeepney Terminal → St. Nicolas College | PASS | PASS — desktop and mobile | NOT YET ELIGIBLE | [desktop](<E:/Programming Files/Pamana with AI/pamana-frontend/documentation/connected-routing-ui/C-desktop.jpg>) / [mobile](<E:/Programming Files/Pamana with AI/pamana-frontend/documentation/connected-routing-ui/C-mobile.jpg>) |
| D | Mexico Bayan / Sta. Monica transfer → St. Nicolas College | PASS | PASS — desktop and mobile | NOT YET ELIGIBLE | [desktop](<E:/Programming Files/Pamana with AI/pamana-frontend/documentation/connected-routing-ui/D-desktop.jpg>) / [mobile](<E:/Programming Files/Pamana with AI/pamana-frontend/documentation/connected-routing-ui/D-mobile.jpg>) |
| E | SM Pampanga main gate drop-off → St. Nicolas College | PASS | PASS — desktop and mobile | NOT YET ELIGIBLE | [desktop](<E:/Programming Files/Pamana with AI/pamana-frontend/documentation/connected-routing-ui/E-desktop.jpg>) / [mobile](<E:/Programming Files/Pamana with AI/pamana-frontend/documentation/connected-routing-ui/E-mobile.jpg>) |
| F | SM Pampanga main gate drop-off → SM Downtown | PASS | PASS — desktop and mobile | NOT YET ELIGIBLE | [desktop](<E:/Programming Files/Pamana with AI/pamana-frontend/documentation/connected-routing-ui/F-desktop.jpg>) / [mobile](<E:/Programming Files/Pamana with AI/pamana-frontend/documentation/connected-routing-ui/F-mobile.jpg>) |
| G | SM Downtown → San Juan Jeepney Terminal | PASS | PASS — desktop and mobile | NOT YET ELIGIBLE | [desktop](<E:/Programming Files/Pamana with AI/pamana-frontend/documentation/connected-routing-ui/G-desktop.jpg>) / [mobile](<E:/Programming Files/Pamana with AI/pamana-frontend/documentation/connected-routing-ui/G-mobile.jpg>) |
| H | Victory Liner Bus Terminal → San Juan Jeepney Terminal | PASS | PASS — desktop and mobile | NOT YET ELIGIBLE | [desktop](<E:/Programming Files/Pamana with AI/pamana-frontend/documentation/connected-routing-ui/H-desktop.jpg>) / [mobile](<E:/Programming Files/Pamana with AI/pamana-frontend/documentation/connected-routing-ui/H-mobile.jpg>) |
| I | McDonald's → San Juan Jeepney Terminal | PASS | PASS — desktop and mobile | NOT YET ELIGIBLE | [desktop](<E:/Programming Files/Pamana with AI/pamana-frontend/documentation/connected-routing-ui/I-desktop.jpg>) / [mobile](<E:/Programming Files/Pamana with AI/pamana-frontend/documentation/connected-routing-ui/I-mobile.jpg>) |
| J | McDonald's → Robinsons Starmills – Arayat Gate Return Loading Area | PASS | PASS — desktop and mobile | NOT YET ELIGIBLE | [desktop](<E:/Programming Files/Pamana with AI/pamana-frontend/documentation/connected-routing-ui/J-desktop.jpg>) / [mobile](<E:/Programming Files/Pamana with AI/pamana-frontend/documentation/connected-routing-ui/J-mobile.jpg>) |
| K | Exact San Fernando acceptance pin → San Juan Jeepney Terminal | PASS | PASS — desktop and mobile | NOT YET ELIGIBLE | [desktop](<E:/Programming Files/Pamana with AI/pamana-frontend/documentation/connected-routing-ui/K-desktop.jpg>) / [mobile](<E:/Programming Files/Pamana with AI/pamana-frontend/documentation/connected-routing-ui/K-mobile.jpg>) |

### Calculated snapshot from the final authenticated backend

These are system/research calculations captured during testing, not promises of operating fares, live traffic, or pickup ETA. UI matching mode/endpoints, directions, signs, transfer instructions, fares, walking, estimates, categories and research/simulation provenance were inspected. Full request/response records retain exact coordinates and clipped geometries.

| Case | Selected service pattern / direction | Paid legs / total | Walking | Optional moving estimate | Plan latency |
|---|---|---|---|---|---|
| A | RCH-SJ-SMROB-OUT (OUTBOUND) → CSF-SM-PALENGKE-OUT (OUTBOUND) | ₱27 + ₱14 = ₱41 | 519 m | COMPLETE: 55 min; walking 8 min, available road 47 min | 2120 ms |
| B | RCH-SJ-MEXICO-OUT (OUTBOUND) → CSF-MEXICO-MARKET-OUT (OUTBOUND) | ₱19 + ₱16 = ₱35 | 218 m | COMPLETE: 35 min; walking 4 min, available road 31 min | 565 ms |
| C | RCH-SJ-MEXICO-OUT (OUTBOUND) → CSF-MEXICO-MARKET-OUT (OUTBOUND) | ₱19 + ₱16 = ₱35 | 127 m | COMPLETE: 33 min; walking 2 min, available road 31 min | 564 ms |
| D | CSF-MEXICO-MARKET-OUT (OUTBOUND) | ₱16 = ₱16 | 127 m | COMPLETE: 18 min; walking 2 min, available road 16 min | 74 ms |
| E | CSF-SM-PALENGKE-OUT (OUTBOUND) | ₱14 = ₱14 | 519 m | COMPLETE: 27 min; walking 8 min, available road 20 min | 511 ms |
| F | CSF-SM-PALENGKE-OUT (OUTBOUND) | ₱18 = ₱18 | 515 m | PARTIAL: combined unknown; walking 8 min, available road unknown | 1026 ms |
| G | CSF-CITY-ROB-IN (INBOUND) → RCH-SJ-SMROB-IN (INBOUND) | ₱14 + ₱28 = ₱42 | 1488 m | COMPLETE: 72 min; walking 23 min, available road 50 min | 491 ms |
| H | CSF-CITY-ROB-IN (INBOUND) → RCH-SJ-SMROB-IN (INBOUND) | ₱14 + ₱28 = ₱42 | 1517 m | PARTIAL: combined unknown; walking 23 min, available road 31 min | 422 ms |
| I | CSF-CITY-ROB-IN (INBOUND) → RCH-SJ-SMROB-IN (INBOUND) | ₱14 + ₱28 = ₱42 | 1386 m | PARTIAL: combined unknown; walking 21 min, available road 31 min | 80 ms |
| J | CSF-ARAYAT-ROB-IN (INBOUND) | ₱14 = ₱14 | 0 m | UNAVAILABLE: combined unknown; walking 0 min, available road unknown | 441 ms |
| K | CSF-CITY-ROB-IN (INBOUND) → RCH-SJ-SMROB-IN (INBOUND) | ₱14 + ₱28 = ₱42 | 1531 m | PARTIAL: combined unknown; walking 23 min, available road 31 min | 461 ms |

### Case A: exact endpoints and inspected legs
Origin: 15.128026422211173, 120.69826461388278 (PILOT_LANDMARK; research-reference-RCH-PSU-MEXICO-FRONT). Destination: 15.04181281734176, 120.68312516113633 (PILOT_LANDMARK; csf-st-nicolas).

- OUTBOUND RCH-SJ-SMROB-OUT: Pampanga State University Mexico Campus – Front Waiting Area [15.128026422211173, 120.69826461388278] → SM City Pampanga Main Gate Drop-off Area [15.05158520927461, 120.69885494898818]; signboard SM Pampanga; fare ₱27; 252 road-geometry points. Wait 0–8 min (SIMULATED).
- TRANSFER: SM City Pampanga Main Gate Drop-off Area → SM Pampanga jeepney terminal; 392 m; 6 min; routed Geoapify pedestrian geometry (27 points).
- OUTBOUND CSF-SM-PALENGKE-OUT: SM Pampanga jeepney terminal [15.051272978367622, 120.69700506569626] → St. Nicolas roadside alighting [15.041419232792958, 120.68347667434843]; signboard Palengke; fare ₱14; 125 road-geometry points. Wait 0–8 min (SIMULATED).
- EGRESS: Transport connector → St. Nicolas College; 127 m; 2 min; routed Geoapify pedestrian geometry (9 points).

Vehicle changes: 1. Total fare ₱41 (KNOWN). Demo total duration 64 min (SIMULATED). Optional road-time status COMPLETE; reasons none.

Selected category badges: recommended, fastest, fewestTransfers, mostReliable. Fastest/Most Reliable comparisons here are explicitly SIMULATED preview evidence; absent distinguishing evidence remains insufficient.

### Case B: exact endpoints and inspected legs
Origin: 15.1178, 120.7029 (MAP_PIN). Destination: 15.04181281734176, 120.68312516113633 (PILOT_LANDMARK; csf-st-nicolas).

- ACCESS: Exact San Juan acceptance pin → Transport connector; 91 m; 2 min; routed Geoapify pedestrian geometry (9 points).
- OUTBOUND RCH-SJ-MEXICO-OUT: San Juan Jeepney Terminal [15.117429648993976, 120.7024058913807] → Mexico Bayan – Sta. Monica Parish Church Transfer Area [15.064333794084051, 120.72025022065026]; signboard Mexico Bayan; fare ₱19; 112 road-geometry points. Wait 0–8 min (SIMULATED).
- OUTBOUND CSF-MEXICO-MARKET-OUT: Mexico Bayan – Sta. Monica Parish Church Transfer Area [15.064333794084051, 120.72025022065026] → St. Nicolas roadside alighting [15.041419232792958, 120.68347667434843]; signboard Palengke; fare ₱16; 177 road-geometry points. Wait 0–8 min (SIMULATED).
- EGRESS: Transport connector → St. Nicolas College; 127 m; 2 min; routed Geoapify pedestrian geometry (9 points).

Vehicle changes: 1. Total fare ₱35 (KNOWN). Demo total duration 50 min (SIMULATED). Optional road-time status COMPLETE; reasons none.

Selected category badges: recommended, cheapest, fastest, fewestTransfers, mostReliable. Fastest/Most Reliable comparisons here are explicitly SIMULATED preview evidence; absent distinguishing evidence remains insufficient.

### Case C: exact endpoints and inspected legs
Origin: 15.117429648993976, 120.7024058913807 (PILOT_LANDMARK; research-reference-RCH-SAN-JUAN-TERMINAL). Destination: 15.04181281734176, 120.68312516113633 (PILOT_LANDMARK; csf-st-nicolas).

- OUTBOUND RCH-SJ-MEXICO-OUT: San Juan Jeepney Terminal [15.117429648993976, 120.7024058913807] → Mexico Bayan – Sta. Monica Parish Church Transfer Area [15.064333794084051, 120.72025022065026]; signboard Mexico Bayan; fare ₱19; 112 road-geometry points. Wait 0–8 min (SIMULATED).
- OUTBOUND CSF-MEXICO-MARKET-OUT: Mexico Bayan – Sta. Monica Parish Church Transfer Area [15.064333794084051, 120.72025022065026] → St. Nicolas roadside alighting [15.041419232792958, 120.68347667434843]; signboard Palengke; fare ₱16; 177 road-geometry points. Wait 0–8 min (SIMULATED).
- EGRESS: Transport connector → St. Nicolas College; 127 m; 2 min; routed Geoapify pedestrian geometry (9 points).

Vehicle changes: 1. Total fare ₱35 (KNOWN). Demo total duration 48 min (SIMULATED). Optional road-time status COMPLETE; reasons none.

Selected category badges: recommended, cheapest, fastest, fewestTransfers, mostReliable. Fastest/Most Reliable comparisons here are explicitly SIMULATED preview evidence; absent distinguishing evidence remains insufficient.

### Case D: exact endpoints and inspected legs
Origin: 15.064333794084051, 120.72025022065026 (PILOT_LANDMARK; research-reference-RCH-MEXICO-BAYAN-STA-MONICA-TRANSFER). Destination: 15.04181281734176, 120.68312516113633 (PILOT_LANDMARK; csf-st-nicolas).

- OUTBOUND CSF-MEXICO-MARKET-OUT: Mexico Bayan – Sta. Monica Parish Church Transfer Area [15.064333794084051, 120.72025022065026] → St. Nicolas roadside alighting [15.041419232792958, 120.68347667434843]; signboard Palengke; fare ₱16; 177 road-geometry points. Wait 0–8 min (SIMULATED).
- EGRESS: Transport connector → St. Nicolas College; 127 m; 2 min; routed Geoapify pedestrian geometry (9 points).

Vehicle changes: 0. Total fare ₱16 (KNOWN). Demo total duration 23 min (SIMULATED). Optional road-time status COMPLETE; reasons none.

Selected category badges: recommended, cheapest, fastest, fewestTransfers, mostReliable. Fastest/Most Reliable comparisons here are explicitly SIMULATED preview evidence; absent distinguishing evidence remains insufficient.

### Case E: exact endpoints and inspected legs
Origin: 15.05158520927461, 120.69885494898818 (PILOT_LANDMARK; research-reference-RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF). Destination: 15.04181281734176, 120.68312516113633 (PILOT_LANDMARK; csf-st-nicolas).

- ACCESS: SM Pampanga main gate drop-off → Transport connector; 392 m; 6 min; routed Geoapify pedestrian geometry (27 points).
- OUTBOUND CSF-SM-PALENGKE-OUT: SM Pampanga jeepney terminal [15.051272978367622, 120.69700506569626] → St. Nicolas roadside alighting [15.041419232792958, 120.68347667434843]; signboard Palengke; fare ₱14; 125 road-geometry points. Wait 0–8 min (SIMULATED).
- EGRESS: Transport connector → St. Nicolas College; 127 m; 2 min; routed Geoapify pedestrian geometry (9 points).

Vehicle changes: 0. Total fare ₱14 (KNOWN). Demo total duration 24 min (SIMULATED). Optional road-time status COMPLETE; reasons none.

Selected category badges: recommended, cheapest, fastest, fewestTransfers. Fastest/Most Reliable comparisons here are explicitly SIMULATED preview evidence; absent distinguishing evidence remains insufficient.

### Case F: exact endpoints and inspected legs
Origin: 15.05158520927461, 120.69885494898818 (PILOT_LANDMARK; research-reference-RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF). Destination: 15.027933147664186, 120.69243525955473 (PILOT_LANDMARK; csf-sm-downtown).

- ACCESS: SM Pampanga main gate drop-off → Transport connector; 392 m; 6 min; routed Geoapify pedestrian geometry (27 points).
- OUTBOUND CSF-SM-PALENGKE-OUT: SM Pampanga jeepney terminal [15.051272978367622, 120.69700506569626] → Palengke / SM Downtown user-reported drop-off [15.029106803132176, 120.69244181889427]; signboard Palengke; fare ₱18; 232 road-geometry points. Wait 0–8 min (SIMULATED).
- EGRESS: Transport connector → SM Downtown; 123 m; 2 min; routed Geoapify pedestrian geometry (8 points).

Vehicle changes: 0. Total fare ₱18 (KNOWN). Demo total duration 33 min (SIMULATED). Optional road-time status PARTIAL; reasons INVALID_PROVIDER_RESPONSE.

Selected category badges: recommended, cheapest, fastest, fewestTransfers. Fastest/Most Reliable comparisons here are explicitly SIMULATED preview evidence; absent distinguishing evidence remains insufficient.

### Case G: exact endpoints and inspected legs
Origin: 15.027933147664186, 120.69243525955473 (PILOT_LANDMARK; csf-sm-downtown). Destination: 15.117429648993976, 120.7024058913807 (PILOT_LANDMARK; research-reference-RCH-SAN-JUAN-TERMINAL).

- ACCESS: SM Downtown → Transport connector; 102 m; 2 min; routed Geoapify pedestrian geometry (7 points).
- INBOUND CSF-CITY-ROB-IN: City Proper return loading area [15.029006842709281, 120.69283148014446] → Robinsons Starmills – Arayat Gate Return Loading Area [15.050605637995128, 120.69778203294244]; signboard Robinsons; fare ₱14; 188 road-geometry points. Wait 0–8 min (SIMULATED).
- INBOUND RCH-SJ-SMROB-IN: Robinsons Starmills – Arayat Gate Return Loading Area [15.050605637995128, 120.69778203294244] → Pampanga State University Mexico Campus – Front Waiting Area [15.128026422211173, 120.69826461388278]; signboard SAN JUAN; fare ₱28; 281 road-geometry points. Wait 0–8 min (SIMULATED).
- EGRESS: Transport connector → San Juan Jeepney Terminal; 1386 m; 21 min; routed Geoapify pedestrian geometry (35 points).

Vehicle changes: 1. Total fare ₱42 (KNOWN). Demo total duration 82 min (SIMULATED). Optional road-time status COMPLETE; reasons none.

Selected category badges: recommended, cheapest, fastest, fewestTransfers. Fastest/Most Reliable comparisons here are explicitly SIMULATED preview evidence; absent distinguishing evidence remains insufficient.

### Case H: exact endpoints and inspected legs
Origin: 15.039373960293801, 120.68311389238005 (PILOT_LANDMARK; csf-victory-liner). Destination: 15.117429648993976, 120.7024058913807 (PILOT_LANDMARK; research-reference-RCH-SAN-JUAN-TERMINAL).

- ACCESS: Victory Liner Bus Terminal → Transport connector; 131 m; 2 min; routed Geoapify pedestrian geometry (5 points).
- INBOUND CSF-CITY-ROB-IN: Roadside boarding point [15.040188070287867, 120.68233930763405] → Robinsons Starmills – Arayat Gate Return Loading Area [15.050605637995128, 120.69778203294244]; signboard Robinsons; fare ₱14; 93 road-geometry points. Temporary directional roadside boarding connector. Wait 0–8 min (SIMULATED).
- INBOUND RCH-SJ-SMROB-IN: Robinsons Starmills – Arayat Gate Return Loading Area [15.050605637995128, 120.69778203294244] → Pampanga State University Mexico Campus – Front Waiting Area [15.128026422211173, 120.69826461388278]; signboard SAN JUAN; fare ₱28; 281 road-geometry points. Wait 0–8 min (SIMULATED).
- EGRESS: Transport connector → San Juan Jeepney Terminal; 1386 m; 21 min; routed Geoapify pedestrian geometry (35 points).

Vehicle changes: 1. Total fare ₱42 (KNOWN). Demo total duration 76 min (SIMULATED). Optional road-time status PARTIAL; reasons INVALID_PROVIDER_RESPONSE.

Selected category badges: recommended, cheapest, fastest, fewestTransfers, mostReliable. Fastest/Most Reliable comparisons here are explicitly SIMULATED preview evidence; absent distinguishing evidence remains insufficient.

### Case I: exact endpoints and inspected legs
Origin: 15.04124663498475, 120.68364202268374 (PILOT_LANDMARK; csf-mcdonalds). Destination: 15.117429648993976, 120.7024058913807 (PILOT_LANDMARK; research-reference-RCH-SAN-JUAN-TERMINAL).

- INBOUND CSF-CITY-ROB-IN: Roadside boarding point [15.041243750711724, 120.68364431346083] → Robinsons Starmills – Arayat Gate Return Loading Area [15.050605637995128, 120.69778203294244]; signboard Robinsons; fare ₱14; 86 road-geometry points. Temporary directional roadside boarding connector. Wait 0–8 min (SIMULATED).
- INBOUND RCH-SJ-SMROB-IN: Robinsons Starmills – Arayat Gate Return Loading Area [15.050605637995128, 120.69778203294244] → Pampanga State University Mexico Campus – Front Waiting Area [15.128026422211173, 120.69826461388278]; signboard SAN JUAN; fare ₱28; 281 road-geometry points. Wait 0–8 min (SIMULATED).
- EGRESS: Transport connector → San Juan Jeepney Terminal; 1386 m; 21 min; routed Geoapify pedestrian geometry (35 points).

Vehicle changes: 1. Total fare ₱42 (KNOWN). Demo total duration 73 min (SIMULATED). Optional road-time status PARTIAL; reasons INVALID_PROVIDER_RESPONSE.

Selected category badges: fastest, mostReliable. Fastest/Most Reliable comparisons here are explicitly SIMULATED preview evidence; absent distinguishing evidence remains insufficient.

### Case J: exact endpoints and inspected legs
Origin: 15.04124663498475, 120.68364202268374 (PILOT_LANDMARK; csf-mcdonalds). Destination: 15.050605637995128, 120.69778203294244 (PILOT_LANDMARK; research-reference-RCH-ROB-STARMILLS-ARAYAT-GATE-LOAD).

- INBOUND CSF-ARAYAT-ROB-IN: Roadside boarding point [15.041243750711724, 120.68364431346083] → Robinsons Starmills – Arayat Gate Return Loading Area [15.050605637995128, 120.69778203294244]; signboard Arayat; fare ₱14; 86 road-geometry points. Temporary directional roadside boarding connector. Wait 0–15 min (SIMULATED).

Vehicle changes: 0. Total fare ₱14 (KNOWN). Demo total duration 15 min (SIMULATED). Optional road-time status UNAVAILABLE; reasons INVALID_PROVIDER_RESPONSE.

Selected category badges: recommended, cheapest, fewestTransfers. Fastest/Most Reliable comparisons here are explicitly SIMULATED preview evidence; absent distinguishing evidence remains insufficient.

### Case K: exact endpoints and inspected legs
Origin: 15.0394, 120.6832 (MAP_PIN). Destination: 15.117429648993976, 120.7024058913807 (PILOT_LANDMARK; research-reference-RCH-SAN-JUAN-TERMINAL).

- ACCESS: Exact San Fernando acceptance pin → Transport connector; 145 m; 3 min; routed Geoapify pedestrian geometry (5 points).
- INBOUND CSF-CITY-ROB-IN: Roadside boarding point [15.04024142160997, 120.6823994294285] → Robinsons Starmills – Arayat Gate Return Loading Area [15.050605637995128, 120.69778203294244]; signboard Robinsons; fare ₱14; 93 road-geometry points. Temporary directional roadside boarding connector. Wait 0–8 min (SIMULATED).
- INBOUND RCH-SJ-SMROB-IN: Robinsons Starmills – Arayat Gate Return Loading Area [15.050605637995128, 120.69778203294244] → Pampanga State University Mexico Campus – Front Waiting Area [15.128026422211173, 120.69826461388278]; signboard SAN JUAN; fare ₱28; 281 road-geometry points. Wait 0–8 min (SIMULATED).
- EGRESS: Transport connector → San Juan Jeepney Terminal; 1386 m; 21 min; routed Geoapify pedestrian geometry (35 points).

Vehicle changes: 1. Total fare ₱42 (KNOWN). Demo total duration 76 min (SIMULATED). Optional road-time status PARTIAL; reasons INVALID_PROVIDER_RESPONSE.

Selected category badges: recommended, cheapest, fastest, fewestTransfers, mostReliable. Fastest/Most Reliable comparisons here are explicitly SIMULATED preview evidence; absent distinguishing evidence remains insufficient.

## Exact test/build results

- Frontend portable regression run: **172 PASS, 0 FAIL**, plus three selected-journey/map contract checks. Includes seven connected-preview tests, authorization/stale-response guards, and the details watcher-loop regression.
- Backend focused regression run: **99 PASS, 0 FAIL**, including 23 connected research tests and all A–K synthetic fixtures, flag combinations, directional connectors, service overlap, transfers/cycles, feeder/public ride limits, discounts/partial fares, pins/boundaries, time failures, and disabled expansions.
- Backend legacy run: **15 Node test entries PASS, 0 FAIL** across journey engine, walking, fares, availability, unified planning, disruption routing, security, performance, and hackathon-demo suites. Several legacy entries contain multiple inline assertion checks.
- Activation TEMP-database test: **4 checks PASS** — dry-run rollback; idempotent application/scoped permission changes; atomic drift rejection/receipt rollback; unchanged public transport tables.
- Final authenticated HTTP: A–K trip-plan **200**, journey-details **200/READY**, optional time **200** with complete/partial/unavailable statuses preserved. Anonymous capabilities **403**. Invented journey IDs **UNAVAILABLE**. Existing operational PSU → SM/Robinsons **JOURNEYS_FOUND**, no research/simulated duration/availability leakage.
- Frontend production build **PASS**; backend production build **PASS**. No type/schema migration was added.
- Actual UI A–K **PASS desktop/mobile**; standard localhost workspace PSU → St. Nicolas smoke **PASS** after restoring normal backend port. Final production UI console contained no application errors. osm-bright emitted missing sprite warnings for some contextual POI icons; this is recorded, not hidden. Curated labels/route geometry remained usable.

[Backend focused regression log](<E:/Programming Files/Pamana with AI/pamana-backend/documentation/connected-backend-regressions.log>) · [Legacy regression log](<E:/Programming Files/Pamana with AI/pamana-backend/documentation/connected-legacy-regressions.log>) · [TEMP activation test log](<E:/Programming Files/Pamana with AI/pamana-backend/documentation/connected-activation-temp-test.log>)

[Frontend regression log](<E:/Programming Files/Pamana with AI/pamana-frontend/documentation/connected-frontend-regressions.log>) · [Backend build log](<E:/Programming Files/Pamana with AI/pamana-backend/documentation/connected-backend-build.log>) · [Frontend build log](<E:/Programming Files/Pamana with AI/pamana-frontend/documentation/connected-frontend-build.log>)

[Final authenticated HTTP evidence](<E:/Programming Files/Pamana with AI/pamana-backend/documentation/connected-http-results.json>) · [UI DOM evidence](<E:/Programming Files/Pamana with AI/pamana-frontend/documentation/connected-routing-ui/results.json>) · [UI console evidence](<E:/Programming Files/Pamana with AI/pamana-frontend/documentation/connected-routing-ui/console.json>)

## Rollout and remaining evidence gaps

Compatible backend APIs were available before frontend acceptance. Local demo/research/simulation, curated-landmark, pin, SF-pin and estimate flags are enabled for testing; operational expansion remains disabled. Example configuration defaults independent feature flags off. Passenger mode remains Operational until explicitly selected.

Normal backend on port 1337 was restored and health-checked (204); the original frontend localhost:3000 remains running (login 200). Temporary isolated production preview listeners on 1338 and IPv4 3000 were stopped; the disposable browser account was removed. No remote production deployment was performed.

Disable preview independently with PAMANA_RESEARCH_PREVIEW_ENABLED=false (or Demo Mode off); disable its generated comparisons with PAMANA_RESEARCH_SIMULATED_OBSERVATIONS_ENABLED=false. Landmarks, map pins, SF pins, time estimates, and operational expansion have separate flags. Runtime overlays require no DB rollback.

The operational activation dry-run returns VERIFICATION_REQUIRED. Its existing expected-value/idempotent receipt/rollback process remains gated; no operational activation was applied. New return variants remain preview-only and require a separately reviewed operational activation update when field evidence exists. No flag alone promotes them.

Remaining gaps: observation date/reviewer identity; formal City Proper termini; San Juan roadside pickup/alighting permissions; field-confirmed inbound boarding side; exact SM entrance/crossing rules; unknown Makabali coordinate; separate Mexico → San Juan return service; general San Juan → terminal tricycle coverage. Lubao/Bacolor/Guagua/Angeles notes are not routable new services.

Geoapify optional road responses for F and several return segments were invalid/disconnected for the constrained request, so estimates remain partial/unknown. J road estimate is unavailable. Driving time with approximated traffic is not live traffic, specific-departure traffic, or jeepney pickup ETA. Waiting, boarding, transfer delays and unscheduled stops remain excluded. The UI does not draw an arrival clock or use these proxies for operational Fastest.

Monitor sanitized planning/provider failures, pedestrian connectivity failures, latency and request usage using existing server request logs and optional metrics flags. Basemap missing sprites are a cosmetic provider-style limitation still visible in the evidence.

Provider/source references: [Geoapify approximated traffic](https://apidocs.geoapify.com/how-to/routing/traffic-route-times/), [PSA barangay layer via GeoRisk](https://portal.georisk.gov.ph/arcgis/rest/services/PSA/Barangay/MapServer/4).

Additional reviewable screenshots: [standard workspace map](<E:/Programming Files/Pamana with AI/pamana-frontend/documentation/connected-routing-ui/standard-workspace-psu-desktop.jpg>) · [standard workspace route details](<E:/Programming Files/Pamana with AI/pamana-frontend/documentation/connected-routing-ui/standard-workspace-psu-details.jpg>) · [Live Map landmark](<E:/Programming Files/Pamana with AI/pamana-frontend/documentation/connected-routing-ui/live-landmark-desktop.jpg>).
