# Approximate road-path visualization

Geoapify road routing is used only in the passenger browser to help orient the selected journey on MapLibre. The request uses the stored coordinates of already planning-eligible transport nodes returned by the factual journey contract.

Generated line features are classified as `APPROXIMATE_ROAD_PATH`. They are not stored on `RouteVariant.geometry_geojson`, are not a verified transit trace, and are never inputs to journey selection, stop order, fare, availability, ETA, disruption targeting, or planning eligibility. A future verified transit geometry remains authoritative and suppresses the approximate overlay for that leg.

The browser keeps a bounded six-hour in-memory cache and deduplicates concurrent requests. Provider failure returns no approximate line; the factual journey and its node markers remain usable.

Phase 23 includes ordered endpoint coordinates in the presentation cache key so verified coordinate edits cannot reuse older road geometry for the same node IDs.
