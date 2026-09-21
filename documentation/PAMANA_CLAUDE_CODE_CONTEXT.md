# PAMANA — Project Context for Claude Code

> Reference document for Claude Code when working in either `pamana-backend` or `pamana-frontend`. It consolidates the PAMANA System Concept Paper and the Complete Application Development Guide (30-phase roadmap) into one file, plus working rules for how to make changes safely on this project.
>
> **This complements, not replaces, the existing `CLAUDE.md` at the repo root**, which already covers git-workflow specifics (pull-before-push discipline, phase tagging, commit message conventions, schema-change approval requirements, post-commit plain-language summaries). Keep both in sync if either changes.

---

## 0. Quick Reference

| | |
|---|---|
| **Project** | PAMANA — Pampanga AI-powered Mobility Access and Navigation Assistant |
| **Pilot corridor** | San Luis ↔ City of San Fernando, Pampanga |
| **Frontend** | Nuxt 4 + Nuxt UI + TypeScript |
| **Backend** | Strapi 5 + TypeScript |
| **Database** | PostgreSQL |
| **Maps** | Leaflet + OpenStreetMap |
| **Repos** | `pamana-backend` (github.com/cuencojasmine/pamana-backend), `pamana-frontend` |
| **Deployment target** | Strapi Cloud (backend), Vercel (frontend) |
| **AI workstream (Phases 13–17)** | **DEFERRED.** Do not implement predictive/AI logic unless explicitly instructed — this is being handled separately. See §8. |

---

## 1. System Concept

### 1.1 The Problem

PAMANA is not a route finder — it targets **rural transportation uncertainty**. A normal navigation app tells a commuter *how* to get from San Luis to San Fernando, but not the questions that actually matter:

- Is a jeep actually available right now?
- How long will I wait?
- Is the route operating at this time?
- Where is the nearest loading point?
- Should I take a tricycle to another pickup point?
- Which route has the shortest waiting time?
- How crowded is the vehicle?
- What if no jeep arrives?
- What's the cheapest practical route?

Community discussion suggests direct San Luis jeep service can be limited, with commuters combining jeepneys and tricycles — this anecdote is **unsourced** and should be treated as illustrative, not fact, until backed by survey/citable data.

### 1.2 How PAMANA Works

**Step 1 — Passenger enters destination** (e.g. "San Luis to San Fernando by 7:30 AM"). Inputs considered: current location/destination, time, available routes and historical travel time, estimated vehicle availability, traffic/weather, passenger demand, scheduled/observed trips.

**Step 2 — AI generates ranked, comparable route options**, e.g.:

| Option | Route legs | Fare | Est. time | Notes |
|---|---|---|---|---|
| A — Cheapest | Tricycle → Jeep → Jeep | ₱50 | ~65 min | 2 transfers |
| B — Fastest | Tricycle → Jeep → Jeep | ₱70 | ~45 min | — |
| C — Most Reliable | Tricycle → designated pickup → modern jeep | ₱60 | ~52 min | High availability |

**Step 3 — Plain-language explanation**, e.g. *"Take the San Luis → San Fernando jeep. Estimated waiting time: 8–12 minutes. If no vehicle is detected after 15 minutes, proceed to the alternative pickup point."*

### 1.3 Signature Feature: Predicting Wait Time

Availability is expressed as a graded, actionable signal rather than a binary flag:

| Availability | Meaning | Example message |
|---|---|---|
| High | Vehicle likely very soon | Estimated arrival: 5–8 min |
| Medium | Some wait expected | Estimated arrival: 15–25 min |
| Low | Long or uncertain wait | Consider alternative route |

Initial prediction basis: historical average interval per route/time-slot/day. **All interval figures in the concept paper (e.g. "8 min", "12 min") are illustrative placeholders, not measured data** — real observed intervals must replace them before being presented as fact.

### 1.4 The AI Behind PAMANA (concept-level — see §8 for current status)

