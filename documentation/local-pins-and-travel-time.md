# San Juan pins and approximate travel times

Implemented and validated on 2026-10-07. Pins are temporary geographic endpoints. No transport records, route coverage, stop records, fare rules, or transport schema were changed.

## Passenger behavior

- Trip Planner and Live Map have starting-point and destination pin controls and a shaded San Juan selection area. Click/tap within the polygon, or pan the focused map with arrow keys and press Enter. Outside selections are rejected; outer boundary edges are included and holes and hole edges are excluded.
- Trip Planner pins populate the existing inputs. Replacement, clearing, and swapping preserve coordinate identity. Coordinates are stored at full numeric precision in `fromPinLat/fromPinLng` or `toPinLat/toPinLng` URL parameters. Refresh restores coordinates without geocoding display text. Live Map's “Plan from here” and “Plan to here” links pass the exact coordinates.
- Reverse geocoding only enriches the label. Failure leaves the coordinate selection usable. Search remains available for existing external destinations, including PSU Mexico, SM City Pampanga, and Robinsons Starmills.
- The existing eligible journey planner still uses its 1.5 km geographic pickup search limit. A pin is not a stop. Unsupported locations report that verified transport coverage is unavailable. Planner walking instructions now appear in leg order in Route details, before/after existing signboards, fares, and transfer instructions; the AI is optional.
- The separate Approximate travel time panel uses available planner walking durations and an approximate Geoapify road time. It does not change the AI prompt/prose, trip DTO durations, fares, recommendations, or Fastest ranking. It gives no arrival clock time or jeepney pickup ETA. Partial results remain partial.

## Boundary source and verification

