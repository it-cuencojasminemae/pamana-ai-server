# Driver vehicle availability revision — 8 October 2026

Drivers can optionally report Seats Available (AVAILABLE), Almost Full (LIMITED), Full (FULL), or Not Reported (UNKNOWN) on their assigned active trip. Exact counting is removed from Current Trip and its dashboard summary. GPS, route selection, stops, start/end behavior and existing synthetic demo profiles remain separate.

## Impact assessment

Previously the Driver page PUT exact counts to the vehicle; occupancy_level and vehicle_status were read by the live map, legacy trip-search reliability and revised journey availability. GPS freshness could make old occupancy appear current. Supply/demand uses fleet capacity, not current occupancy, so it needs no change. Existing Passenger VEHICLE_FULL observations have optional vehicle/trip context, review status, timestamps, duplicate protection and privacy guards. Legacy seats_available exists in the schema but is not an accepted current form category. These observations are evidence only and cannot overwrite Driver availability. No aggregation or prediction model was introduced.

## Persistence and API

- Additive Trip fields: availability_status (AVAILABLE/LIMITED/FULL/UNKNOWN, default UNKNOWN), availability_source (DRIVER/PASSENGER/SYSTEM_ESTIMATE/SIMULATION), availability_reported_at (datetime).
- New internal collection vehicle_availability_reports: status, source, reported_at, data_mode, trip, vehicle and driver relations. It has no Content API routes or role grants. Application writes append accepted updates; duplicates do not append or renew the timestamp.
- PUT /api/driver-trips/:id/availability, body { "data": { "status": "AVAILABLE" } }. Driver permission only. The server determines identity, active trip, vehicle, mode, source and timestamp. Extra fields, invalid statuses, missing authentication, other accounts' trips, inactive drivers/trips and mismatched assignments/modes are rejected.
- A short Strapi transaction locks trip, driver and vehicle, verifies current assignment, appends the audit, and updates the snapshot together. Trip ending locks the same trip and updates trip/vehicle atomically. See [Strapi transaction documentation](https://docs.strapi.io/cms/database-transactions) for implicit Document Service transaction participation.
- GET /api/driver-active-trip adds availability. GET /api/live-vehicles adds the same availability contract (status, reportedStatus, source, confidence, reportedAt, expiresAt, ageSeconds, stale, dataMode). Legacy occupancy_level on this feed maps effective approximate availability to low/near_full/full or null; it is never converted into a passenger count.
- Capacity, current_occupancy, occupancy_level and historical records remain stored. The older restricted vehicle count endpoint remains for compatibility; new approximate reports never call it or modify those fields.

## Freshness and consumers

MANUAL_AVAILABILITY_MAX_AGE_SECONDS is the sole backend setting, default 900. This 15-minute window is an initial operational assumption, not a field-validated threshold. Reports expire at the exact boundary. Backend reads return UNKNOWN for missing, invalid, future, stale, ended or unsupported evidence. No expired rows are rewritten or deleted. GPS never refreshes availability.

Frontend badges consume server expiresAt, use a shared 15-second clock, and continue expiring cached reports when polling fails. Driver controls show the current selected state, pending/success/failure feedback and a safely-stopped reminder. Large 48px targets use a two-column mobile layout. End Trip requires confirmation.

Passenger and LGU cards and map feature details use the same labeled badge and report age. Revised journey resolution keeps the AVAILABLE/NEAR_FULL/FULL/UNKNOWN contract (LIMITED maps to NEAR_FULL), and accepts real reported availability only while both trip availability and GPS are fresh. Raw historical counts do not prove boardability. Legacy trip-search uses the new evidence without changing its response shape. No AI model, journey graph, planning eligibility, pilot research data, fare or supply/demand logic was changed.

The normal live-vehicle feed excludes SIMULATED and mixed-mode records. Existing gated demonstration endpoints and overlays remain unchanged. Reports for already-supported simulated Driver trips stay on those trips, carry SIMULATION provenance, and never enter real journey/live feeds. No demo flags were enabled.

Passenger reports preserve their existing creation, context validation, duplication, privacy and review workflow. One unverified vehicle-full report does not change availability. There is no accepted passenger seats-available workflow today; deriving status from conflicting, unbound or insufficient observations remains UNKNOWN. Passenger/system sources are reserved in the schema but are not accepted operational status evidence in this revision.

## Files changed for this revision

Backend:
- src/services/vehicle-availability/policy.js (new)
- src/services/vehicle-availability/report.js (new)
- src/api/vehicle-availability-report/content-types/vehicle-availability-report/schema.json (new)
- src/api/trip/content-types/trip/schema.json
- src/api/trip/controllers/trip.js
- src/api/trip/routes/01-driver-trip.js
- src/api/live-vehicle/controllers/live-vehicle.js
- src/api/trip-search/controllers/trip-search.js
- src/services/security/access-control.js
- src/services/pamana-journey/availability-data-loader.js
- src/services/pamana-journey/live-vehicle-resolver.js
- .env.example
- scripts/fixtures/phase13-synthetic-availability.js
- scripts/test-vehicle-availability.js (new)
- documentation/vehicle-availability-revision.md (new)

Frontend:
- app/types/vehicleAvailability.ts (new)
- app/services/vehicleAvailability.ts (new)
- app/composables/useAvailabilityClock.ts (new)
- app/components/PamanaVehicleAvailability.vue (new)
- app/components/driver/PamanaAvailabilityControls.vue (new)
- app/types/driverTrip.ts
- app/types/map.ts
- app/services/mapPresentation.ts
- app/components/PamanaMapLibreMap.vue
- app/pages/driver/current-trip.vue
- app/pages/driver/index.vue
- app/pages/passenger/map.vue
- app/pages/lgu/live-mobility.vue
- scripts/test-phase-17.mjs
- scripts/test-phase-25a.mjs (preserving earlier Demand Map cleanup)
- scripts/test-vehicle-availability.mjs (new)
- scripts/availability-browser-fixture.mjs (new, explicitly opt-in, memory only, localhost)
- documentation/vehicle-availability/ (browser QA artifacts)

Pre-existing unrelated working-tree edits were preserved. No commit or push was performed.

## Validation

- New backend suite: 10 tests PASS, 0 FAIL. Covers four saved states/reload, duplicate serialization, transactional rollback, roles/ownership/inactive and mismatched trips, configurable expiry, fresh GPS with stale availability, simulation isolation, Passenger evidence isolation, Passenger/LGU feeds and GPS/end behavior. These use injected in-memory adapters; actual PostgreSQL locks/schema sync are not claimed as exercised.
- New frontend suite: 7 tests PASS, 0 FAIL. Covers labels/colors/provenance, expiry, one-tap/overlap/duplicate handling, failure feedback without losing the saved state, accessible rendered controls, consumer compilation, map metadata and shared-clock disposal.
- Existing frontend regressions: 37 tests PASS across phase-16, phase-17, phase-19, phase-25a and phase-26 suites.
- Existing backend regressions: 22 Node test entries PASS across phase-13, phase-16, phase-17, phase-19, phase-22, phase-23, phase-26, legacy trip-search planning gate, phase-14, phase-20 and batch-b recommendations. Older entries contain multiple assertions.
- Nuxt production build and Strapi admin production build PASS. Existing large-bundle/dependency warnings are nonfatal.
- Source syntax and changed-file whitespace checks PASS.

Browser QA uses the final built frontend at a temporary localhost port and the explicit in-memory fixture API; it does not use real accounts or PostgreSQL. All four statuses saved, selected controls immediately reflected the accepted response, reload retained Full and Not Reported, canceling End Trip retained the active trip, and confirming End Trip returned to the dashboard with no active trip. At a 390 x 844 mobile viewport the four controls measured 48px high and document scrollWidth equaled clientWidth (380px excluding scrollbar); the 1440 x 900 desktop viewport also had no horizontal overflow. The desktop map canvas now fills its 560px panel rather than leaving an extra stretched blank area.

Browser screenshots are saved in ../../pamana-frontend/documentation/vehicle-availability/desktop.jpg and mobile.jpg. Geoapify is intentionally unconfigured in this fixture, so real map tiles/GPS are not claimed as browser-tested. No browser location permission was granted. Temporary QA processes/tabs were stopped after verification.

## Rollout and remaining checks

No database connection, reseed, backfill, schema sync, user-account modification or operational mutation was run during this revision. On reviewed rollout, restart Strapi to apply its additive content-type sync (three nullable/defaulted Trip fields and the audit collection/relation tables). Existing bootstrap role reconciliation adds the Driver-only api::trip.trip.availability permission; other roles remain ungranted. Existing trips without a timestamp correctly read UNKNOWN; do not backfill a fresh report from counts or GPS.

Set the optional freshness environment variable before restart if changing the initial window. Deploy the backend before the frontend. Verify on a staged database that schema additions preserve rows, authenticated HTTP updates persist after a server restart, unauthorized/cross-driver requests fail, concurrent end/report transactions behave correctly, and the audit row rolls back on a write failure. These are real-database acceptance checks still required.

Use an assigned test Driver and real configured map in a safe stopped setting to verify trip start, exact directional stops, HTTPS GPS publication/recovery, availability reporting, end/cancel behavior and Passenger/LGU propagation. Verify map tiles and physical handset layout with representative long route names and stop lists. Validate the 15-minute window operationally. A future passenger corroboration policy needs trustworthy specific-vehicle context, independent evidence and conflict/duplicate rules; none is silently inferred here.