Four conceptual AI components:

1. **Demand Prediction** — passengers/hour for a route+time, using historical reports, day/time, weather, school schedule, holidays, events, traffic.
2. **Vehicle Availability Prediction** — next-arrival window (e.g. "7–11 minutes").
3. **Dynamic Route Recommendation** — combines cost, time, wait, transfers, reliability into a ranked recommendation.
4. **Demand Heatmap** — low/moderate/high demand across corridor towns (San Luis, Mexico, Arayat, Lubao, Guagua, Bacolor, Sasmuan, Masantol), flagging specific shortfalls (e.g. "supply insufficient by 34 passengers/hour").

### 1.5 Two-Sided Data Network

- **Driver Mode:** driver phones periodically send GPS position, route, direction, operating status, approximate passenger load — no extra hardware needed.
- **Passenger Crowdsourcing:** low-effort reports — "Jeep arrived", "Jeep is full", "Jeep has 5 seats", "Route unavailable".

### 1.6 Three User Roles

| Role | Core question |
|---|---|
| Passenger | "How do I get there?" |
| Driver / Cooperative | "Where are passengers waiting?" |
| LGU / Transport Planner | "Where is transportation insufficient?" |

Sample LGU dashboard concept: active vehicles, passengers today, high-demand areas, under-served routes, per-route demand-vs-supply %, and an AI recommendation like *"Deploy 2 additional vehicles to Masantol–San Fernando between 6:00–8:00 AM."* **All numeric examples here (127 vehicles, 4,382 passengers, etc.) are illustrative demo values, not measured data — label as sample data if shown to judges.**

### 1.7 Inclusive Mobility ("No Ride Left Behind")

Identify commuters with accessibility needs (seniors, PWDs, students, remote-barangay residents) and surface more specific guidance, e.g. *"Accessible route found — 250m walking distance, PWD-friendly vehicle, estimated waiting: 9 min."*

### 1.8 Pampanga-Specific Advantage: Flood-Aware Routing

Combine flood reports, road closures, traffic, weather, and historical flood-prone areas to recommend alternative routes and surface disruption alerts during heavy rain/flooding — a disaster-resilience feature specific to Pampanga.

### 1.9 Recommended Demo Scope

Primary corridor: **San Luis → San Fernando**. Natural second corridor: **Lubao → San Fernando** (Lubao already has a transport cooperative running modernized routes via Bacolor). Framing line: *"We started with one rural corridor, but the architecture is designed to scale across Pampanga."* This positions PAMANA as complementary to existing PUV modernization, not a replacement.

### 1.10 Why PAMANA Stands Out

| Typical transport app | PAMANA |
|---|---|
| Shows routes | Predicts transportation availability |
| Static information | Real-time + predictive |
| Passenger only | Passenger + driver + LGU |
| Navigation | Mobility coordination |
| No supply management | Demand/supply balancing |
| Reactive | Predictive |
| Generic | Designed for Pampanga |

### 1.11 Alternatives Considered (for context, not built)

- **SakaySure** — simple "will I get a ride?" probability predictor.
- **RuralRide AI** — on-demand micro-transit coordinator grouping nearby passengers.
- **Pampanga Mobility Digital Twin** — full network simulation for planners ("what if we add 5 vehicles?"); visually impressive but too heavy for a hackathon timeframe.

### 1.12 MVP Screens (from concept paper)

Passenger Map · Live Vehicle/Route Map · AI Route Recommendation · Demand Prediction · LGU/Transport Cooperative Dashboard.

Pitch "wow moment" line: *"At 7:00 AM tomorrow, PAMANA predicts 120 passengers will need transportation from San Luis to San Fernando, but only 75 seats are expected to be available. The AI recommends deploying two additional vehicles."* — use only with figures clearly labeled illustrative unless backed by real data.

---

## 2. Hackathon Context

**Judging criteria:**

