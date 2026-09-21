# PAMANA Data Validation Report: San Luis ↔ City of San Fernando Corridor, Pampanga

## TL;DR
- Some PAMANA reference information is real and sourced: PSA population figures and a direct "San Luis – SM Pampanga" jeepney fare observation (₱21) documented by the Pampanga provincial government. The proposed March 2026 LTFRB fare hike cited in an earlier version of this report was suspended on March 18, 2026; it must not be used as a current fare matrix.
- The two localities are genuinely adjacent — great-circle ~11–13 km, road distance ~16 km, ~25–40 min by car in normal traffic — so the app's `Route.estimated_travel_time` should use this range, NOT the erroneous 110-mile / ~3-hour Rome2Rio figure (which mistakenly geolocates San Luis, Aurora).
- Fields that must remain SIMULATED/flagged: exact vehicle-supply counts on the corridor (no public LTFRB franchise count found; LTFRB Region III deflected a 2023 FOI request), individual cooperative fleet sizes, precise terminal GPS for the San Luis market terminal and TODAs, and minute-level travel time (no live traffic-aware routing retrievable).

## Key Findings

**1. Fares — NEEDS FIELD VERIFICATION.** The ₱14/₱2.00 traditional-jeepney and ₱17 modern-jeepney proposal announced on March 17, 2026 was suspended before its planned March 19 implementation. It is historical context, not a current fare input. The only corridor-specific reference currently retained is the ₱21 San Luis–SM Pampanga observation; it covers a shorter leg and cannot safely be extrapolated to City of San Fernando. Confirm the fare posted in the vehicle or at the terminal before storing a live value.

**2. Distance & Travel Time — HIGH (distance) / MEDIUM (time).** Road distance ~16 km; straight-line ~11–13 km; typical drive ~25–40 min (car), ~40–55 min (jeepney with stops). Corridor: San Luis poblacion → Santa Ana → Mexico (Santo Domingo Circle) → San Fernando / SM City Pampanga via Jose Abad Santos Avenue (N3).

**3. Population & Demographics — HIGH (verified PSA + PhilAtlas + Wikipedia).** San Luis: 2020 Census 58,551; 2024 POPCEN 64,674; land area 56.83 km²; 17 barangays; density 1,030/km² (2020), 1,138/km² (2024). San Fernando City: 2020 Census 354,666; 2024 POPCEN 377,534; land area 67.74 km²; 35 barangays; density 5,236/km² (2020), 5,573/km² (2024).

**4. Existing Routes & Cooperatives — HIGH (PNA/SunStar) for cooperatives; the concept-paper "transfer" claim is PARTLY REFUTED.** A direct "San Luis – SM Pampanga" jeepney (₱21) is listed on the official Pampanga provincial government website, so a direct single-vehicle option to the San Fernando urban edge exists. Four PUVMP cooperatives operate in Pampanga: Kapampangan TSC, Lubao TSC, Guagua/Betis/Bacolor TSC, and One Mexico Prime TSC — but none runs a San Luis–San Fernando modernized route.

**5. Vehicle Supply — LOW / COULD NOT VERIFY corridor-specific counts.** No public LTFRB franchise count for the San Luis–San Fernando route was found; LTFRB Region III denied/deflected an FOI request for Pampanga route data in December 2023.

**6. Route Stops / Geography — MEDIUM.** Named real endpoints: San Luis Public Market (poblacion, ~15.04 N, 120.7919 E); SM City Pampanga jeepney terminal and City Transport Terminal Phase 2 in Barangay San Juan, San Fernando; San Fernando Public Market / Mexico–Jeepney Terminal downtown.

## Details

### 1. FARES (`Route.base_fare`)

**Proposed LTFRB fare matrix, announced March 17, 2026 and suspended March 18, 2026** (historical context only; not a live app input):

| Vehicle | First 4 km (min. fare) | Each succeeding km | Prior fare |
|---|---|---|---|
| Traditional PUJ (TPUJ) | ₱14.00 | ₱2.00 | ₱13 / ₱1.80 |
| Modern PUJ (MPUJ, air-con) | ₱17.00 | ₱2.30 or ₱2.40 (disputed) | ₱15 / ₱2.20 |

