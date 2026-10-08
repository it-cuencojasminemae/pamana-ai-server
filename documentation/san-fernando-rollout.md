# San Fernando landmarks and outbound expansion

Implemented and validated on 2026-10-07. No transport schema migration or new administration screens. MapLibre, the configured basemap and attribution, Geoapify, existing fare rules, and the San Juan pin boundary remain in use.

## Current release state

The local `.env` enables `PAMANA_PILOT_LANDMARKS_ENABLED=true`. All eleven curated landmarks are available to authenticated Passenger, LGU and Administrator users on both passenger maps and in location search. Default example configuration remains off. `PILOT_LANDMARK` requests resolve canonical IDs and exact coordinates on the server; building locations do not become transport stops. Arbitrary pins still require the verified San Juan boundary.

`PAMANA_CSF_ROUTE_EXPANSION_ENABLED=false` remains off locally. The three new service variants and the directed SM pedestrian connection remain pending verification and have not been inserted into the live database. Even with the flag on, an incomplete manifest disables expansion. With expansion disabled, the loader and planner exclude its registered variants and walking links, and retain the legacy transfer limit.

Landmarks, expansion, pins and travel times have independent flags. Landmark availability does not promise a supported journey to every catalog destination, or pickup coverage everywhere within San Juan. The pickup search radius remains 1.5 km.

## Evidence and review

Catalog: `src/services/pamana-journey/data/san-fernando-landmarks.json`. Candidate transport manifest: `scripts/data/san-fernando-expansion.json`, version 1.0.0, report date 2026-10-07, observation date unknown. Commuter testimony records supplied coordinates and signboards; it does not establish safe passenger curb positions or verified geometry.

Before activation, record the reviewer, verification date and source reference for each actual passenger point, each corridor and the pedestrian link. Confirm stop order and termini separately for both Mexico Bayan City Proper patterns. Remove candidate intermediate stops not confirmed for each pattern. Obtain safe road-side coordinates for building-adjacent stops and the SFELAPCO terminus. The existing SM drop-off is reused; the separate terminal boarding point and the two distinct downtown drop-offs retain the supplied coordinates.

Approve the SM drop-off-to-terminal pedestrian connection in the stated direction, with safe pedestrian access/crossing evidence. Explicitly review the two listed SM transfer-permission changes. Proximity never creates a walking transfer. No return variants, Robinsons crossing, or Angeles/Lubao/Bacolor/Guagua routable services are included. Makabali is a signboard alias only.

## Activation and rollback

1. Deploy compatible backend code first; keep expansion off. Run `npm run activate:san-fernando:dry-run`. The current pending manifest reports missing evidence without changing the database.
2. Complete the reviewed manifest and set its status to `VERIFIED`. Run dry-run again against the target database. It uses a transaction that rolls back and refuses drift in existing records. Review proposed nodes, variants, links, and the exact two permission changes. Existing geometry and fare records are preserved.
3. Hash the normalized reviewed JSON: `node -e "const fs=require('fs'),crypto=require('crypto');console.log(crypto.createHash('sha256').update(JSON.stringify(JSON.parse(fs.readFileSync('scripts/data/san-fernando-expansion.json','utf8')))).digest('hex'))"`. Apply with `node --env-file=.env scripts/activate-san-fernando-expansion.js --apply --approved-sha256=HASH` using that reviewed hash.
4. Preserve `documentation/san-fernando-activation-receipt.json`. Repeating the same activation is idempotent. Receipt creation precedes commit; a commit failure may leave an audit receipt that requires reconciliation before another apply. Do not discard it blindly.
5. Enable expansion only after target-environment validation, then restart backend workers. Enable landmarks independently and deploy compatible frontend controls after backend support.
6. For rollback, disable expansion first and restart workers. Run `node --env-file=.env scripts/activate-san-fernando-expansion.js --rollback` to preview, then append `--apply` to restore introduced transport records and the two flags. Rollback refuses intervening transport changes. The receipt remains an audit artifact; archive a reconciled receipt before a subsequent new activation. Normal operational location updates do not enter the transport digest.

## Passenger behavior and estimates

Expansion permits three vehicle rides and two vehicle transfers without cycles. A reviewed SM walking transfer routes through the walking provider; an unavailable required pedestrian path suppresses dependent journeys while retaining other eligible journeys. Access, transfer and egress walks are labeled separately and have no fare. Fares and discounts apply per boarding; missing verified inputs remain unknown.

Options are grouped by ordered service/terminus pattern before the five-option limit, selecting the least total walking representative and retaining existing ranking tie-breakers. Deterministic boarding instructions require checking the signboard and asking the driver about the landmark and final drop-off. Three-ride AI guides allow six sentences/180 words; shorter guides retain their previous limits and deterministic fallback.

Approximate moving-time estimates include every available walking/road component, with unknown components retained. Client allowance is 40 seconds; each provider timeout remains seven seconds and cache lifetime five minutes with bounded storage. Cancellation and stale-response guards remain. Estimates do not affect Fastest ranking or AI prose and exclude waiting, boarding and transfer delays. Geoapify approximated traffic is not live traffic or a jeepney pickup ETA.

## Validation record

- Frontend portable suite: 165 tests passed, plus three selected-journey map contract checks.
- New backend expansion/landmark suite: 19 tests passed. Relevant existing journey, walking, fare, disruption, explanation and security suites passed.
- Activation database suite: four checks passed using session-local temporary tables; dry-run, idempotence, drift rejection and rollback verified. Live transport digest unchanged.
- Current verified pilot database audit: 16 Passenger requests passed across PSU/Mexico/SM/Robinson pairs and regular/student/senior/PWD fares; geometry, ranking and transport digest unchanged. The historical API smoke checksum predates existing demo records; it was not rewritten.
- Backend and frontend production builds passed.
- Running HTTP checks: anonymous catalog access denied; Passenger receives eleven enabled landmarks; mismatched coordinates, unknown IDs and arbitrary San Fernando pins rejected.
- Desktop and mobile browser checks: named hospital icon/label, catalog selection, origin/destination actions, JBL planner refresh, and Live Map hospital handoff verified. Screenshots: `pamana-frontend/documentation/san-fernando-landmarks-desktop.jpg` and `san-fernando-landmarks-mobile.jpg`. Browser viewport override reset. Only a disposable local Passenger fixture was used and removed afterward. The in-app browser needed another login after a later full-page navigation; the tested planner refresh restored its landmark ID correctly. This does not establish cross-browser session reliability.

Monitor planning failures, required pedestrian-route failures, estimate latency and provider usage. `PAMANA_CSF_LOG_METRICS=true` enables sanitized planning counts/timing, including pedestrian-failure counts, without logging passenger coordinates or credentials. Accuracy and integration risk remain moderate, and zero breakage cannot be guaranteed.
