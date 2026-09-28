# Phase 19 — Passenger reports and crowdsourcing

Passenger reports are operational evidence. They do not automatically become verified PAMANA transport truth.

## Structured observations

New submissions use `VEHICLE_FULL`, `LONG_WAIT`, `NO_SERVICE_OBSERVED`, `STOP_ISSUE`, `ROUTE_INFORMATION_ISSUE`, `ACCESSIBILITY_ISSUE`, `DISRUPTION`, or `OTHER`. Legacy lowercase categories remain readable so existing reports are preserved. A description of 10–500 characters is required.

Reports follow `PENDING`, `REVIEWED`, `VERIFIED`, or `DISMISSED`. `VERIFIED` applies only to the observation. Review never enables planning, updates occupancy or accessibility, creates a disruption, or changes a route, node, fare, or service pattern.

## Context and location

A report may reference an exact Route, RouteVariant, TransportNode, Vehicle, or Trip document identifier. The server loads those records, requires REAL eligible route knowledge where applicable, and checks relations such as variant-to-route, node-to-variant, and trip-to-vehicle. Names and report text never resolve relations.

GPS is optional and requested only after the passenger presses **Use location**. Coordinates must be a complete finite pair within geographic bounds; `0,0` is rejected. The passenger UI does not echo stored exact coordinates. LGU and Administrator reviewers may access location evidence, but reporter account identity is removed from report API responses.

## Review access

Passengers can submit reports and list only their own history. LGU and Administrator roles can list the evidence queue and update only review status and notes. Passengers cannot set ownership, timestamps, data mode, or review fields. A passenger `DISRUPTION` report remains evidence and never creates a Phase 18 disruption. A `VEHICLE_FULL` report never overwrites Driver occupancy or Phase 13 operational state.
