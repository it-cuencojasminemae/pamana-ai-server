# Phase 14: unified deterministic trip-plan API

Phase 14 exposes the Phase 10–13 journey services through one authenticated endpoint. The endpoint is deterministic and does not load or call an LLM, demand predictor, supply-demand predictor, historical wait predictor, or route-scoring model.

## Endpoint and authentication

`POST /api/pamana-ai/trip-plan` requires a valid Strapi user session or bearer token. The Passenger role receives the `api::pamana-ai.trip-plan.create` permission during the existing idempotent bootstrap permission synchronization. LGU and Administrator roles may also call it. The route is not public.

The legacy `GET /api/trip-search` and existing PAMANA AI compatibility endpoints remain unchanged.

## Request body

```json
{
  "origin": {
    "lat": 15.0,
    "lng": 120.0,
    "label": "Current Location",
    "source": "USER_GPS"
  },
  "destination": {
    "lat": 15.05,
    "lng": 120.65,
    "label": "Resolved destination",
    "source": "GEOAPIFY"
  },
  "departureAt": "2026-09-25T17:00:00+08:00",
  "passengerCategory": "REGULAR"
}
```

`origin.lat`, `origin.lng`, `destination.lat`, and `destination.lng` are required finite JSON numbers within geographic bounds. Numeric strings, missing values, infinity, malformed timestamps, and accidental `0,0` endpoints are rejected. Optional location sources are `USER_GPS` and `GEOAPIFY`. Passenger categories are `REGULAR`, `STUDENT`, `SENIOR`, and `PWD`.

`departureAt` must be an RFC 3339 timestamp with an explicit timezone. When omitted, the server records and returns its current timestamp; Phase 12 continues evaluating the corresponding date and time in `Asia/Manila`.

Client-supplied route variants, boarding nodes, alighting nodes, fares, waits, service patterns, and vehicles are rejected. These are server-owned transport facts. The request is also bounded to 8 KiB after JSON parsing, in addition to Strapi's request-body middleware limits.

## Orchestration

For each validated request, the service:

1. Loads eligible coordinate-bearing transport nodes and eligible REAL route variants once.
2. Builds one Phase 10 deterministic transport graph.
3. Uses Phase 11 geographic prefiltering and Geoapify pedestrian routing to discover boarding and alighting candidates.
4. Plans direct and one-transfer transport journeys using direction, stop order, and explicit transfer permissions.
5. Composes access and egress walking legs.
6. Caps the deterministically ordered candidate set at five journeys.
7. Loads shared fare, service, and operational evidence once for that bounded set.
8. Applies Phase 12 fare/service and Phase 13 availability evaluation independently to every transit leg.
9. Normalizes the provider-neutral response.

Normal passengers cannot enable demo mode. The orchestration explicitly requests `demoMode: false` and excludes simulated operational evidence.

## Response and domain statuses

Successful domain processing uses HTTP 200. `INVALID_REQUEST` uses HTTP 400. Authentication failure uses HTTP 401. A walking-provider outage uses `ROUTING_PROVIDER_UNAVAILABLE` with HTTP 503. Unexpected service failures are sanitized as `SERVICE_UNAVAILABLE` with HTTP 503.

Normal domain statuses are:

- `JOURNEYS_FOUND`
- `NO_ELIGIBLE_ACCESS_NODES`
- `NO_TRANSPORT_JOURNEY`
- `ROUTING_PROVIDER_UNAVAILABLE`
- `INVALID_REQUEST`

A response contains the normalized request, domain status, bounded `journeys`, warning codes, and metadata containing `journeyCount`, `generatedAt`, `dataMode: REAL`, and `maxJourneys`.

Each journey contains its ID, transfer count, transport modes, ordered legs, fare summary, availability summary, duration summary, warnings, and data-quality evidence. Transit legs expose route and variant identity, direction, boarding and alighting nodes, stored signboard, fare, service, and availability. Verified PAMANA GeoJSON route geometry is included when present; otherwise transit geometry is `null`. Walking legs contain Geoapify pedestrian distance, duration, geometry, and instructions.

## Null and unknown semantics

Unknown fare, wait, transit duration, geometry, and operational facts remain `null` or carry their phase-specific `UNKNOWN` status. Zero is never substituted for missing information. Because the current transport model does not provide verified transit duration, `totalJourneyDurationSeconds` remains `null`; known walking duration is reported separately with a partial duration status.

No journey is labeled fastest, cheapest, most reliable, best, or recommended. Ordering uses fewer transfers, then fewer transit legs, then stable variant identity.

## Geoapify and PAMANA boundaries

Geoapify is called only for pedestrian paths between resolved geographic endpoints and eligible transport nodes. Missing credentials, timeout, rate limit, provider outage, and malformed responses produce sanitized error codes. A failed candidate does not discard other valid candidates. The service never substitutes straight-line walking time and never requests drive or transit routing.

Geographic providers resolve places and pedestrian paths. PAMANA determines the public-transport journey from eligible transport records.

Autocomplete and forward geocoding remain frontend concerns. Geoapify results do not create or update PAMANA transport nodes, route variants, fares, schedules, or vehicles.

## Synthetic example

The following is a **SYNTHETIC EXAMPLE** showing structure only. It is not San Juan production data.

```json
{
  "status": "JOURNEYS_FOUND",
  "journeys": [
    {
      "id": "journey-synthetic",
      "transferCount": 0,
      "legs": [
        { "type": "WALK", "distanceMeters": 120, "durationSeconds": 90 },
        {
          "type": "TRANSIT",
          "route": { "id": "synthetic-route", "code": "SYNTHETIC" },
          "durationSeconds": null,
          "geometry": null
        },
        { "type": "WALK", "distanceMeters": 160, "durationSeconds": 120 }
      ],
      "durationSummary": {
        "status": "PARTIAL",
        "knownWalkingDurationSeconds": 210,
        "totalJourneyDurationSeconds": null
      }
    }
  ],
  "meta": {
    "journeyCount": 1,
    "dataMode": "REAL",
    "maxJourneys": 5
  }
}
```

## Current production limitation

The Phase 5B PostgreSQL state has zero planning-enabled routes, route variants, and transport nodes. Research-only San Juan records remain planning-disabled and coordinate-null. The production endpoint therefore returns no eligible access nodes and no fabricated journey. Phase 14 performs no database seeding or transport-data writes.