- Sources: Philippine News Agency, "LTFRB announces PUV fare hikes for land transport," Mar 17, 2026 (pna.gov.ph/articles/1271201); Rappler (rappler.com/newsbreak/iq/fare-increase-jeepneys-buses-ride-hailing-philippines-march-19-2026/); SunStar (sunstar.com.ph/manila/ltfrb-approves-fare-increase-on-all-pujs); Manila Bulletin (mb.com.ph/2026/03/17/ltfrb-approves-balanced-fare-hikes-for-jeepneys-other-puvs); Manila Times; Philstar; Inquirer.

- **Modern-jeepney per-km discrepancy (important for the data model):** The two figures are genuinely split across reputable outlets. **PNA and Manila Bulletin cite ₱2.30** — PNA verbatim: "modern jeepneys will have a PHP2 increase in the minimum fare (from PHP15 to PHP17) plus PHP2.30 for every succeeding kilometer." **Rappler, The Manila Times, SunStar, and Inquirer cite ₱2.40** ("the rate per succeeding kilometer also went up to P2.40 from P2.20"). Because the majority of major outlets report ₱2.40, treat the modern per-km rate as **₱2.40 (with ₱2.30 as an alternative)** and flag it in-app as unresolved pending the LTFRB's published permanent matrix. The traditional-jeepney figures (₱14 / ₱2.00) are unanimous.

- **Provisional status:** Per Inquirer, LTFRB Chair Vigor Mendoza II said, "As of now…all of these are provisional. They can implement it right away. Our condition to make the fare hike permanent is for them to secure their fare matrix on or before June 2026." Per Rappler, "Should the conflict in the Middle East end and fuel prices substantially go down, Mendoza said the LTFRB could implement a provisional fare reduction." Cost basis, per The Manila Times: Mendoza "considered fuel prices ranging from about P75 to P88 per liter, a roughly 14-percent increase in spare parts and maintenance costs, and an average 19-percent rise in the minimum wage between 2022 and 2025." **Flag for app: values are current-but-provisional as of the March 2026 order.**

- **Discounts:** 20% for students, senior citizens, and PWDs. Legally mandated **every day** including weekends, holidays, and vacations (NOT school-days-only) under RA 11314 (Student Fare Discount Act of 2019), RA 9994 (Expanded Senior Citizens Act), and RA 7277 (Magna Carta for Disabled Persons); implemented via LTFRB MC 2017-024 and MC 2025-010. Valid school ID/proof of enrollment required for students. Sources: Inquirer, Daily Tribune, BusinessMirror, PNA, LTFRB FOI response (foi.gov.ph/agencies/ltfrb/how-fare-matrix-is-made/): "Students are entitled to a fare discount of not less than 20% of the approved adjusted fare EVERYDAY, including Saturdays, Sundays and Holidays as per MC 2017-024." HIGH confidence.

- **Regional (Region III) specificity:** No Region III-specific fare matrix or surcharge above the national baseline was found. Historically LTFRB applies the same NCR/Region III/Region IV minimum fare (the ₱9–₱10 changes of 2018–2019 were applied identically to Regions 3 and 4 per PNA). Treat the national matrix as authoritative for Pampanga. MEDIUM-HIGH confidence (based on absence of contrary evidence plus historical parity).

- **Corridor fare estimate:** The old ~₱38 end-to-end computation came from the suspended proposal and is not a valid live estimate. Retain it only as a demo/reference value if clearly labelled. The observed ₱21 "San Luis – SM Pampanga" fare covers a shorter leg, so it also must not be extrapolated to City of San Fernando. A terminal or in-vehicle fare-matrix check is required before setting `Route.base_fare` as a real value.

### 2. DISTANCE & TRAVEL TIME (`Route.estimated_travel_time`)

