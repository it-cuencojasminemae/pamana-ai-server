# Phase 11: Geoapify walking access and egress connectors

Phase 11 adds server-side pedestrian connectors around the deterministic Phase 10 transport graph. Geoapify calculates pedestrian geography; PAMANA selects the public-transport journey.

## Provider boundary and configuration

`walking-router.js` calls the official Geoapify Routing API at `/v1/routing` with `mode=walk`, `format=geojson`, and `latitude,longitude` waypoints. It never requests transit, drive, or jeepney geometry. The server reads `GEOAPIFY_SERVER_API_KEY`; this value is separate from the public browser configuration and is never returned or logged. Missing configuration produces `ROUTING_PROVIDER_NOT_CONFIGURED` only when walking routing is requested, so Strapi startup remains independent of Geoapify.

For a server key, prefer provider restrictions based on the deployment server's outbound IP and allow only the Routing API when the Geoapify account supports those restrictions. Browser-origin or HTTP-referrer restrictions belong on a separate frontend key.

## Walking result contract

Successful provider responses become a provider-neutral object with `type: WALK`, normalized `from` and `to` points, nullable `distanceMeters` and `durationSeconds`, GeoJSON `LineString` or `MultiLineString` geometry, normalized pedestrian instructions, `source: GEOAPIFY`, and `calculatedAt`. This geometry can be passed to the shared MapLibre GeoJSON line contract without another provider conversion.

Empty route collections preserve distance, duration, and geometry as `null`. Malformed responses and provider failures return fixed service error codes. Raw response bodies, request URLs, exception messages, and API keys do not escape the router.

## Candidate discovery

`access-node-finder.js` accepts a geographic point and planning-eligible `TransportNode` records. Nodes must be `REAL`, planning-enabled, strongly verified under the shared trust policy, and have explicit non-fallback coordinates. Research-only, missing-coordinate, and `0,0` fallback records are excluded.

Candidate discovery first calculates Haversine distance. It prioritizes nodes within 800 metres, may fill remaining shortlist slots up to 1,500 metres, and sends at most five nodes to Geoapify. At most two requests run concurrently and each request times out after seven seconds. These values live in `walking-config.js` and may be overridden centrally. Haversine distance is only a quota-saving prefilter; the provider walking distance and duration are the pedestrian result.

The Phase 10 bridge narrows that set again before routing: access nodes must have a usable outgoing pickup edge, while egress nodes must appear as a permitted alighting endpoint. If no access candidate survives, the service stops before calculating egress connectors.

A 15-metre proximity threshold represents a passenger already at a node without inventing a walking line. The candidate remains available to Phase 10, while its walking leg and provider metrics stay `null`.

## Phase 10 integration

`walking-journey-service.js` resolves access candidates from origin to node and egress candidates from node to destination. It passes every reachable candidate node ID into the existing Phase 10 `planJourneys` function. Walking distance may order a candidate list deterministically, but it never chooses the transport route by itself.

For internal tests, `walking-journey-composer.js` attaches the matching connectors to Phase 10 results. A direct result is ordered `WALK, TRANSIT, WALK`; a one-transfer result is `WALK, TRANSIT, TRANSFER, TRANSIT, WALK`. A connector omitted by the proximity threshold is not replaced with a fake leg. Fare, wait, ETA, recommendation scoring, transport geometry, and public API orchestration remain deferred.

## Quota, errors, and cache

The service filters eligibility and radius before routing, caps the shortlist, limits concurrency, supports caller cancellation, and applies per-request timeouts. An in-memory cache stores at most 100 normalized origin/destination walk requests for five minutes. It is process-local and never persists provider responses to PostgreSQL.

Fixed errors cover missing configuration, invalid coordinates or responses, cancellation, timeout, authorization, rate limiting, provider availability, and network failure. Unavailable candidates are reported without converting unknown metrics to zero.

## Current production limitation

The current Phase 5B PostgreSQL state has zero planning-eligible coordinate-bearing transport nodes. Production access and egress discovery therefore returns no candidates and makes no Geoapify routing calls. The unresolved Phase 5A/5B research nodes retain null coordinates, planning remains disabled, and route-variant geometry remains null.
