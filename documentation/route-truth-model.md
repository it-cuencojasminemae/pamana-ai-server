# PAMANA Route Truth Model

Phase 2 establishes a strict boundary between route facts that passengers may
use for planning and operational records that may be simulated for a demo.

## Verification statuses

| Status | Meaning | Passenger planning |
|---|---|---|
| `AUTHORITATIVE_CURRENT` | Current fact from an authoritative source | Eligible when every other trust check passes |
| `FIELD_VERIFIED` | Confirmed through PAMANA field verification | Eligible when every other trust check passes |
| `CORROBORATED_RESEARCH` | Supported by multiple research sources but not field-verified | Not eligible |
| `HISTORICAL_UNVERIFIED` | Historical or legacy fact that has not been reverified | Not eligible |
| `SIMULATED_DEMO` | Invented route fact used only for a demonstration | Not eligible |
| `RESEARCH_CANDIDATE` | Candidate awaiting corroboration or field work | Not eligible |

`planning_enabled` is always an explicit decision. A record does not become
planning-enabled merely because its verification status changes.

## Data modes

- `REAL`: the record represents real-world route or operational data.
- `SIMULATED`: the record was generated or entered for demonstration/testing.

Cooperatives, drivers, vehicles, trips, GPS locations, passenger reports,
disruptions, demand observations, and predictions carry `data_mode`. Demo operational
activity can therefore coexist with verified route facts without being shown
as real-time verified activity.

## Passenger-planning gate

The shared rule lives in
`src/services/transport-data/planning-eligibility.js`. A Route is usable by
`/api/trip-search` only when:

1. `route_status` is `active`.
2. `planning_enabled` is `true`.
3. `verification_status` is `AUTHORITATIVE_CURRENT` or `FIELD_VERIFIED`.
4. `data_mode` is `REAL`.
5. `verified_at` is a valid timestamp.
6. `source_name` is present.
7. `source_url` or `source_reference` is present.
8. At least two Route Stops exist and every stop passes checks 2–7.

Fare and service values are not required by this gate. Unknown values remain
null and are handled separately by later phases.

## Existing data

The post-schema-sync bootstrap is additive and idempotent:

- existing Route and Route Stop rows are preserved;
- null planning flags become `false`;
- null verification statuses become `HISTORICAL_UNVERIFIED`;
- null route-fact data modes become `SIMULATED`;
- null operational data modes become `SIMULATED`.

New route facts default to `RESEARCH_CANDIDATE`, `REAL`, and planning disabled.
New operational entities default to `SIMULATED` until explicitly established
as real.