| Criterion | Weight |
|---|---|
| Innovation & Creativity | 20% |
| Use of AI/Technology | 20% |
| User Experience & Design | 15% |
| Local Relevance | 15% |
| Impact & Scalability | 20% |
| Working Prototype | 10% |

**Challenge statement targeted:** *"Intelligent Rural Transportation Access — AI-enabled systems that improve access to public transport coordination, or rural mobility efficiency."*

Implication for development priorities: a **working, demonstrable prototype** on the real corridor matters more than breadth of features — favor a complete end-to-end MVP over many incomplete stretch features (see §7 Development Priority).

---

## 3. Core Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | Nuxt 4 + Nuxt UI + TypeScript | Passenger, Driver, LGU, Admin UIs |
| Backend | Strapi 5 + TypeScript | REST APIs, auth, permissions, business logic, data management |
| Database | PostgreSQL | Persistent application + transportation data |
| Maps | Leaflet + OpenStreetMap | Routes, stops, vehicles, GPS, disruptions |
| Optional AI service | Python service (future/advanced) | Advanced ML models, only if/when needed — **not started, see §8** |

Frontend support libraries: Leaflet, Vue Leaflet, Zod, date-fns (optional: Pinia, Chart.js/ECharts).

### System Architecture

```
Users (Passenger / Driver / LGU / Admin)
        ↓
Nuxt 4 Frontend + Nuxt UI + Leaflet
        ↓ REST API
Strapi 5 Backend
        ↓
PostgreSQL
```

AI services should integrate through clearly defined backend services/APIs rather than bypassing Strapi. The frontend must never query PostgreSQL directly.

---

## 4. Data Model (Strapi Content Types)

| Content type | Key fields |
|---|---|
| User | Strapi Users & Permissions; role-specific data in related types |
| Passenger Profile | user, first_name, last_name, contact_number, preferred_language, accessibility_preferences |
| Driver | user, driver_number, first_name, last_name, contact_number, license_number, status, cooperative, vehicle |
| Cooperative | name, address, contact_number, contact_person, status |
| Vehicle | vehicle_number, plate_number, vehicle_type, capacity, route, driver, status (`available`/`in_transit`/`full`/`offline`), current_occupancy |
| Route | route_name, route_code, origin, destination, base_fare, estimated_travel_time, status |
| Route Stop | name, route, sequence, latitude, longitude, stop_type |
| Trip | vehicle, driver, route, started_at, ended_at, direction, trip_status |
| Vehicle Location | vehicle, trip, latitude, longitude, speed, heading, recorded_at |
| Passenger Report | passenger, route, stop, vehicle, report_type (`vehicle_arrived`/`vehicle_full`/`seats_available`/`route_unavailable`), latitude, longitude, reported_at |
| Passenger Demand Observation | route, stop, date, time_slot, waiting_passengers, source (`observed`/`crowdsourced`/`simulation`) |
| Disruption | type (`flood`/`road_closure`/`accident`/`weather`/`route_suspension`), title, description, latitude, longitude, severity, starts_at, ends_at, status, source |
| Prediction | prediction_type, route, stop, predicted_value, confidence, prediction_time, target_time, model_version |

> ⚠️ Some fields that would normally be named `status` have been implemented under alternate names (e.g. `name_status`) due to project/Strapi naming constraints. **Always inspect the actual schema before referencing a status-like field** — never assume the name.

### Recommended repo structures

```
pamana-frontend/
├── app/
│   ├── assets/
│   ├── components/
│   │   ├── common/ passenger/ driver/ maps/ lgu/ charts/
│   ├── composables/
│   │   ├── useApi.ts
│   │   ├── useAuth.ts
│   │   ├── useGeolocation.ts
│   │   ├── useVehicleTracking.ts
│   │   └── useRoutePlanner.ts
│   ├── layouts/
│   ├── middleware/
│   ├── pages/
│   └── types/
├── public/
├── nuxt.config.ts
└── package.json
```

