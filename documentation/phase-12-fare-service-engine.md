# Phase 12: Deterministic fare and service information

Phase 12 enriches Phase 10 and Phase 11 journey copies with verified fare and service facts. It adds no public endpoint, prediction, passenger UI, or database records. Missing transport information remains unknown; PAMANA does not convert missing evidence into a numeric fare, timetable, or service guarantee.

## Actual schemas used

`FareRule` can apply to a `RouteVariant` or a `Route`. It stores `FLAT`, `DISTANCE_BASED`, `ZONE`, or `MANUAL_LOOKUP` fare type; currency; base, distance, per-kilometre and minimum values; a free-text rounding rule; three explicit passenger discount percentages; effective dates; and the shared planning/trust fields. It has no origin-node, destination-node, transport-mode, zone-table, or passenger-category child records.

`ServicePattern` belongs to one `RouteVariant`. It stores `days_of_week`, first and last trip times, dispatch type, and minimum/maximum headway. Its dispatch vocabulary is `SCHEDULED`, `HEADWAY`, `LEAVE_WHEN_FULL`, `CONTINUOUS_UNSCHEDULED`, and `UNKNOWN`. It has no scheduled-departure list or its own effective dates; the related `RouteVariant` supplies the effective window.

`RouteVariantStop.distance_from_variant_start_m` supplies cumulative verified distance. Phase 10 transit legs now expose a segment distance only when both boarding and alighting cumulative values exist and are ordered. No road or straight-line distance is substituted.

## Fare matching and precedence

Only planning-enabled, real, strongly verified, sourced records that are effective on the requested Philippine-local date are eligible. Ineligible records do not participate. Among eligible records, an exact variant rule outranks a route rule. Within the same scope, the latest `effective_from` wins, followed by stable record identity. Once a specific eligible rule is selected, an incomplete formula is reported as partial rather than silently replaced by a broader rule.

A `FLAT` rule is an explicit service-level fixed fare and can apply to a partial ride on that service. A `DISTANCE_BASED` rule uses the transit leg's cumulative-stop segment distance. Its base fare, base distance, and per-kilometre value must all exist. `ZONE` and `MANUAL_LOOKUP` records remain partial because the current schema contains no lookup table. Legacy `Route.base_fare` is never loaded by the revised engine.

## Known, partial, and unknown fares

`KNOWN` means the selected passenger's payable amount can be calculated from one eligible explicit rule. `PARTIAL` means a rule applies but a required amount, segment distance, formula value, rounding policy, or discount fact is missing. `UNKNOWN` means no eligible rule applies. Unknown values remain `null`; zero is accepted only when an eligible rule explicitly stores a zero amount.

Discounts are calculated only when both the regular fare and the corresponding stored student, senior, or PWD percentage are known. The engine contains no statutory or anecdotal percentage fallback. Regular, discounted, and payable amounts remain separate.

Journey totals include transit legs only. Walking and transfer legs are `NOT_APPLICABLE`, rather than free. `totalFare` exists only when every required transit leg has a known payable fare in one currency. `knownSubtotal` may describe the known part of a partial journey, but is never presented as the full total.

## Service-pattern interpretation

The engine preserves actual dispatch semantics. `HEADWAY` becomes `FREQUENCY_BASED` with the explicit stored range. `LEAVE_WHEN_FULL` remains a departure characteristic and never implies a frequency or predicted wait. `CONTINUOUS_UNSCHEDULED` remains unscheduled service. A `SCHEDULED` record is partial because the current schema has first/last times but no departure list.

The transit leg also carries the RouteVariant's separate `ACTIVE` or `LIMITED` operating status. Service output exposes `limitedService` without rewriting that fact into a dispatch frequency. A missing ServicePattern still has status `UNKNOWN`, even when the variant's limited operating state is known.

Service days and time windows are evaluated against an explicit departure timestamp in `Asia/Manila`. Missing or invalid day restrictions or times produce an `UNKNOWN` window result. Windows that cross midnight associate the after-midnight portion with the previous service day, so a Monday `22:00–02:00` pattern includes Tuesday at 01:00.

An explicit headway is factual service information. It is not converted into passenger wait, ETA, availability, or a guarantee. Those calculations remain outside Phase 12.

## Current production limitation

The production PostgreSQL state contains zero `FareRule` rows and zero `ServicePattern` rows. The Phase 5B San Juan testimony remains research-only: no anecdotal amount becomes a fare, `LEAVE_WHEN_FULL` is not promoted, and the reported scarcity around 16:30 does not become a last-trip time. Current revised-corridor enrichment therefore reports fare `UNKNOWN` and service `UNKNOWN`.
