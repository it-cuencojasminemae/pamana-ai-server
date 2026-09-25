# Phase 13: deterministic wait and vehicle availability

Phase 13 adds an internal availability service to the revised Phase 10+ journey pipeline. It does not add a public endpoint or change passenger results. Each transit leg now carries independent fare, service, and availability information, and the journey receives a conservative availability summary.

## Why PAMANA no longer predicts wait with the legacy model

The legacy trip-search path estimates wait from historical intervals and falls back to 15 minutes when evidence is absent. That behavior is retained only for compatibility with the old endpoint. The revised journey services do not import the legacy wait-time, demand, or supply-demand modules and do not expose a numeric confidence score.

PAMANA reports an arrival or wait window only when the available evidence supports it. Service frequency and vehicle presence are not presented as exact arrival predictions.

## Evidence hierarchy

The engine uses these facts, from most immediate to least specific:

1. A fresh REAL location for a non-offline vehicle explicitly related to the same `RouteVariant` through `Vehicle.active_route_variant` or an active `Trip.route_variant`.
2. An eligible Phase 12 `ServicePattern` evaluated for the requested Philippine-local departure time.
3. The route variant's explicit `LIMITED` operating state.
4. `UNKNOWN` when none of those facts supports a stronger result.

Production mode excludes simulated vehicles, trips, and locations. An explicit demo mode may include them. Names, signboards, substring matching, approximate coordinates, and geographic proximity never attribute a vehicle to a transit leg.

## Availability contract

Transit leg status is one of `LIVE_ACTIVE`, `SERVICE_EXPECTED`, `LIMITED`, `OUTSIDE_SERVICE`, or `UNKNOWN`. Wait status is one of `ESTIMATED_WINDOW`, `SERVICE_INTERVAL_ONLY`, `UNKNOWN`, or `NOT_APPLICABLE`. Unsupported numeric values remain `null`; zero is never used to mean unknown.

The engine also returns active and boardable vehicle counts, freshness, factual source labels, and machine-readable warnings. Walk and transfer legs receive a `NOT_APPLICABLE` wait and do not inherit a transit leg's status.

## Service interval and passenger wait

For an eligible, active headway pattern, `headwayMinutes` remains the verified service interval. With an unsynchronised passenger arrival, Phase 13 exposes a possible deterministic range from zero through the maximum verified headway and labels it `SERVICE_INTERVAL_ONLY` with basis `VERIFIED_HEADWAY`. It is not an ETA or a guaranteed arrival countdown.

`LEAVE_WHEN_FULL` and `CONTINUOUS_UNSCHEDULED` may establish that service is expected during a verified window, but numeric wait remains unknown. `SCHEDULED` also remains unknown because the current schema has no stop-level scheduled departures; first-trip time cannot be reused as a downstream stop departure.

`ESTIMATED_WINDOW` is part of the provider-neutral contract but is not emitted from current production data. It requires adequate deterministic evidence such as an explicit stop-level departure or verified route progress plus trustworthy timing data.

## Fresh and stale vehicle data

The passenger map polls every 15 seconds. The centralized default freshness threshold is 60 seconds, allowing four missed polls before a position becomes stale. Timestamps more than 30 seconds in the future are rejected as unknown clock data.

A stale position remains diagnostic but does not count as a live vehicle and cannot produce an arrival estimate. A route assignment without a fresh position can establish assignment only; it cannot establish proximity or approach.

## Occupancy

Fresh explicit `empty`, `low`, and `moderate` occupancy states map to `AVAILABLE`; `near_full` maps to `NEAR_FULL`; and explicit full occupancy or full vehicle status maps to `FULL`. Full vehicles remain active but do not count as boardable.

Missing occupancy maps to `UNKNOWN` and does not count as boardable. The schema's default `current_occupancy = 0` is not treated as evidence because it has no observation timestamp. Stale location evidence also makes occupancy unknown.

## Live vehicle without ETA

A fresh exact-variant vehicle produces `LIVE_ACTIVE`, even when arrival timing is unknown. Phase 13 does not estimate arrival from straight-line distance and does not call Geoapify driving routing. Verified PAMANA route progress and stop-level timing are not currently available, so live presence and ETA remain separate facts.

## Journey summary

Each transit leg is evaluated separately. A journey is `AVAILABLE` only when every required transit leg is live or expected from verified service evidence. An outside-service leg makes the journey `UNAVAILABLE`; a mixture containing limited or unknown evidence is `PARTIAL`; all-unknown transit evidence produces `UNKNOWN`.

## Current production limitation

The revised corridor currently has zero planning-enabled variants, zero planning-enabled transport nodes, zero fare rules, and zero service patterns. Phase 13 creates no records and does not make the San Juan research corridor eligible. The current production result remains no eligible journey and no passenger wait estimate.