- Straight-line/great-circle: ~11–13 km (Travelmath "12 km to San Fernando"; PhilAtlas lists San Fernando as San Luis's nearest city).
- Road driving distance: **~16 km** (DistanceCalculator.net: 15.93 km driving; straight-line 11 km). HIGH confidence.
- Typical driving time: **~25–40 min** by car in normal traffic; **~40–55 min** by jeepney with stops; possibly 45–60+ min in San Fernando/SM Pampanga rush hour. MEDIUM confidence (derived from confirmed ~16 km over mixed municipal roads + JASA through two town centers; no single live traffic-aware engine was retrievable via available tools).
- Corridor: San Luis poblacion → Santa Ana → Mexico (Santo Domingo Circle) → San Fernando / SM City Pampanga, primarily via Jose Abad Santos Avenue (JASA / Gapan–San Fernando–Olongapo Road, N3). An alternative local link is the Bahay Pare–San Luis–Santo Domingo (Mexico) road.
- **DO NOT USE** the Rome2Rio "San Luis → Pampanga" figure of 110.3 miles / 2h50m — it geolocates San Luis, Aurora (routing via Baler–Cabanatuan–Tarlac–Dau). Confirmed error.
- MacArthur Highway (Angeles–San Fernando) and JASA are both congestion-prone at rush hour (7–9 AM, 5–7 PM); build a traffic multiplier into the app's ETA model. Recommended default: ~35 min (car) / ~45 min (jeepney), with a 1.3–1.6× rush-hour multiplier.

### 3. POPULATION & DEMOGRAPHICS (demand-estimation context)

**Municipality of San Luis, Pampanga (4th district, PSGC 0305417000, ZIP 2014, coordinates 15°02′24″N 120°47′31″E / 15.04°N 120.7919°E, founded 1761, Mayor Jayson S. Sagum):**
- 2020 Census: **58,551** (PhilAtlas, PSA). 2024 POPCEN: **64,674** (PSA, via Wikipedia/Wikidata; official as of July 1, 2024, declared official July 11, 2025 by Proclamation 973).
- Land area **56.83 km²**; density **1,030/km²** (2020) and **1,138/km²** (2024); **17 barangays**; **12,836 households** (2024); 3rd-class municipality; poverty incidence 11.86% (2021).
- Barangays: San Agustín, San Carlos, San Isidro, San José, San Juan, San Nicolás, San Roque, San Sebastián, Santa Catalina, Santa Cruz Pambilog, Santa Cruz Poblacion, Santa Lucia, Santa Mónica, Santa Rita, Santo Niño, Santo Rosario, Santo Tomás.
- Largest barangays (2020): San Jose (7,384), San Isidro (7,312), San Juan (6,322), San Roque (5,254), San Carlos (4,458). Poblacion is Santa Cruz Poblacion (1,761).

**City of San Fernando, Pampanga (provincial capital, regional center of Central Luzon, 3rd district, PSGC 0305416000, ZIP 2000, coordinates ~15.03°N 120.68°E, cityhood 2001):**
- 2020 Census: **354,666** (PhilAtlas/PSA). 2024 POPCEN: **377,534** (Wikipedia/PSA).
- Land area **67.74 km²**; density **5,236/km²** (2020, most densely populated LGU in Pampanga) and **5,573/km²** (2024); **35 barangays**; **86,217 households** (2024); 1st-class city; poverty incidence 7.23% (2021). Daytime population historically cited ~1.1 million due to the regional government center in Barangay Maimpis (Inquirer).

**Corridor-relevant San Luis barangays:** The town center (Santa Cruz Poblacion) and the western/southwestern barangays toward Santa Ana/Mexico are the likely origin cluster. Santa Monica and San Nicolas connect via the Santa Monica–San Nicolas and Bahay Pare–San Luis–Santo Domingo (Mexico) roads toward San Fernando. Precise corridor-barangay assignment is inferential — flag as LOW confidence.

### 4. EXISTING ROUTES & COOPERATIVES (`Cooperative` records)

**Direct route verification:** The official Provincial Government of Pampanga page for the Municipality of San Luis lists transport as "Land: Jeepney (₱21 per pax) San Luis – SM Pampanga" plus tricycle special (₱50). This documents a DIRECT single-vehicle jeepney from San Luis town to the SM City Pampanga terminal at the Mexico/San Fernando boundary. From SM City Pampanga, San Fernando downtown/public market is a short additional jeepney or tricycle hop. This partly REFUTES the concept paper's unsourced claim that commuters must combine jeepneys and tricycles — a direct jeepney to the San Fernando urban edge exists, though reaching the exact city-proper/market may still require one short transfer. MEDIUM-HIGH confidence (single official source for the direct jeepney; corroborated conceptually by Pampanga's hub-and-spoke jeepney geography centered on San Fernando, per Wikivoyage: "San Fernando is the central hub of jeepneys from all across Pampanga").

