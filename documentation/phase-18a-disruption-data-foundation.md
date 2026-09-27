# Phase 18A: disruption data foundation

Phase 18A adds the data contract required for deterministic disruption handling. It does not load disruptions into the Phase 14 trip-plan orchestrator, alter the graph, remove journey candidates, or create alternate routes.

## Schema change

Before Phase 18A, `Disruption` stored a type, title, description, optional point coordinates, severity, start/end dates, status, source, and `REAL`/`SIMULATED` data mode. It could not identify an affected transport record or express a deterministic planning effect.

The schema now adds optional, unidirectional many-to-one relations to `Route`, `RouteVariant`, and `TransportNode`. It also adds the nullable `effect` enumeration:

- `WARNING_ONLY`
- `LIMITED_SERVICE`
- `ROUTE_SUSPENDED`
- `VARIANT_SUSPENDED`
- `NODE_CLOSED`
- `BOARDING_CLOSED`
- `ALIGHTING_CLOSED`
- `TRANSFER_BLOCKED`

Relations are optional at the database model level so legacy records remain valid. New API records are validated against the effect. Route suspension requires a route, variant suspension requires a variant, node/boarding/alighting closure requires a node, transfer blocking means all transfers at one exact node and requires that node, and limited service requires a route or variant. When route and variant are both supplied, the variant must belong to that route. Warning-only records may intentionally remain general.

Free-text route names, node names, signboards, descriptions, latitude/longitude, and proximity never satisfy these target rules. Only relation document IDs resolve a target.

## Trust and planning eligibility

`verification_status` reuses the shared PAMANA values and defaults to `RESEARCH_CANDIDATE`. `planning_enabled` defaults to `false`. `verified_at`, `source_name`, `source_url`, `source_reference`, and `notes` use the existing transport truth conventions. `data_mode` retains its conservative `SIMULATED` default.

A planning-enabled disruption must pass the shared trust gate: `AUTHORITATIVE_CURRENT` or `FIELD_VERIFIED`, `REAL` mode, a valid verification time, a source name, and a source URL or reference. It must also have a valid effect and explicit target where the effect requires one. `SIMULATED`, research, historical, and unverified entries cannot be enabled for normal production planning. Only Administrator callers may set `planning_enabled`, `verification_status`, or `verified_at`; LGU callers can record structured observations for later review.

Phase 18A only stores eligibility. No disruption changes passenger journeys until Phase 18B explicitly integrates this foundation.

## Time, resolution, and geometry

Existing `starts_at`, `ends_at`, and `disruption_status` fields remain the structured validity window. `ends_at` must follow `starts_at`. Resolved records require `resolved_at` and `resolution_notes`.

Optional `geometry_geojson` accepts only valid `Point`, `LineString`, `Polygon`, `MultiLineString`, or `MultiPolygon` geometry. `geometry_source` reuses the route-geometry vocabulary and defaults to `UNKNOWN`. Geometry is not fabricated and is not required when an explicit route, variant, or node relation already identifies the target. A trusted source cannot be asserted without geometry, simulated geometry requires `SIMULATED` mode, and planning-enabled geometry must have a verified source.

Legacy latitude and longitude fields remain for display compatibility. They never infer a transport relation.

## Migration and preservation

Strapi's declarative schema synchronization creates the additive scalar columns and relation link tables. The existing PostgreSQL bootstrap then performs an idempotent conservative backfill: null `planning_enabled` becomes `false`, null `verification_status` becomes `RESEARCH_CANDIDATE`, null `geometry_source` becomes `UNKNOWN`, and the existing operational rule retains `SIMULATED` for null disruption data modes. It installs database defaults and non-null constraints only for these conservative fields.

No effect, relation, geometry, verification evidence, resolution detail, or planning eligibility is inferred for an old record. Existing descriptions, status, source, coordinates, and time fields remain unchanged. The Phase 18A checkpoint contained zero disruption rows before and after synchronization. The Phase 5B transport digest remains `77776e1a08d971a39b2718a10a116c7748e452900f26931dfbc90acd0377fdae`, with zero planning-enabled routes, variants, and nodes.

## Access and LGU workflow

LGU and Administrator retain create/update access and receive the new authenticated target-options endpoint. Existing disruption reads remain available to roles that already had them. Passenger, Driver, and Public receive no disruption write access. The target endpoint returns bounded presentation fields for exact route, variant, and node records; it does not perform search by name or proximity.

The LGU disruption page keeps the current PAMANA cards and map. It adds a structured record form, route-filtered variant selection, exact node selection, time and evidence fields, Administrator-only verification/planning controls, optional GeoJSON entry, and resolution notes. The page explicitly labels planning integration as pending Phase 18B.
