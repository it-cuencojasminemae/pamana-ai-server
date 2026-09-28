# Phase 21 transport-data verification workbench

The PAMANA transport-data workbench gives authenticated **LGU** and **Administrator** accounts a controlled view of TransportNode, Route, RouteVariant, RouteVariantStop, FareRule, and ServicePattern records. Passenger, Driver, and public clients have no workbench action permissions, and the API repeats the role check at runtime.

## Verification workflow

Reviewers open an existing record or create a conservative research candidate. They record the transport fact, add a named source and a URL or field reference, add notes where useful, and save through the workbench API. A save validates the whole resulting record. Opening a form has no write side effect.

LGU reviewers may maintain facts and evidence. Only an Administrator may promote a record to `FIELD_VERIFIED` or `AUTHORITATIVE_CURRENT`, or switch `planning_enabled` from false to true. Verification does not happen automatically from research confidence, place search, coordinates, passenger reports, or AI output.

Verified statuses require `verified_at`, `source_name`, and either `source_reference` or `source_url`. Planning additionally requires `REAL` data and passes the existing Phase 2 planning-eligibility rules.

## Planning gate

The API rejects planning eligibility when evidence is incomplete. Transport nodes require a finite coordinate pair within the latitude/longitude ranges and reject `0,0`. Routes must be active and have a transport mode. Route variants require an eligible route, explicit endpoints, an operating state, and at least two uniquely ordered stops backed by trusted nodes. Fare and service records require a planning-enabled route scope.

This gate extends the existing planning rules; it does not bypass or weaken the deterministic journey engine's filters.

## Map-assisted coordinate verification

Geoapify autocomplete may locate a geographic POI for comparison on MapLibre. Choosing a POI only fills a coordinate candidate. The reviewer must inspect the map and check the explicit confirmation before the coordinate can be saved. A geographic result such as “SM City Pampanga” never verifies a specific boarding or drop-off point by itself.

## Ordered stops and directional variants

Each RouteVariantStop requires an existing variant, an existing TransportNode, a positive sequence, and explicit pickup/drop-off/transfer flags. Duplicate sequences are rejected. Changing an existing sequence requires a separate reorder confirmation. Inbound and outbound variants remain distinct; the workbench never generates a reverse service by reversing stops.

## Fares and service patterns

Fare validation preserves `FLAT`, `DISTANCE_BASED`, `ZONE`, and `MANUAL_LOOKUP`. A missing fare remains unknown rather than becoming zero. Distance fares require their base and per-kilometre fields, scopes must resolve, and effective date ranges must be ordered.

Service validation preserves `SCHEDULED`, `HEADWAY`, `LEAVE_WHEN_FULL`, and `CONTINUOUS_UNSCHEDULED`. Service days are required. Scheduled/headway records validate positive headway ranges; `LEAVE_WHEN_FULL` deliberately has no headway requirement.

## Geometry

Reviewers may paste LineString or MultiLineString GeoJSON and preview it on MapLibre. Coordinates must be finite, in range, and outside `0,0`. Saving geometry requires a trusted geometry source and explicit confirmation. Approximate Geoapify road paths cannot be saved as verified transit geometry through this workflow. Existing null pilot geometry stays clearly unknown.

## Pilot protection

Phase 21 introduces no schema migration and no seed operation. Its database regression runs in a read-only transaction and checks the activated Mexico–San Fernando digest, exact directional stop order, and null transit geometry. Pilot records only change after an authorized reviewer submits a valid edit.
