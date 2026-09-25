# Phase 10: Deterministic multimodal journey engine

Phase 10 adds an internal backend planner for verified PAMANA public-transport data. It does not add a public HTTP endpoint and does not change the passenger frontend.

## Graph representation

Eligible `TransportNode` records are vertices. A ride edge connects two ordered `RouteVariantStop` records on the same `RouteVariant` when the boarding stop permits pickup, the alighting stop permits drop-off, and the alighting sequence is greater than the boarding sequence. Each edge retains the route, variant, direction, signboard, boarding and alighting sequences, and the intermediate nodes within that segment.

The graph stores outgoing ride edges by boarding-node ID. It accepts document IDs, database IDs, and node codes as candidate aliases, while journey results use one canonical node identity. Loading the same variant or candidate journey more than once does not duplicate the result.

## Eligibility

The loader filters candidates before graph construction and the graph builder reapplies `planning-eligibility.js` as a defense-in-depth check. Normal planning requires:

- `planning_enabled = true`
- `REAL` data
- `AUTHORITATIVE_CURRENT` or `FIELD_VERIFIED`
- a valid verification date and source evidence
- an active route whose `active` flag is true
- an `ACTIVE` or `LIMITED` variant within its effective dates
- a supported transport mode
- at least two uniquely ordered stops whose nodes pass the same trust rule

`UNKNOWN`, `SUSPENDED`, and `INACTIVE` variants are excluded. Research and historical records are excluded even if a storage adapter accidentally returns them. Simulation is accepted only when the caller deliberately enables demo mode; this also allows the explicit `SIMULATED_DEMO` verification state.

## Direction and route segments

Edges are created only from a lower stop sequence to a higher sequence. The engine never reverses an outbound stop list to manufacture inbound travel. A return trip requires its own eligible inbound `RouteVariant` with its own stop permissions.

A passenger may board and alight at any permitted stops within a longer variant. For example, a stored `X → A → B → C → Y` service can produce the segment `A → C`, with `B` reported as an intermediate node.

## Direct and one-transfer journeys

A direct journey uses one forward edge. A one-transfer journey uses two edges from different variants. The current schema represents compatibility as one exact shared `TransportNode` whose alighting and boarding variant stops both set `transfer_allowed = true`. Names and geographic proximity never create a transfer.

Phase 10 deliberately caps search at one transfer. The graph and leg contracts can support a deeper search later without changing the stored edge model.

Each transit leg includes transport mode, route and variant identity, direction, signboard, boarding and alighting nodes and sequences, intermediate nodes, verification status, and data mode. Journey IDs are deterministic. Results use structural ordering: fewer transfers first, then fewer legs, then stable variant and node codes. They do not claim to be fastest, cheapest, or most reliable.

## Deferred composition

Walking access and egress are deferred to Phase 11 because they require a separate geographic routing step. The core planner accepts candidate boarding and destination node IDs and never converts straight-line distance into walking instructions.

Fare, wait time, ETA, duration, route geometry, and AI explanations are absent from Phase 10 results. Legacy base fare, historical wait fallbacks, ML predictions, and LLM providers are not inputs to the deterministic graph.

## Synthetic fixtures and current production result

The automated fixture network covers direct, inbound, one-transfer, through-route, invalid-direction, research, historical, simulated, and non-operating cases. These fixtures live only under `scripts/fixtures` and are never seeded into PostgreSQL.

The conceptual future journey below remains research-only:

`PSU Mexico → local transport → Mexico Bayan → transfer → San Fernando-bound transport → destination-area transport node`

It is not currently returned because its underlying nodes and variants are not planning-eligible. The Phase 5B production database has zero passenger-eligible transport nodes, zero planning-enabled variants, and zero variant stops, so zero production journeys is the correct Phase 10 result.
