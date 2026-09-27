# Phase 17 — Driver RouteVariant integration

Phase 17 connects authenticated Driver activity to one explicit directional RouteVariant. It does not change transport records, verification states, or planning eligibility.

## Selection and authorization

GET /api/driver-trip-options resolves the caller's Driver profile, assigned Vehicle, assigned Route, and eligible variants on the server. GET /api/driver-active-trip returns only the caller's active trip fields needed by the Driver UI. Both endpoints are Driver-only and avoid exposing unrelated vehicle or driver records. The option response contains human-readable route, direction, endpoint, and signboard values. A variant is offered only when:

- the Driver is active;
- the Vehicle is assigned to the Route and is available;
- the Route and RouteVariant pass the existing planning/trust gate;
- the RouteVariant is ACTIVE or LIMITED, within its effective dates, and has an explicit OUTBOUND or INBOUND direction;
- Driver, Vehicle, Route, and RouteVariant share the same REAL or SIMULATED data mode.

Phase 5B research variants remain planning-disabled and therefore do not appear. Current production behavior is an honest no-eligible-variants state until real route truth is human-verified and enabled.

## Trip lifecycle

POST /api/trips accepts only the selected RouteVariant document ID. The server derives and persists Driver, Vehicle, Route, direction, start time, status, data mode, and simulation flag. It rejects active-trip conflicts for either the Driver or Vehicle. Starting also sets the Vehicle's active_route_variant; completing or cancelling the caller's own active Trip clears it and records a server timestamp.

Inbound travel requires its own inbound RouteVariant. No stop list is reversed and no direction is inferred from a route name.

## GPS and occupancy

POST /api/vehicle-locations resolves the caller's own active Trip and ignores client ownership facts. Coordinates must be finite, in range, and not 0,0. Timestamps must be valid, no more than five minutes in the future, and no earlier than the Trip. The saved row inherits its Trip/Vehicle and exact RouteVariant attribution through the required Trip relation. Trip, Vehicle, and RouteVariant modes must match.

Driver occupancy updates require the caller's assigned Vehicle and active directional Trip. The server bounds the count by vehicle capacity and derives the stored level. Public normalized states remain AVAILABLE, NEAR_FULL, FULL, and UNKNOWN; GPS does not infer occupancy.

Phase 16's nonpersistent simulated endpoint is unchanged and is not called by this workflow.

## Schema and data

No schema migration or transport-data seed is required. The existing Trip already stores Route, RouteVariant, direction, lifecycle timestamps/status, data_mode, and is_simulated. VehicleLocation retains exact variant attribution through its required Trip. Bootstrap adds only the Driver-role permissions for the two tailored read endpoints; Public, Passenger, and LGU receive neither permission.

## Validation

npm run test:phase-17 covers directional attribution, assignment and status gates, REAL/SIMULATED isolation, GPS validation, timestamp validation, occupancy, end states, route authorization wiring, and absence of reverse-route/San Luis fallbacks.

npm run test:phase-17-db verifies all Phase 5B transport rows retain digest 77776e1a08d971a39b2718a10a116c7748e452900f26931dfbc90acd0377fdae and all production planning-enabled counts remain zero.