```
pamana-backend/
├── src/
│   ├── api/
│   │   ├── cooperative/ driver/ passenger-profile/ route/ route-stop/
│   │   ├── vehicle/ vehicle-location/ trip/ passenger-report/
│   │   ├── demand-observation/ disruption/ prediction/
│   ├── extensions/
│   └── services/
│       └── pamana-ai/
├── config/
├── database/
└── package.json
```

---

## 5. Permanent 30-Phase Development Roadmap

Teams may work on closely related tasks in parallel, but the dependencies below are the primary development order. **When told which phase is active, focus on that phase and its direct dependencies — do not silently implement future-phase functionality.**

| Phase | Area |
|---|---|
| 1 | Planning & Requirements |
| 2 | Architecture & Technology |
| 3 | Project Setup |
| 4 | UI Foundation |
| 5 | Database & Strapi Models |
| 6 | Authentication & Roles |
| 7 | Transportation Master Data |
| 8 | Passenger Application |
| 9 | Maps & Geolocation |
| 10 | Driver Application |
| 11 | Live Vehicle Monitoring |
| 12 | Passenger Crowdsourcing |
| **13** | **AI Data Foundation** — *deferred, see §8* |
| **14** | **Wait-Time Prediction** — *deferred, see §8* |
| **15** | **Demand Prediction** — *deferred, see §8* |
| **16** | **Supply/Demand Analysis** — *deferred, see §8* |
| **17** | **Dynamic Route Recommendation** — *deferred, see §8* |
| 18 | LGU Command Center *(dashboard shell can be scaffolded now with mock/observed data; full intelligence depends on 13–17)* |
| 19 | Flood & Disruption Intelligence |
| 20 | Inclusive Mobility |
| 21 | Simulation Engine (rule-based demo data — not AI/ML) |
| 22 | Notifications |
| 23 | Administration & Settings |
| 24 | Testing |
| 25 | Security & Privacy |
| 26 | Performance Optimization |
| 27 | Deployment |
| 28 | Documentation |
| 29 | Hackathon Demo Preparation |
| 30 | Final Presentation & Pitch |

### Phase notes (condensed)

**Phase 1 — Planning & Requirements:** Core problem = rural transportation uncertainty, not simple navigation. Pilot area = San Luis → City of San Fernando (Mexico, Bacolor, Lubao, Arayat, Guagua, Masantol, Sasmuan are expansion targets, not MVP prerequisites). MVP features: Passenger Trip Planner, Route Options/Comparison, Predicted Waiting Time, Live Vehicle Map, Driver GPS Tracking, Passenger Crowdsourcing, Demand Prediction, Supply-vs-Demand Analysis, AI Route Recommendation, LGU Dashboard. Stretch: flood-aware routing, advanced ML, accessibility, SMS/push, multi-corridor, automated dispatch.

**Phase 2 — Architecture:** As in §3 above.

**Phase 3 — Project Setup:**
```
pamana/
├── pamana-frontend/
├── pamana-backend/
├── documentation/
├── datasets/
└── README.md
```
Env vars — Frontend: `NUXT_PUBLIC_API_URL`, `NUXT_PUBLIC_MAP_TILE_URL`. Backend: `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USERNAME`, `DATABASE_PASSWORD`, `JWT_SECRET`, `APP_KEYS`. **No `NUXT_PUBLIC_` AI-related variables — the AI boundary must never be exposed to the frontend.**

**Phase 4 — UI Foundation:** Role-based layouts (Passenger: mobile-first, maps, recommendation cards; Driver: large touch targets, minimal interaction; LGU: sidebar + summary cards + map + charts + alerts + AI recommendations). Design tokens: Green = available/normal, Yellow = moderate/monitor, Red = shortage/disruption, Blue = informational.

**Phase 5 — Data Model:** See §4.