**PUVMP cooperatives in Pampanga** (verified via PNA and SunStar):
- **Kapampangan Transport Service Cooperative** — routes include Angeles City–San Fernando via MacArthur Highway and City of San Fernando–San Isidro.
- **Lubao Transport Service Cooperative** — Lubao–City of San Fernando via Bacolor; Lubao–Guagua.
- **Guagua/Betis/Bacolor Transport Service Cooperative** — City of San Fernando–Sasmuan via Guagua; Guagua–SM City Pampanga/Robinsons Starmills via OG Road; Guagua–SM City Pampanga/Robinsons Starmills via Bacolor.
- **One Mexico Prime Transport Service Cooperative** — participated in the first launch; Mexico-area route(s).
- **Launch dates:** First batch of **12** modern air-conditioned PUJs launched **March 16, 2022** (four cooperatives, at Pampanga Capitol grounds). Second batch of **21** modern PUJs launched **November 26, 2022** at the City Transport Terminal Phase 2, Barangay San Juan, San Fernando (three cooperatives). LTFRB Region III officials named: Ahmed G. Cuizon (March 2022 launch), Nasrudin U. Talipasan (regional director, Nov 2022).
- **Modern jeepney routes confirmed 2022–2026:** Angeles City–San Fernando via MacArthur Highway; City of San Fernando–San Isidro; Lubao–City of San Fernando via Bacolor; Lubao–Guagua; City of San Fernando–Sasmuan via Guagua; Guagua–SM City Pampanga/Robinsons Starmills (via OG Road and via Bacolor). Sakay.ph lists "San Fernando, Pampanga-San Isidro" (route ID DOTR:R_SAKAY_MPUJ_2180) as a modern PUJ route.
- **Fleet sizes:** Only province-wide launch batches are public (12 units March 2022; 21 units November 2022, across the four cooperatives). Per-cooperative fleet counts and current 2026 totals were NOT found — **SIMULATE / flag LOW confidence.**
- **Critical for PAMANA:** None of the confirmed modernized cooperative routes is a San Luis–San Fernando route. The San Luis–SM Pampanga service appears to be a traditional jeepney, not a modernized cooperative route. Model the corridor as **traditional jeepneys + tricycle first/last-mile.**

### 5. VEHICLE SUPPLY DATA