Source: [PSA Barangay layer 4, DOST GeoRisk Philippines](https://portal.georisk.gov.ph/arcgis/rest/services/PSA/Barangay/MapServer/4). Queried exact identity `brgy_name='San Juan' AND city_name='Mexico' AND prov_name='Pampanga'` with `outFields=*`, full geometry, and `outSR=4326`; retained the unreduced source polygon.

Identity: San Juan / Mexico / Pampanga, PSGC `0305413031`, source barangay code `035413031`. Dataset description identifies indicative June 2016 boundaries based on the 2015 census. This is not a claim that the polygon is a current legal survey. Local boundary revisions remain a release risk; an LGU-provided newer polygon should replace this version only after the same identity, reference, geometry, and containment checks.

Files: `src/services/pamana-journey/data/san-juan-psa-boundary.geojson` and `san-juan-boundary-verification.json`. The verification receipt records 2026-10-07, source URL, exact geometry SHA-256, and reference checks against existing field-verified coordinates: PSU Mexico front waiting area inside; Mexico Bayan church, SM main gate, and Robinsons Arayat gate outside. Both sides use the same API polygon and matching Polygon/MultiPolygon containment semantics. Missing/corrupted files, identity/hash drift, invalid rings, or failed reference checks disable pins without crashing the existing planner. A radius or rectangle is never used as the allowed area.

## API and provider safeguards

Authenticated Passenger/LGU/Administrator access is granted by the existing startup permission reconciliation. Anonymous and other roles remain denied.

| Endpoint | Contract |
| --- | --- |
| `GET /api/pamana-ai/pin-area` | Availability, verification state, source/verification date, full verified GeoJSON feature, separate travel-time feature flag. No-store. |
| `POST /api/pamana-ai/travel-time` | Only `{ request: <existing trip-plan request>, journeyId: <selected ID> }`; 10 KB limit and 30 requests per minute under the existing rate limiter. No-store. |

The travel-time endpoint validates locations (including `MAP_PIN` geofence), replans server-side, and finds the selected eligible REAL journey. Unknown/stale/simulated selections produce an unavailable result. Client routes, durations, extra fields, and malformed requests are rejected. The response includes journey ID, COMPLETE/PARTIAL/UNAVAILABLE/DISABLED status, known walking and road seconds, completion flags/counts, moving seconds only when all components are known, calculation/expiry timestamps, exclusions, and safe reason codes.

Each road leg is clipped from the planner's existing verified corridor at boarding/alighting. Absent, ambiguous, or reversed corridors receive no estimate. Geoapify receives driving mode, `traffic=approximated`, and up to 20 corridor waypoints. Its LineString or connected MultiLineString must pass a symmetric 25 m sampling comparison within 50 m of the verified corridor, with endpoint checks. Disconnected geometry, shortcuts/detours beyond that tolerance, malformed responses, quota errors, and timeouts remain unknown. No geometry bridges are invented. Corridor comparison is an approximation, not a proof of legal road access.

Provider calls have a seven-second timeout, abort support, at most two active requests per process, and a 100-entry cache lasting at most five minutes. Only successful corridor matches are cached server-side. The browser cancels superseded requests, guards against stale results, uses a 40-entry bounded cache, and clears expired estimates. It allows 30 seconds for server replanning plus bounded ride calls; failures leave directions and fares usable. API/server keys remain server-side; the existing public basemap key is unchanged.

Exclusions: waiting, boarding, transfer delays, unscheduled stops, and live traffic. [Geoapify approximated traffic documentation](https://apidocs.geoapify.com/how-to/routing/traffic-route-times/) explains that this model is not live traffic or a departure-time-specific prediction. Frequent jeepney stops and leave-when-full departures can make actual journey time longer. Keep estimates separate from AI narration and route ranking.

## Validation evidence

- Frontend portable suite: **154 tests passed**, plus the selected-journey map contract checks. Includes actual Vue setup/rendering, full-precision restore/handoff, outside/edge/hole pins, replacement/clear/swap, enrichment failure, cancellation/cache/expiry, partial time display, post-render independent time fetch, deterministic walking-step order, and MapLibre overlay style-load recovery.
- Backend focused regression run: **57 tests passed** across local pin/time, fares, approved geometry, recommendations, AI guide, and deployment configuration suites. Tests include missing/corrupt boundary data, simulated/forged/stale requests, independent flags/auth/quota, route mismatch, actual Geoapify MultiLineString, timeout, partial walks/rides, and unknown components.
- Both production builds passed. Sandbox dependency-resolution restrictions required running builds with local build permission; there were no application build errors.
- Seven live authenticated localhost acceptance cases passed; see `local-pins-time-acceptance.json`. Checked regular direct/transfer fares ₱27/₱114, student ₱22/₱111, inbound Robinsons-to-San-Juan pin/signboard, out-of-area rejection, unsupported in-area point, unchanged Fastest ranking, and a real COMPLETE Geoapify road estimate. Values are examples from this verification run, not promised future trip times.
- Desktop 1366×900 and mobile 390×844 browser checks: visible polygon and controls; click/keyboard pin placement; outside rejection without replacing endpoints; refresh and Live Map destination handoff with exact coordinates; local pin-to-SM journey, signboard/fare and walking instructions; separate approximate-time panel. Mobile rendered content width remained within the viewport. Screenshots are under frontend `documentation/local-pins-time-{desktop,mobile}.png`.
- The transport data digest before and after acceptance is unchanged: `c3e0df0c5fdaf1c8ea5fb5873d635d8f5d6188858a41e589059465971e4782f4`. No transport migration or coverage promotion was performed. Configured server credentials were absent from all 230 frontend source/public build files scanned. The disposable local test account was removed after validation.

Re-run frontend with `npm test`; backend with `node --test scripts/test-local-pins-travel-time.js scripts/test-batch-b-recommendations.js scripts/test-batch-c-guide.js scripts/test-batch-a-fares.js scripts/test-batch-a5b-geometry.js scripts/test-deployment-config.js`. The localhost-only `scripts/test-local-pins-time-http.js` additionally requires a disposable `phase24-browser-*` Passenger account, `PAMANA_TEST_USERNAME`, `PAMANA_TEST_PASSWORD`, and optionally `PAMANA_TEST_EXPECTED_DIGEST`; it never creates transport records. Do not commit test credentials or JWTs.

## Rollout and rollback

1. Deploy backend support and verified boundary files with both feature flags false. Startup reconciles the two authenticated permissions using the existing mechanism; no transport schema migration is needed.
2. Deploy the frontend and validate login, ordinary search, supported pilot journeys/discounts, both passenger maps, and disabled controls/time behavior. A missing/older backend keeps pins unavailable and search usable.
3. Set `PAMANA_MAP_PINS_ENABLED=true` after validating the source/reference receipt against the intended release locale. Independently set `PAMANA_TRAVEL_TIME_ENABLED=true` after verifying provider configuration, usage limits, and example road corridors. Both require backend process restart to apply environment changes. `.env.example` keeps both false; this workspace's untracked local `.env` enables both for testing/use.
4. Monitor request counts, provider 429s, timeouts, corridor mismatch frequency, and response latency; use Geoapify's usage dashboard for provider consumption. Optional `PAMANA_TRAVEL_TIME_LOG_METRICS=true` emits only status, elapsed milliseconds, and uppercase reason codes, without coordinates/labels/IDs/API keys. Limits and caches are per process, so multiple backend instances need shared limiting if aggregate quotas become a concern.
5. Roll back either addition by setting its own flag false and restarting the backend. Refresh passenger pages to receive the new gates. Pin requests are revalidated server-side; new road estimates stop immediately after the restart. Existing on-screen estimates expire within five minutes. Search, deterministic directions, fares, and ranking continue through their original endpoints.

Risk remains manageable, not zero: indicative-boundary accuracy, provider road/traffic approximation, road-access changes, and multi-instance usage are the material remaining limits. No Google integration or new transport data is included.