**Phase 6 — Auth & Roles:** Roles: Passenger, Driver, LGU, Administrator. `/login` with role-based redirection. `useAuth()` for login/logout/session/JWT/role checks. Middleware: `auth.ts`, `guest.ts`, `passenger.ts`, `driver.ts`, `lgu.ts`, `admin.ts`. Role-aware navigation.

**Phase 7 — Transportation Master Data:** CRUD for Route, Stop (lat/lng, order, pickup/drop-off), Vehicle (cooperative/route/driver/capacity assignment), Driver, Cooperative.

**Phase 8 — Passenger Application:** `/passenger` with From/To/time inputs. Trip search. Results: Cheapest / Fastest / Most Reliable / Recommended. Route details: legs, pickup points, walking distance, fare, travel time, predicted wait, transfers, reliability. *(See §6 — known Phase 08 ambiguity to verify: whether trip search returns static stored travel time or dynamic AI-predicted wait time.)*

**Phase 9 — Maps & Geolocation:** Leaflet + OSM base map. Browser geolocation with graceful permission-denied handling. Stops as markers. Vehicle markers: Green=available, Yellow=near full, Red=full, Gray=offline. Route polylines.

**Phase 10 — Driver Application:** Dashboard (assigned vehicle/route, status, demand, trip controls). Start trip (route/direction/vehicle). GPS tracking (Driver Phone → Strapi API → Vehicle Location records). Occupancy reporting: EMPTY / LOW / MODERATE / NEAR FULL / FULL (approximate, not exact counting for MVP). End trip stores departure/arrival time, route, vehicle, GPS history, duration.

**Phase 11 — Live Vehicle Monitoring:** MVP = polling (every few seconds). Advanced option: WebSockets/Socket.IO later. Smooth marker updates without full page refresh.

**Phase 12 — Passenger Crowdsourcing:** Buttons: Jeep Arrived / Jeep Full / Seats Available / Route Unavailable. Auto-attach location, time, route, stop, passenger (if available). Prevent duplicate/conflicting reports. Aggregate recent reports into a basic confidence signal.

**Phase 13–17 — AI workstream.** See §8 — deferred.

**Phase 18 — LGU Command Center:** Dashboard summary (active vehicles, passengers waiting, high-demand areas, underserved routes, active disruptions). Mobility map (vehicles, routes, pickups, demand, disruptions). Demand heatmap (green/yellow/red). Demand-vs-supply table. AI recommendation panel (depends on Phases 13–17 outputs).

**Phase 19 — Flood & Disruption Intelligence:** Manual LGU disruption reports (flood/closure/accident/suspension). Passenger reports (flooded/blocked road, unavailable route). Optional weather API integration. Alternative-route logic when a disruption is detected on the normal route.

**Phase 20 — Inclusive Mobility:** Accessibility preferences (PWD, Senior, Minimize Walking, Fewer Transfers). Accessibility attributes on vehicles/stops (wheelchair_accessible, low_floor, covered_waiting_area, accessible_toilet_nearby). Accessibility-aware route scoring adjustment.

**Phase 21 — Simulation Engine:** Simulated vehicles moving along predefined route coordinates; simulated passenger demand at stops; peak-hour variation (low/high/critical/moderate); simulated crowdsourcing events; `DEMO_MODE=true` indicator clearly shown whenever data is simulated. *(This is deterministic/rule-based demo tooling, not AI/ML — can proceed independently of the AI workstream.)*

**Phase 22 — Notifications:** In-app alerts (vehicle approaching, disruption, high wait, alternative available). LGU alerts (shortage detected, supply below threshold, flood reported). Future: email/SMS/push.

**Phase 23 — Administration:** User management (passengers/drivers/LGU/admins). Transport management (routes/stops/vehicles/drivers/cooperatives). Prediction settings (high-demand threshold, wait-time thresholds, minimum reports, simulation speed). Audit logs.

