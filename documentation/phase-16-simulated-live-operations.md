# Phase 16 simulated live operations

Phase 16 adds a deterministic, nonpersistent live-vehicle simulator for development and hackathon demonstrations. It does not write `Vehicle`, `VehicleLocation`, `Trip`, `RouteVariant`, or `TransportNode` records. The normal live-vehicle endpoint and the Phase 14 trip-plan endpoint remain unchanged.

> Simulated operational activity exists only to demonstrate PAMANA's live system behavior. It does not convert unverified transport routes, stops, fares, schedules, or vehicle activity into real passenger guidance.

## Safety boundary

`PAMANA_DEMO_MODE_ENABLED` is a server-only gate and defaults to `false`. An authenticated client may read `GET /api/pamana-demo/live-vehicles` only when that gate is enabled; request bodies and query parameters cannot enable it. The endpoint has its own users-permissions action and is never granted to the Public role. Every scenario, response, and vehicle snapshot carries `SIMULATED` classification plus an explicit simulation flag or notice.

Production journey orchestration continues to call the Phase 13 operational loader with `allowSimulated: false`. The simulator does not enter that loader. Tests use its adapter only to prove that normal availability excludes the records and that an explicit internal `allowSimulated: true` path can interpret them.

## Scenarios and clock

Allowlisted fixtures live under `src/services/pamana-demo/scenarios`. `Synthetic Direct Corridor` uses an offshore GeoJSON `LineString`, three synthetic nodes, and three demo vehicles. It is unrelated to Pampanga and is labeled `SIMULATED DEMO / NOT REAL TRANSPORT DATA`. A second scenario deliberately reports a 90-second-old location to exercise the existing Phase 13 freshness threshold.

The snapshot service derives state from the scenario, elapsed seconds, and vehicle start offset. It has no background timer. Tests inject both current time and elapsed time. Position interpolation weights each LineString segment by geographic distance, clamps progress safely, and restarts at the beginning only when the scenario explicitly enables looping.

Occupancy comes from fixed time ranges and uses `AVAILABLE`, `NEAR_FULL`, `FULL`, or `UNKNOWN`. Trip state is derived as `NOT_STARTED`, `ACTIVE`, or `COMPLETED`. `observedAt` feeds the existing freshness evaluator, so stale demo locations remain diagnostic and do not count as fresh active evidence.

## Endpoint contract

The enabled endpoint returns scenario metadata, generated time, active/fresh/stale counts, and normalized vehicles containing `id`, `label`, `transportMode`, `routeVariantId`, `lat`, `lng`, `observedAt`, `occupancy`, `tripState`, `dataFreshness`, `dataMode: "SIMULATED"`, and `simulation: true`. Disabled, invalid-scenario, and malformed-scenario outcomes are controlled and contain no provider details or secrets.

Current production still has no planning-enabled route, variant, or node. Phase 16 does not change that limitation and does not fabricate a San Juan route, invoke geographic routing, or use AI/ML.