- No public LTFRB franchise count specific to the San Luis–San Fernando corridor was found. LTFRB Region III (Government Center, Brgy. Maimpis, San Fernando City; r3@ltfrb.gov.ph; (045) 455-0550 / 0998-866-1860) DENIED/deflected a December 2023 FOI request (tracking #LTFRB-956342780780) for Pampanga jeepney route details (route structure, number of authorized units, mode, route length). **This field must remain SIMULATED.** To obtain real data, PAMANA should file a direct FOI request or contact LTFRB R3.
- The only known unit counts are the modernized launch batches (12 units March 2022; 21 units November 2022) — launch batches, not corridor supply, and outdated for 2026. LOW confidence for any corridor-level supply figure.
- Context: the PUVMP consolidation deadline lapsed Dec 31, 2023; Omnibus Franchising Guidelines (DOTr DO 2017-011) require cooperatives/corporations with ≥15 vehicles to hold franchises.

### 6. ROUTE STOPS / GEOGRAPHY (`Route Stop` coordinates)

- **San Luis Public Market / poblacion terminal** — Barangay Santa Cruz Poblacion area; municipal center ~15.04 N, 120.7919 E (Wikipedia infobox 15°02′24″N 120°47′31″E). A "San Luis Public Market in San Luis, Pampanga" photo is catalogued on Wikimedia Commons. Exact market-terminal GPS not independently verified — flag MEDIUM/estimated.
- **SM City Pampanga jeepney terminal** — San Fernando (near Mexico boundary); documented endpoint of the San Luis jeepney (also "SM City Pampanga Jeepney Terminal 2," per Waze).
- **City Transport Terminal Phase 2** — Barangay San Juan, City of San Fernando; PUVMP launch site (Nov 2022). Real, named LGU terminal.
- **San Fernando Public Market / Mexico–Jeepney Terminal** — downtown near San Fernando Cathedral and City Hall (~280–320 m from cathedral/city hall); Barangay Santo Rosario / downtown heritage district.
- **Intermediate points:** Santa Ana town center; Mexico (Santo Domingo Circle) along JASA.
- **Tricycle first/last-mile:** San Luis TODAs (e.g., in Santo Tomas, San Luis) are documented; tricycle "special" ~₱50 San Luis–SM Pampanga per the LGU site. Coordinates for individual TODA terminals not verified — SIMULATE.

## Recommendations

1. **Do not treat the stored `Route.base_fare` as real.** Verify the corridor fare from a posted matrix or field survey, then update it with the verification date and source. Until then, show it as a demo estimate.
2. **Set `Route.estimated_travel_time`** to a range of 25–55 min (default ~35 min car / ~45 min jeepney) for ~16 km, with a rush-hour multiplier (1.3–1.6×). Remove any multi-hour placeholder derived from Rome2Rio.
3. **Use PSA 2024 POPCEN** (San Luis 64,674; San Fernando 377,534) as the primary demand-context figures, with 2020 Census as secondary. Store land area and density (2024: 1,138/km² and 5,573/km²) for density-based demand modeling.
4. **Model the corridor as traditional-jeepney + tricycle**, with a direct "San Luis – SM Pampanga" jeepney leg (observed ₱21) plus a short San Fernando-proper transfer; do NOT represent it as a modernized cooperative route.
5. **Flag as SIMULATED** (visible disclaimers in the data model): corridor vehicle supply/franchise counts, individual cooperative fleet sizes, exact terminal GPS for the San Luis market and TODAs, and minute-level ETAs.
6. **To upgrade LOW-confidence fields to real data:** (a) file an LTFRB Region III FOI request for San Luis/San Fernando route franchises and unit counts; (b) capture GPS at the San Luis market terminal and SM City Pampanga terminal via a short field survey; (c) run a live Google Maps Directions query (San Luis Public Market → San Fernando Public Market) at target times to pin the ETA; (d) reconcile the ₱21 observed fare against the current matrix.
7. **Thresholds to revise:** update `base_fare` only after a current corridor fare is verified; refresh census fields when PSA releases the full 2024 POPCEN barangay tables.

## Caveats
- The March 2026 fare proposal was suspended before implementation. Do not present either of its per-kilometre values as the current fare.
- The direct "San Luis – SM Pampanga" jeepney and the ₱21 fare rest on a single official source (Pampanga provincial government); the ₱21 fare may predate the March 2026 hike. Reconcile before publishing as current.
- Travel time is a reasoned derivation, not a live traffic-aware routing result; distance (~16 km) rests substantially on DistanceCalculator.net corroborated by great-circle sources.
- 2024 POPCEN figures for San Luis/San Fernando are sourced via Wikipedia/Wikidata citing the official PSA July 2025 release (Proclamation 973); verify against the PSA primary municipality/city table before final publication.
- Corridor-barangay assignments within San Luis are inferential (LOW confidence).
- No modernized PUVMP route currently serves San Luis–San Fernando directly; the cooperative data pertains to other Pampanga routes and should not be attached to this corridor's franchise/supply fields.
- Avoid travel-aggregator/SEO sites (Rome2Rio, Travelmath, commutetour, Yelp) for authoritative values; they are used here only for triangulation or explicitly flagged as erroneous.