**Phase 24 — Testing:** Frontend (forms, nav, maps, responsiveness, loading/error states). API (Postman/Bruno/Insomnia — auth, permissions, CRUD, custom endpoints, invalid requests). Role testing (Passenger can't access LGU pages, Driver can't access admin, etc.). GPS testing (denied/unavailable/poor connection/offline). Prediction testing against expected scenarios.

**Phase 25 — Security & Privacy:** Never make all Strapi collections public. JWT security for driver/LGU/admin/profile data. Input validation (coordinates, route IDs, reports, prediction params). Rate limiting on reporting endpoints. Location privacy — store only what's needed, avoid unnecessary movement history.

**Phase 26 — Performance:** Reasonable GPS update interval (seconds, not ms). Load only vehicles/reports relevant to the selected corridor/map area. Pagination (users, reports, trips, vehicle history, predictions). DB indexing (route, vehicle, recorded_at, status); evaluate geospatial indexes if scaling.

**Phase 27 — Deployment:** PostgreSQL production DB. Strapi hosting per team budget (Strapi Cloud per current plan). Nuxt on a compatible platform (Vercel per current plan). dev/staging/production env config. HTTPS required (geolocation + auth).

**Phase 28 — Documentation:** Architecture, stack, project structure, API architecture, DB design, auth, AI architecture. ERD + data dictionary. API docs (method/endpoint/params/response/role). User manuals per role.

**Phase 29 — Demo Preparation:** Scripted scenario on San Luis → San Fernando: passenger picks destination/time → cheapest/fastest/recommended shown → wait prediction changes as vehicle approaches → crowdsourced "vehicle full" report triggers recalculation → simulated demand spike exceeds capacity → LGU dashboard shows the shortage → PAMANA displays an operational recommendation (e.g. add vehicles).

**Phase 30 — Final Presentation:** Problem → existing gap (maps show *where*, PAMANA predicts *whether available*) → solution (Passenger Intelligence + Driver Data + Crowdsourcing + AI Prediction + LGU Coordination) → architecture (Nuxt → Strapi → PostgreSQL → PAMANA AI services) → live demo sequence (Passenger → Trip Planner → Recommendation → Vehicle Prediction → Driver/Vehicle Data → Crowdsourcing → Demand Prediction → LGU Dashboard → AI Recommendation) → Q&A prep.

### Milestones

| Milestone | Scope | Result |
|---|---|---|
| 1 — Foundation | Phases 1–6 | Nuxt, Strapi, DB, auth, roles work |
| 2 — Transportation Data | Phase 7 | Routes/stops/vehicles/drivers/cooperatives manageable |
| 3 — Passenger MVP | Phases 8–9 | Passenger can search routes and view them on a map |
| 4 — Driver MVP | Phases 10–11 | Driver phone sends location; vehicles appear on map |
| 5 — Crowdsourcing | Phase 12 | Passenger reports stored and influence context |
| 6 — PAMANA Intelligence | Phases 13–17 | Wait/demand/supply-demand/route-recommendation logic works |
| 7 — LGU Command Center | Phase 18 | LGU can monitor vehicles, demand, shortages, recommendations |
| 8 — Advanced Features | Phases 19–22 | Disruptions, accessibility, simulation, alerts available |
| 9 — Production Readiness | Phases 23–28 | Tested, secured, optimized, deployed, documented |
| 10 — Hackathon Ready | Phases 29–30 | End-to-end demo + pitch without manual DB intervention |

### Development priority when time is limited

1. Authentication 2. Routes & Stops 3. Vehicles & Drivers 4. Passenger Trip Planner 5. Map 6. Driver GPS 7. Vehicle Tracking 8. Crowdsourcing 9. Wait-Time Prediction 10. Demand Prediction 11. Supply/Demand Analysis 12. LGU Dashboard 13. Simulation 14. AI Recommendations 15. Flood Intelligence 16. Accessibility

### Final system flow

