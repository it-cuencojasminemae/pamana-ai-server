# Simulated Driver test setup

Created on 2026-10-06 for the existing `driver` account in the local PAMANA database.

| Record | Value |
| --- | --- |
| Account | `driver` (existing credentials) |
| Driver | `DRV-TEST-001`, active, SIMULATED |
| Vehicle | `DEMO-MEX-CSF-JEEP-001` |
| Dummy plate | `DEMO-TEST-001` |
| Capacity | 20 |
| Route | `DEMO-MEX-CSF-DRIVER-001` |
| Outbound | PSU Mexico / San Juan → SM Pampanga |
| Inbound | Robinsons Starmills → PSU Mexico / San Juan |

There are three separate SIMULATED transport nodes, two directional variants,
and four ordered variant stops. Location coordinates and directional geometry
are copies of the existing pilot's stored map references. The fictional service
is explicitly SIMULATED_DEMO; no real service or fare is asserted. Existing San
Luis vehicles and verified pilot records are preserved. No password, role, or
existing authentication session is changed by the seed.

From `pamana-backend`, preview or apply the repeatable seed:

```powershell
node --env-file=.env scripts/seed-driver-demo.js
node --env-file=.env scripts/seed-driver-demo.js --apply
```

An alternative existing Driver-role account can be selected with
`--username=YOUR_USERNAME`. The seed refuses REAL profiles or an existing
assignment to another vehicle; it does not reset occupancy or vehicle state.
This fixture contains one vehicle, intended for one account at a time.

## Testing from another device

Committing and pushing these scripts does not copy database records. If the
other device opens the frontend served by this computer and uses the same
backend/database, it can use the seeded `driver` account and assigned demo
vehicle immediately. Both devices must be able to reach the backend.

For another computer running its own backend, pull this branch, configure its
database privately, and run the preview and apply commands above. The target
database needs a Driver-role account named `driver` (or pass `--username=...`)
and the source Mexico–San Fernando pilot nodes and variants listed in the script.
The script creates dummy transport records; it does not create a login account
or import the pilot dataset.

For a deployed backend whose database differs from this local database, run
the seed in that backend's environment after deployment. When the host injects
environment variables directly and has no `.env` file, use:

```sh
node scripts/seed-driver-demo.js
node scripts/seed-driver-demo.js --apply
```

The frontend must point to that backend. Configure credentials and database
connection settings in the host's environment; never commit them to Git.

Test through the frontend:

1. Log in as `driver` and open `/driver`. Confirm the demo vehicle and two directions.
2. Select a direction, start a trip, then open **Go to Current Trip**.
3. Allow browser location and keep Current Trip open while testing GPS.
4. In a separate browser profile/device, log in as Passenger or LGU and open
   `/passenger/map` or `/lgu/live-mobility`. The vehicle appears after its first
   accepted GPS fix and stays labeled SIMULATED. Observer polling is every 15 seconds.
5. With 20 seats, test 0 passengers (AVAILABLE), 18 (NEAR_FULL), and 20 (FULL).
6. End the trip, check `/driver/history`, then test the other direction.

For phone GPS, use a trusted HTTPS frontend and a compatible HTTPS/proxied API.
An ordinary HTTP LAN URL can support login without supporting browser GPS.
GPS publication is limited to once every 15 seconds and follows fresh browser
position callbacks, rather than generating artificial movement.

Actual HTTP validation is repeatable with:

```powershell
node --env-file=.env scripts/smoke-driver-demo.js
```

It starts an isolated local server on an available port, uses temporary Driver
and LGU sessions, and validates both directions: start, exact assignments/stops,
duplicate rejection, GPS validation/publication, LGU live feed, occupancy bounds,
end, and history. It removes only its own temporary trips/locations, revokes its
own sessions, and restores the demo vehicle. It does not test physical phone GPS.
Do not run this smoke while someone is using the demo vehicle.

The October 6 smoke passed for both directions. The seed was also rerun and
created zero duplicate records. Final state: available vehicle, zero occupancy,
no smoke trips or GPS records left behind. Historical database suites that assert
exact whole-database counts/digests require their original fixture database;
this intentionally adds SIMULATED records to the local test database.
