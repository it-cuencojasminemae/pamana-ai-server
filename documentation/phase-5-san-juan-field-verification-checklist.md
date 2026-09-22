# Phase 5 — San Juan Field-Verification Checklist

This checklist is intentionally blank on operational facts. Phase 4 research identifies a candidate service but does not establish passenger-ready route truth.

## Gold-route candidate

- Internal research code: `RCH-SJ-CSF-SM-ROB`
- Candidate: San Juan, Mexico ↔ City of San Fernando via SM City / Robinsons Starmills
- Current status: `CORROBORATED_RESEARCH`
- Data mode: `REAL`
- Passenger planning: disabled

## Boarding and destination evidence

- [ ] Exact San Juan boarding point
- [ ] Boarding latitude and longitude captured at the actual passenger point
- [ ] Passenger-facing signboard text photographed/transcribed
- [ ] Vehicle type observed
- [ ] SM City and/or Robinsons actual alighting point
- [ ] Reverse-direction boarding point
- [ ] Operator confirms whether SM and Robinsons are one service pattern or distinct variants

## Route and stop truth

- [ ] Exact outbound path observed
- [ ] Exact inbound path observed
- [ ] Intermediate landmarks/stops recorded in travel order
- [ ] Pickup/drop-off/transfer rules observed per stop
- [ ] Any route deviation or direction asymmetry documented
- [ ] No point inferred solely from a business address, mall centroid, or barangay centroid

## Fare and operations

- [ ] Current regular fare observed and operator-confirmed
- [ ] Student discount behavior observed/confirmed
- [ ] Senior/PWD discount behavior observed/confirmed
- [ ] First/last operating window observed or operator-confirmed
- [ ] Dispatch behavior observed: scheduled, headway, leave-when-full, or unscheduled
- [ ] Observed wait samples recorded with date/time
- [ ] Observed travel-time samples recorded with date/time and direction
- [ ] No generic PUJ rate or computed distance substituted for route-specific evidence

## Organization and trust

- [ ] Current operator/TODA/cooperative identity confirmed
- [ ] Relationship to San Juan Mexico Jeepney Operators & Drivers Association confirmed or rejected
- [ ] Relationship to San Matias-SM-San Jose association confirmed or rejected
- [ ] Source person/role and consent recorded
- [ ] Evidence files assigned stable references
- [ ] Verification date and verifier identity recorded

## Accessibility and safety

- [ ] Covered waiting area assessed (`true`, `false`, or `null` if not assessed)
- [ ] Wheelchair accessibility assessed (`true`, `false`, or `null` if not assessed)
- [ ] Lighting observations recorded
- [ ] Roadside/loading safety observations recorded
- [ ] Weather/flood exposure observations recorded
- [ ] Emergency or alternative pickup behavior documented

## Promotion gate

- [ ] Field evidence supports exact transport nodes
- [ ] Directional RouteVariants can be represented without assumptions
- [ ] RouteVariantStop sequence is supported by observation
- [ ] FareRule is current and traceable
- [ ] ServicePattern contains only observed/confirmed values
- [ ] Reviewer explicitly approves `FIELD_VERIFIED`
- [ ] Reviewer explicitly approves `planning_enabled = true`
- [ ] Trip-search regression tests pass after any promotion