```
Passenger ─┐
Driver ────┼──> Transportation Data ──> PAMANA Intelligence
LGU ───────┘                              │
                                          ├── Wait Prediction
                                          ├── Demand Prediction
                                          ├── Route Recommendation
                                          └── Supply/Demand Analysis
                                                   │
                                      ┌────────────┴────────────┐
                                      ▼                         ▼
                                Passenger Decisions       LGU Coordination
```

---

## 6. Data Integrity Principle (applies everywhere, every phase)

- Every training/demo observation must preserve its **source label**: `observed` | `crowdsourced` | `simulation`.
- **Never present simulated values as measured real-world data**, in code, UI copy, seed data, or presentation materials.
- Time should be normalized into fixed slots (e.g. `06:00–07:00`, `07:00–08:00`, `08:00–09:00`).
- Wait-time predictions should be expressed as a **range** ("7–11 minutes"), not a false-precision single minute.
- **Known open ambiguity:** Phase 08 (Trip Search) is marked complete, but it's unconfirmed whether it returns static stored travel time (fine) or dynamic AI-predicted wait time (would contradict the "AI only explains, never invents/predicts ahead of the deterministic services" rule until Phase 14 exists). Verify against the actual controller/API response before treating this as resolved.

---

## 7. Core Development Principles

- Build the transportation data foundation before attempting advanced AI.
- Keep San Luis ↔ San Fernando as the first working pilot; don't generalize prematurely.
- Separate measured/observed data from simulated hackathon demo data, always.
- Prioritize a complete working MVP over many incomplete stretch features.
- Use role-based access and permissions from the beginning.
- Treat the hackathon demo as one real end-to-end workflow, not disconnected screens.
- Document important architectural and data decisions as they're made.

---

## 8. AI Workstream — Currently Deferred

Phases **13 (AI Data Foundation)**, **14 (Wait-Time Prediction)**, **15 (Demand Prediction)**, **16 (Supply/Demand Analysis)**, and **17 (Dynamic Route Recommendation)** are **not to be implemented by Claude Code right now**. This is being picked up separately later.

Until then:

- Do not scaffold predictive models, wait-time algorithms, demand-classification logic, or the route-scoring/recommendation engine.
- Phase 18 (LGU Command Center) UI/dashboard shell **can** be built against mock or `observed`/`simulation`-sourced data, but wire it to real Phase 13–17 outputs only once that workstream begins.
- Any OpenAI/LLM integration work is governed by one hard architectural rule, to be enforced whenever that phase resumes: **the LLM may only explain numbers already calculated by deterministic services — it must never invent transportation facts, statistics, or route details.** No AI-related environment variables should ever be exposed to the frontend (no `NUXT_PUBLIC_` AI vars).
- If a task seems to require AI/ML logic, flag it back rather than implementing a placeholder that could later be mistaken for real predictive logic.

---

## 9. Working Rules for Claude Code

### Before modifying code
1. Inspect the existing repository — never assume a file, field, endpoint, or folder structure exists or doesn't.
2. Understand current Strapi content types, controllers, services, middleware, policies, config.
3. Understand current frontend composables, components, layouts, middleware, pages, types.
4. Reuse existing functionality; don't duplicate systems that already exist.
5. Preserve working features from earlier phases.
6. Identify whether the requested change belongs to the current phase before doing it.

### Database & Strapi
- Strapi + PostgreSQL are the authoritative source of backend data; Git does **not** contain database records (users, roles, permissions, routes, stops, vehicles, drivers, cooperatives, trips, reports, predictions).
- Preserve existing content-type schemas/relationships unless a change is explicitly required. If a schema change is necessary: explain why, list affected content types/APIs/frontend code, note migration/data risk, make the smallest safe change.
- Watch for non-standard field names (e.g. `name_status` instead of `status`) — inspect before referencing.
- Never commit `.env`, DB passwords, JWT secrets, API tokens, connection strings, or DB dumps with sensitive data. Use `.env.example` for documentation.

