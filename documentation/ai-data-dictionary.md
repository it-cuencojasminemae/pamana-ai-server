# PAMANA AI Data Dictionary (Phase 13 — AI Data Foundation)

> Companion to `documentation/PAMANA_CLAUDE_CODE_CONTEXT.md` and
> `documentation/data-validation-report.md`. Field names below were confirmed
> against the actual `content-types/*/schema.json` files in `src/api/` as of
> this writing — not assumed from the guide, per that document's own working
> rule. Scope: the six content types the AI workstream reads from
> (`passenger-demand-observation`, `passenger-report`, `route`, `route-stop`,
> `trip`, `vehicle-location`). Fields on `vehicle` are mentioned only where an
> already-implemented AI service (`trip-search`) reads them.

## 1. Fields consumed by the AI workstream

### `passenger-demand-observation` (Phase 15 input)

| Field | Type | Meaning | Source label(s) that apply |
|---|---|---|---|
| `date` | date | Calendar date of the observation | all three |
| `time_slot` | string | Fixed hourly bucket, e.g. `"06:00-07:00"` (hyphen, matching `services/pamana-ai/time-slots.js` — not the en dash shown as an example in the concept doc) | all three |
| `waiting_passengers` | integer, min 0 | Passenger count observed/estimated waiting at this route+stop+slot | all three |
| `source` | enum: `observed` \| `crowdsourced` \| `simulation` | Provenance label — **already present and correctly constrained** | n/a (this *is* the label) |
| `route` | relation → Route | Which corridor | — |
| `stop` | relation → Route Stop | Which stop | — |

### `passenger-report` (Phase 12 crowdsourcing input, Phase 16 supply/demand signal)

| Field | Type | Meaning | Source label(s) that apply |
|---|---|---|---|
| `report_type` | enum: `vehicle_arrived`, `vehicle_full`, `seats_available`, `route_unavailable`, `flood`, `vehicle_breakdown` | What the passenger reported. Two values (`flood`, `vehicle_breakdown`) beyond the four in the concept doc — schema has grown since the guide was written. | implicitly `crowdsourced` only (see §2 — no explicit field) |
| `latitude` / `longitude` | float | Where reported from | — |
| `location_note` | string | Free-text location hint | — |
| `reported_at` | datetime, required | When reported | — |
| `passenger` / `route` / `stop` / `vehicle` | relations | Who/what the report is about | — |

### `route` (fare/time inputs to Phase 17 scoring)

| Field | Type | Meaning | Source label(s) that apply |
|---|---|---|---|
| `route_name`, `route_code`, `origin`, `destination` | string | Identity/display | n/a |
| `base_fare` | decimal, optional, min 0 | **Single flat fare** for the whole route (not a fare-matrix formula) — see §3 | n/a — deterministic reference value, provenance now tracked below instead of in-schema |
| `estimated_travel_time` | integer (minutes), optional | Static stored travel time — see §4 for whether trip-search treats this as static | n/a |
| `route_status` | enum: `active`, `inactive` | **Not named `status`** — matches the guide's own naming-drift warning | n/a |
| `route_stops`, `vehicles`, `trips`, `passenger_reports`, `passenger_demand_observations`, `predictions` | relations | — | — |

### `route-stop` (Phase 20 accessibility + demand/report location)

| Field | Type | Meaning | Source label(s) that apply |
|---|---|---|---|
| `name`, `sequence` | string / integer | Identity/ordering | n/a |
| `latitude`, `longitude` | float, required | Stop location — see §3 provenance for corridor stops, exact GPS is simulated/estimated per the report | n/a |
| `stop_type` | enum: `pickup`, `dropoff`, `both`, `terminal` | — | n/a |
| `covered_waiting_area`, `accessible_toilet_nearby` | boolean | Phase 20 accessibility attributes. Note: `wheelchair_accessible`/`low_floor` live on **`vehicle`**, not here. | n/a |

### `trip` (Phase 14 wait-time input)

| Field | Type | Meaning | Source label(s) that apply |
|---|---|---|---|
| `started_at`, `ended_at` | datetime | Used directly by `services/pamana-ai/wait-time.js` to compute historical headway intervals | implicitly `observed` only (see §2 — no explicit field, and this is a real gap) |
| `direction` | enum: `outbound`, `inbound` | — | — |
| `trip_status` | enum: `scheduled`, `active`, `completed`, `cancelled` | Only `completed` trips feed the wait-time average; `active` trips feed the `has_active_vehicle` signal | — |
| `vehicle`, `driver`, `route` | relations | — | — |

