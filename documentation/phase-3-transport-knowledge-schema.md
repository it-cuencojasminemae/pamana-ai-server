# Phase 3 Transport Knowledge Schema

Phase 3 adds a directional network model without replacing the existing Route,
Route Stop, Trip, Vehicle, or Driver records.

## Model

`Route -> RouteVariant -> RouteVariantStop -> TransportNode`

Fare rules may apply to a Route or RouteVariant. Service patterns apply to a
RouteVariant. Existing `origin`, `destination`, `base_fare`, and
`estimated_travel_time` fields remain compatibility fields only. The future
journey engine must use the directional model instead.

No Mexico, San Juan, fare, geometry, schedule, signboard, node, variant, or
stop-sequence records are created in this phase. Existing San Luis data remains
historical/demo data and is not copied into the new model.

## Migration flow

1. Start Strapi once to synchronize additive schemas.
2. Run `npm run backfill:phase-3`.
3. Run `npm run test:phase-3-db`.

The backfill runs in a short PostgreSQL transaction, updates only null safety
fields on new tables, initializes a null legacy `Route.active` value from its
existing `route_status`, compares legacy row counts before commit, and is safe
to rerun. `active` does not imply `planning_enabled`; historical routes remain
planning-disabled. The script never inserts compatibility RouteVariants and
contains no record or table deletion logic.

## Accessibility

Accessibility booleans now use three states:

- `true`: verified accessible or available;
- `false`: verified not accessible or unavailable;
- `null`: unknown or not assessed.

Existing `false` values are preserved. Some may have originated from the old
forced-false default, but they cannot be distinguished reliably from genuine
assessments, so this migration does not reinterpret them.

Coordinates on TransportNode are nullable. Unknown coordinates must remain
null and must never be represented as `0,0`.

## Permissions

The application bootstrap grants read-only access for the new knowledge types
to Passenger, Driver, and LGU roles. The application Administrator role gets
create, read, update, and delete actions. No Public permissions are added.

Permission setup is automatic for existing roles with the exact names
`Passenger`, `Driver`, `LGU`, and `Administrator`. If a deployment renamed or
removed those roles, an administrator must recreate/map them in Strapi Admin
and restart the backend so the bootstrap can apply the intended permissions.
