# Phase 5A — San Juan Commuter and Remote Visual Evidence

## REMOTE VISUAL CORROBORATION — NOT PHYSICAL FIELD VERIFICATION

The evidence in this document supports research passenger-point concepts only. The PAMANA development team has not yet physically ridden and GPS-surveyed the San Juan/PSU Mexico ↔ SM/Robinsons service.

- Remote visual corroboration performed: **2026-09-22**
- Tool: **Google Maps Street View**
- Location 1: **SM City Pampanga Main Gate**
- Location 2: **Robinsons Starmills Arayat Gate**
- Verification status: `CORROBORATED_RESEARCH`
- Data mode: `REAL`
- Passenger planning: disabled

No commuter identity, browser profile, Street View URL parameters, camera coordinates, or unrelated screenshot metadata is stored.

## Evidence received

A regular commuter who uses the San Juan/PSU Mexico ↔ SM/Robinsons service reported that:

- passengers commonly alight at the SM City Pampanga main-gate area on the outbound journey; and
- return trips toward San Juan are boarded from the Robinsons Starmills terminal area.

A PAMANA team member manually reviewed the supplied Google Maps Street View imagery on 2026-09-22 and:

- visually identified the referenced outbound location as the SM City Pampanga main-gate area;
- visually identified the return location as the area in front of Robinsons Starmills Arayat Gate; and
- observed public-transport vehicles/jeepneys in the Robinsons transport area.

This combination is stronger than an unsupported research lead, but it is not physical field verification.

## Database records

| Passenger role | Internal code | Node type | Coordinates | Planning | Database ID / document ID |
|---|---|---|---|---|---|
| Outbound drop-off | `RCH-SM-PAMPANGA-MAIN-GATE-DROPOFF` | `DROP_OFF` | null / null | false | `7` / `39556cc647622dfd679e0312` |
| Inbound loading | `RCH-ROB-STARMILLS-ARAYAT-GATE-LOAD` | `LOADING_BAY` | null / null | false | `8` / `da1b2236b63f6a62ba273fb4` |

These records are separate because the outbound and return passenger locations are physically different concepts. The future journey engine must not derive the inbound endpoint by reversing the outbound endpoint.

## External place corroboration

- Robinsons Malls identifies Robinsons Starmills in Barangay San Jose, City of San Fernando, Pampanga and along Gapan–Olongapo Road: <https://robinsonsmalls.com/mall-info/robinsons-starmills>
- DOST Region III publicly identifies “Robinsons Starmills (Arayat Gate)” as a named event location: <https://region3.dost.gov.ph/market-launching-of-innovative-products/>
- The City of San Fernando business registry provides SM City Pampanga/Barangay San Jose context: <https://cityofsanfernando.gov.ph/wp-content/uploads/2026/03/BUSINESS-MASTERLIST-AS-OF-FEBRUARY-27-2026-1.pdf>

These sources corroborate place identity and naming. They do not independently establish the San Juan service’s exact passenger bay.

## What the evidence does not prove

For SM City Pampanga, the evidence does not prove:

- an official designated jeepney bay;
- the exact legal unloading bay;
- an exact stopping coordinate; or
- an exact terminal assignment.

For Robinsons Starmills, the evidence does not prove:

- the exact San Juan bay number;
- an exclusive San Juan terminal assignment;
- the current operating schedule;
- the current fare; or
- current fleet availability.

A Street View camera coordinate is not used as a transport-point coordinate, and a mall-centre coordinate is not used as a loading or unloading coordinate. `latitude`, `longitude`, and `google_place_id` therefore remain null.

## RouteVariant relationship status

Neither `RCH-SJ-SMROB-OUT` nor `RCH-SJ-SMROB-IN` existed when this update was prepared. No RouteVariant, incomplete RouteVariantStop sequence, or passenger-ready relationship was fabricated.

If those research variants are later created while still `CORROBORATED_RESEARCH`, `REAL`, and planning-disabled, the Phase 5A seeder can safely attach:

- the SM main-gate node as the outbound end node; and
- the Robinsons Arayat Gate node as the inbound start node.

It refuses to overwrite a different existing endpoint or attach to a non-research/planning-enabled variant.