### `vehicle-location` (Phase 11 live map, potential future Phase 14/18 input)

| Field | Type | Meaning | Source label(s) that apply |
|---|---|---|---|
| `latitude`, `longitude`, `speed`, `heading` | float/decimal | GPS ping | implicitly `observed` only (see §2 — no explicit field, and this is a real gap) |
| `recorded_at` | datetime, required | — | — |
| `vehicle`, `trip` | relations | — | — |

## 2. Source-label gap — `trip` fixed, two still open

`passenger-demand-observation` is the only one of the six content types with an explicit `source` enum. Two others still store data the AI workstream treats as if it always has a single implicit provenance, with no field to say otherwise:

- **`passenger-report`** — every row is implicitly `crowdsourced` today because only a real passenger tap creates one. But roadmap Phase 21 explicitly calls for *"simulated crowdsourcing events"* — once that's built, simulated and real reports will be stored in the same table with no way to tell them apart. **Still open.**
- **`vehicle-location`** — same issue: simulated vehicles moving along a route would need simulated `VehicleLocation` rows, indistinguishable from real driver-phone GPS pings. **Still open.**

**`trip` — fixed.** This was the sharpest instance: `services/pamana-ai/wait-time.js` (Phase 14) computed its headway prediction directly from `Trip.started_at` intervals with no filter. A boolean `is_simulated` field (default `false`) was added to `trip` (`src/api/trip/content-types/trip/schema.json`, DB column applied via `scripts/migrate-add-trip-is-simulated.js`), and `predictWaitTime()` now filters `is_simulated: false` on both its completed-trip history query and its active-vehicle check — a simulated Trip can no longer feed a number presented to a passenger as a real prediction, and a simulated "active" trip can no longer register as a real available vehicle.

A boolean was used instead of matching `passenger-demand-observation`'s three-value enum — `trip` only ever has two real provenances (a real driver action, or a Phase 21 fabrication), so `observed`/`crowdsourced` doesn't apply. No existing `trip` rows needed backfilling — the table was empty at the time of this change.

Recommendation for your review: the same boolean, applied to `passenger-report` and `vehicle-location`, before Phase 21 starts writing to either.

## 3. Real-World Data Provenance (Part C)

Kept in documentation, not schema — no `confidence`/`source` column was added to `Route` per instructions. Source for every row below: `documentation/data-validation-report.md`.

| Field / value | Value | Source & date | Confidence tier |
|---|---|---|---|
| `Route.base_fare` (SL-SF-01, currently stored) | **₱38 demo estimate** | Derived from a proposed March 2026 fare hike that was suspended before implementation | **Not a verified current fare** — field-check the posted matrix before using it as live data |
| Modern (air-con) jeepney per-km rate | ₱2.40 (used) vs **₱2.30 (unresolved alternate — see below)** | PNA & Manila Bulletin report ₱2.30; Rappler, Manila Times, SunStar, Inquirer report ₱2.40 | Single-source-per-figure — genuinely disputed across outlets, not resolved by this task |
| `Route.estimated_travel_time` (SL-SF-01, applied) | **45 min** (jeepney-with-stops default; range 40–55 min; 1.3–1.6× rush-hour multiplier not applied to the stored single value) | DistanceCalculator.net (~16 km road distance) + reasoned derivation, no live traffic-aware routing available | Distance: verified. Time: medium (reasoned, not live-measured) |
| "San Luis – SM Pampanga" jeepney fare | **₱21** (observed, real) — **not stored on any Route field**, documented here only | Official Provincial Government of Pampanga website | Single-source, but an official government source |
| San Luis population | 2020 Census 58,551 / 2024 POPCEN 64,674; 17 barangays | PSA / PhilAtlas / Wikipedia (Proclamation 973) | Verified — context for demand estimation only, intentionally **not stored on Route** |
| San Fernando population | 2020 Census 354,666 / 2024 POPCEN 377,534; 35 barangays | PSA / PhilAtlas / Wikipedia | Verified — same, not stored |
| Student/Senior/PWD discount | 20%, **every day** (not school-days-only) | RA 11314, RA 9994, RA 7277; LTFRB MC 2017-024 / MC 2025-010 | Verified — **not currently represented in any schema field**; flagged only, not implemented (would need a discount-calculation feature, out of Phase 13 scope) |
| Corridor vehicle/franchise counts | — | LTFRB Region III deflected a 2023 FOI request | **Not found — must stay simulated** wherever a supply number is needed |
| Cooperative fleet sizes on this corridor | — | Only province-wide launch batches (12 units Mar 2022, 21 units Nov 2022) are public, and none of those cooperatives runs this corridor | **Must stay simulated** |
| Exact terminal/TODA GPS | — | Not independently verified | **Must stay simulated/estimated** |
| Minute-level live ETA | — | No live traffic-aware routing retrievable | **Must stay simulated** — only the 40–55 min range above is real |