### Auth & permissions
- Preserve existing `useAuth()`, JWT handling, session restoration, role checks, Nuxt middleware, and Strapi Users & Permissions config.
- Never solve an authorization problem by making a Strapi endpoint publicly accessible.

### API design
- Strapi is the source of truth for business logic: Frontend → API request → Strapi service/controller → database. Don't duplicate backend ranking/prediction/validation logic in the frontend.
- When creating/modifying an API, define: HTTP method, endpoint, auth requirement, allowed roles, request params/body, response shape, error responses. Keep contracts stable; flag breaking changes explicitly.

### Frontend
- Don't redesign existing screens unless asked. Preserve layouts, navigation, visual hierarchy, Nuxt UI usage, responsive behavior.
- Reuse components and composables (e.g. `useApi()`) before creating new ones.
- Use TypeScript types/interfaces for backend responses. Handle loading, empty, API error, validation error, auth error, and permission error states.
- Mock data during parallel development must match the agreed backend response shape and be easy to swap out — never hardcode production transportation data into components.

### Maps & geolocation
- Leaflet + OpenStreetMap for route lines, stops, vehicle positions, passenger location, disruptions, demand visualization.
- Geolocation must gracefully handle permission denied, GPS unavailable, poor connection, unsupported browser — and must never be required for unrelated functionality.

### Route recommendation (once Phase 17 begins)
- Consider fare, travel time, waiting time, transfers, walking distance, reliability. Categories: Cheapest / Fastest / Most Reliable / Recommended. Keep ranking logic centralized in the backend/AI service; frontend displays results rather than recalculating. Recommendations must be explainable.

### Debugging
- Don't randomly rewrite multiple files. First determine: exact error, repro steps, relevant module, root cause, smallest safe fix. Preserve behavior outside the bug. After fixing: explain root cause briefly, list changed files, verify the original scenario, check for regressions.
- Don't mask errors with broad `try/catch`, `any`, `@ts-ignore`, or `@ts-nocheck` without a documented reason.

### Git & team collaboration
- Team works in parallel — stay in scope, don't overwrite unrelated work, inspect current git state before large changes.
- Commit style: `feat: add passenger trip search`, `fix: correct driver role authorization`, `refactor: centralize route search service`, `docs: update environment template`, `test: add trip planner validation`.
- Prioritize stable API contracts for dependents. Backend schema ownership stays coordinated with the backend developer; frontend devs shouldn't independently change Strapi schemas; any AI-related schema/API needs coordinate with the backend developer first.

### Code quality
- Priorities in order: correctness, simplicity, maintainability, readability, security, demonstrability.
- Avoid unnecessary abstraction/premature optimization; reuse existing patterns; keep controllers thin, put reusable logic in services; validate input; return meaningful errors; never silently swallow failures.

### Security
- Never expose DB passwords, JWT secrets, admin secrets, token salts, or connection strings; never commit `.env`.
- Auth + role checks on protected endpoints. Validate IDs, coordinates, report inputs, query params, prediction inputs.
- Store passenger location only when required for the intended functionality; avoid unnecessary movement-history retention.

### Phase completion reporting

At the end of any implementation task, report in this format:

```
### Completed
### Files Changed
### API Changes
### Database Changes
### Tests
### Remaining
```

Don't claim a phase is complete unless its required functionality is actually implemented and verified. When time is limited, follow the priority order in §5.

### General response conduct
- Explain intended changes briefly before major modifications; prefer minimal, targeted edits; maintain API compatibility where possible; run relevant checks/tests after changes; state exactly what changed.
- Flag any manual step the user must perform (Strapi Admin, PostgreSQL, env vars, migrations, Git actions).
- State the working directory for any terminal command; assume Windows dev machines unless the repo/environment says otherwise.
- When uncertain about existing implementation details, inspect the repo rather than guessing.
