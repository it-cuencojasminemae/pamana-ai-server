# Phase 18B: disruption-aware routing

Phase 18B consumes the structured disruption truth introduced in Phase 18A. It adds no schema, seed, migration, transport record update, passenger report automation, AI, or prediction behavior.

## Eligibility and loading

The trip-plan orchestrator loads disruptions once per request, in parallel with the eligible transport nodes and route variants. The query uses the shared PAMANA planning-candidate policy and accepts only planning-enabled, sufficiently verified, sourced, `REAL` records. The service then reapplies the shared eligibility policy in memory before use.

A disruption is eligible only when it is active at the requested `departureAt`, has started, has not reached its exclusive `ends_at`, has not been resolved, uses a recognized effect, and has every explicit target required by that effect. Open-ended disruptions remain effective until resolved or made inactive. Research, historical, migrated conservative defaults, and simulated records cannot affect normal passenger planning. Simulated eligibility exists only as an explicit server-side loader option and is never exposed to the passenger request.

If disruption loading fails, the orchestration call fails closed. The existing trip-plan controller converts the failure to its sanitized service-unavailable response; the planner does not silently assume that routes are safe.

## Deterministic effects

Disruptions affect PAMANA journey planning only through explicit structured transport relations and verified deterministic effects. Names, descriptions, and geographic proximity are not used to infer transport impact.

- `ROUTE_SUSPENDED` removes all loaded variants whose Route ID matches the explicit relation.
- `VARIANT_SUSPENDED` removes only the exact related RouteVariant.
- `NODE_CLOSED` disables boarding, alighting, and transfer at the exact related node. It does not prevent a passenger already aboard from passing through the node.
- `BOARDING_CLOSED` disables only pickup at the related node.
- `ALIGHTING_CLOSED` disables only drop-off at the related node.
- `TRANSFER_BLOCKED` disables only transfer permission at the related node. A direct ride may pass through it.
- `LIMITED_SERVICE` retains the journey and adds a structured limited-service warning. It does not create a wait time, headway, ETA, or availability count.
- `WARNING_ONLY` retains the journey and adds a structured advisory.

Blocking effects have precedence over advisory effects. Any applicable blocking constraint prevents the invalid route edge or transfer from entering journey search. Advisory warnings on remaining journeys are aggregated by disruption ID and effect, so duplicate populated records do not create duplicate messages.

## Planner integration

The disruption engine creates runtime-only copies of affected variants and stop permissions, then passes the constrained data into the existing Phase 10 graph builder. Base Route, RouteVariant, TransportNode, and RouteVariantStop records are never changed.

Applying constraints before graph construction means Phase 11 access-node discovery sees no outgoing edge from a boarding-closed node and no alight edge into an alighting-closed node. Transfer permission is also removed before the one-transfer search. Geoapify continues to calculate walking geometry only; it does not decide whether a transport operation is open.

Phase 14 retains its existing domain statuses. When active blocking constraints remove every otherwise eligible variant or journey, it returns `NO_TRANSPORT_JOURNEY` with `NO_JOURNEY_DUE_TO_ACTIVE_DISRUPTION`. Remaining journeys keep Phase 12 fare/service facts and Phase 13 availability facts, with normalized disruption warnings added separately.

## Passenger and map contract

Warnings expose only a normalized public shape: code, type, effect, disruption ID, passenger message, severity, time window, and optional verified geometry. Raw Strapi records and evidence fields are not returned.

The passenger journey card uses the existing PAMANA card system to show concise advisories. The no-journey view explains when an active verified disruption is involved. Verified geometry is rendered through a dedicated MapLibre GeoJSON source with point, line, and polygon treatments. Null or unverified geometry produces no map feature. Overlay refresh calls `setData` only and never fits, zooms, or recenters the map.

## Current production limitation

The current PostgreSQL state contains no planning-enabled passenger routes, route variants, transport nodes, or disruptions. Phase 18B therefore continues to return no eligible journey in production. Synthetic coverage stays in test and development-preview fixtures and is never persisted.