### (a) ₱2.30 vs ₱2.40 discrepancy — what was applied

The ₱2.30/₱2.40 figures were part of the proposed March 2026 increase, which was suspended before implementation. Do not use either figure in fare logic without a current, posted fare matrix.

### (b) ₱21 vs ~₱38 fare mismatch — what was applied

**Not resolved — neither value is a full-corridor live fare.** `Route.base_fare` on SL-SF-01 currently stores a **₱38 demo estimate** derived from a proposed fare hike that was suspended before implementation. The **₱21** "San Luis – SM Pampanga" figure is a real observation for a *shorter* leg, not City of San Fernando proper. Confirm a posted fare matrix or conduct a field survey before replacing the demo estimate.

`SL-SF-02` ("...via Santo Tomas Transfer", the second existing route record) was deliberately **left untouched**. The report has no data specific to that synthetic transfer routing, and its existing lower fare (₱35) / higher time (60 min) relative to SL-SF-01 reads as an intentional "cheaper-but-slower, more-transfers" demo alternative (matching the concept paper's Option A/B framing) rather than a data error — changing it wasn't requested and risked corrupting a working `trip-search` comparison. Flagging this choice for your review rather than silently deciding it was in-scope.

### (c) Report figures that didn't cleanly map to an existing field

- **Population/demographics** — explicitly instructed not to store on `Route`; no other content type currently holds town-level demand-context figures. No action taken; would need a new content type or config if this project wants these numbers queryable later (not proposed here — out of scope).
- **Student/Senior/PWD 20% discount** — no fare-discount field exists anywhere in the schema (`route`, `passenger-profile`, etc.). Documented above only.
- **Road distance (~16 km) and rush-hour multiplier (1.3–1.6×)** — no distance or multiplier field exists on `Route`; only the derived `estimated_travel_time` single value is stored. The multiplier is not applied anywhere in code (no rush-hour-aware ETA logic exists yet — that would be prediction logic, out of scope for Phase 13).

## 4. Part A, step 6 — Trip Search: static or dynamic? (report only, no fix made)

Checked `src/api/trip-search/controllers/trip-search.js` directly. It returns **both**, as two separate fields, and they behave differently:

- `estimated_travel_minutes` (line ~170: `const estimatedTravelMinutes = route.estimated_travel_time ?? null;`) is the **static stored value** straight from the `Route` record. Confirmed static — not computed dynamically.
- `predicted_wait_minutes` is a **separate field**, populated by calling `predictWaitTime()` from `services/pamana-ai/wait-time.js` (already-implemented Phase 14 logic) — this part genuinely is a dynamic, computed prediction, not a placeholder.
- `total_journey_minutes` (used for the "fastest" ranking) adds the static travel time + the dynamic predicted wait (high end) + a transfer-time penalty.

So the ambiguity noted in `PAMANA_CLAUDE_CODE_CONTEXT.md` §6 is resolved by direct inspection: `estimated_travel_time` itself is static and does not contradict the "AI only explains, never predicts ahead of Phase 14" rule — but note that Phase 14's wait-time prediction is *already wired into* this endpoint's response and ranking, which is only consistent with the rule because Phase 14 already exists in this codebase (see the separate finding that Phases 13–17 are already implemented, contrary to the "deferred" framing in both context docs).

## 5. New utility: `services/pamana-ai/time-slot.js`

Normalizes a `Date`, a millisecond timestamp, an ISO string, or a bare 0–23 hour into the same `"HH:00-HH:00"` format already used by `passenger-demand-observation.time_slot` and by the existing `services/pamana-ai/time-slots.js` (plural — Phase 13.2, used live by the Phase 15 demand service). Deliberately kept as a **separate, additional** file rather than merged into `time-slots.js`, since that file backs live prediction code that's out of scope to touch here. Test cases (18, all passing) covering midnight, slot boundaries, hour wraparound, and invalid input live at `scripts/test-time-slot.js` (run via `npm run test:time-slot`).
