# PuneNest — React (frontend-only)

React (Vite) port of the PuneNest prototype. **No backend, no database** — all test data
lives in `src/data/*.json` and is loaded into `localStorage` through a mock API layer.

## Documentation

Full system design and per-feature specs live in [`docs/`](./docs/README.md) — the authoritative
reference for building the backend. Start there:

- [`docs/system/platform-architecture.md`](./docs/system/platform-architecture.md) — context, tech stack, components, ADRs.
- [`docs/system/frontend-data-seam.md`](./docs/system/frontend-data-seam.md) — the `mock→http` seam.
- [`docs/system/data-model.md`](./docs/system/data-model.md) — ER map + persistence design (field shapes → OpenAPI schemas).
- [`docs/system/cross-cutting.md`](./docs/system/cross-cutting.md) — auth, contact/Aadhaar gate, **maker-checker**, audit.
- [`OpenAPI spec`](./backend/src/main/resources/static/openapi/punenest-api.yaml) — the REST API contract (single source of truth; served at `/openapi/punenest-api.yaml`, Swagger UI at `/docs`).
- [`docs/flows/`](./docs/flows/) — minute-detail business logic per feature/tile (consumer, admin, ops).
- [`docs/roadmap/build-roadmap.md`](./docs/roadmap/build-roadmap.md) — phased backend build order.

## Run

```powershell
npm install
npm run dev      # http://localhost:5173
```

## Mock data

- **Seed files:** `src/data/*.json` (properties, users, localities, tickets, enquiries,
  visits, deals, services, reviews, reports, referrals, plans, reels, notifications,
  messages, settings, analytics, …). These ARE the test data.
- **Regenerate:** `npm run seed` runs `scripts/generate-seed.mjs` (deterministic seeded RNG,
  same algorithm as the original prototype) and rewrites every JSON file + `src/data/db.json`.
- **Runtime:** `src/lib/mockApi.js` seeds `localStorage` (key `puneNestDB_v1`) on first run and
  exposes async CRUD. It is the single swap-point for a future real API — replace the function
  bodies with `fetch()` and the UI doesn't change.
- Visit `/dev-seed` in the app to reset the mock database or clear the logged-in user.

## Auth (mock)

`src/lib/auth.js` + `AuthContext` store the current user in `localStorage` (`puneNestUser`).
Roles: `buyer | owner | admin | staff(+team)`. Routes are guarded by `ProtectedRoute` /
`RoleRoute` (UX only — not real security).

- Consumer login: `/signin`
- Back-office login: `/staff-login` (pick Admin → `/admin`, or Ops staff + team → `/ops`)

## Structure

```
src/
  data/        seed JSON (test data)
  lib/         mockApi.js, auth.js, format.js
  context/     Auth / City / Compare / Toast providers
  components/  layout (Navbar, Footer, AdminLayout), ui primitives, property card
  pages/       consumer/  admin/  ops/
scripts/generate-seed.mjs
```

## Migration status

- **Phase 0 + 1 (done):** scaffold, Tailwind theme, router + layouts, full seed data, mock API,
  auth + guards.
- **Phase 3 (done):** all consumer pages live (Home, Listings, Property, Owner, Compare, Services +
  sub-services, calculators, account pages, Locality, Reels, Flatmates, Support, …).
- **Phase 4 (done):** admin back-office — Dashboard, Properties (verification queue), Analytics,
  Users, Services, Enquiries, Finance, Content, Reports (Trust & Safety), Support, Flatmates, Settings.
- **Phase 5 (done):** ops queues — shared `OpsQueue` (team-scoped tickets) powers Requests, Rent
  Agreement, Legal, Interior, Packers, Valuation; plus a Referrals fraud-review queue.

No stub routes remain (only the 404 catch-all). Every admin/ops/consumer route is verified headless
with zero console errors. Remaining work is Phase 2/4–6 of the original plan: real auth, a backend +
DB to replace the localStorage mock API, and the society-SaaS product gap. The phased backend build
order is documented in [`docs/roadmap/build-roadmap.md`](./docs/roadmap/build-roadmap.md).
