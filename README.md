# Draazy — React frontend

React (Vite) frontend for Draazy. It reads the live Spring Boot API through the provider seam in
`src/services/*`; the backend and Postgres must be running for the app to render anything.
See [`docs/LOCAL_DEV.md`](./docs/LOCAL_DEV.md).

## Documentation

Full system design and per-feature specs live in [`docs/`](./docs/README.md) — the authoritative
reference for building the backend. Start there:

- [`docs/system/platform-architecture.md`](./docs/system/platform-architecture.md) — context, tech stack, components, ADRs.
- [`docs/system/frontend-data-seam.md`](./docs/system/frontend-data-seam.md) — how the UI reaches the API.
- [`docs/system/data-model.md`](./docs/system/data-model.md) — ER map + persistence design (field shapes → OpenAPI schemas).
- [`docs/system/cross-cutting.md`](./docs/system/cross-cutting.md) — auth, contact gate, **maker-checker**, audit.
- [`OpenAPI spec`](./backend/src/main/resources/static/openapi/draazy-api.yaml) — the REST API contract (single source of truth; served at `/openapi/draazy-api.yaml`, Swagger UI at `/docs`).
- [`docs/flows/`](./docs/flows/) — minute-detail business logic per feature/tile (consumer, admin, ops).

## Run

```powershell
npm install
npm run dev      # http://localhost:5173
```

## Seed data

- **Seed files:** `src/data/*.json` (properties, users, localities, tickets, enquiries,
  visits, deals, services, reviews, reports, referrals, plans, reels, notifications,
  messages, settings, analytics, …). These ARE the test data.
- **Regenerate:** `npm run seed` runs `scripts/generate-seed.mjs` (deterministic seeded RNG,
  same algorithm as the original prototype) and rewrites every JSON file + `src/data/db.json`.
- **Runtime:** the app reads the live Spring Boot API through `src/services/*`, which resolves
  every domain to an `http` provider under `src/services/providers/http/`.

## Auth

`src/lib/auth.js` + `AuthContext` hold the current user. Roles: `buyer | owner | admin |
staff(+team)`. Routes are guarded by `ProtectedRoute` / `RoleRoute` (UX only — authorization is
enforced server-side).

- Consumer login: `/signin`
- Back-office login: `/staff-login` (pick Admin → `/admin`, or Ops staff + team → `/ops`)

## Structure

```
src/
  data/        seed JSON (test data)
  lib/         auth.js, format.js
  services/    the data seam — one service per domain over `providers/http/*`
  context/     Auth / City / Compare / Toast providers
  components/  layout (Navbar, Footer, AdminLayout), ui primitives, property card
  pages/       consumer/  admin/  ops/
scripts/generate-seed.mjs
```

## Migration status

- **Phase 0 + 1 (done):** scaffold, Tailwind theme, router + layouts, full seed data, the service
  seam, auth + guards.
- **Phase 3 (done):** all consumer pages live (Home, Listings, Property, Owner, Compare, Services +
  sub-services, calculators, account pages, Locality, Reels, Flatmates, Support, …).
- **Phase 4 (done):** admin back-office — Dashboard, Properties (verification queue), Analytics,
  Users, Services, Enquiries, Finance, Content, Reports (Trust & Safety), Support, Flatmates, Settings.
- **Phase 5 (done):** ops queues — shared `OpsQueue` (team-scoped tickets) powers Requests, Rent
  Agreement, Legal, Interior, Packers, Valuation; plus a Referrals fraud-review queue.

No stub routes remain (only the 404 catch-all). Every admin/ops/consumer route is verified headless
with zero console errors. The Spring Boot backend is live and the browser reaches it through the
seam described in [`docs/system/frontend-data-seam.md`](./docs/system/frontend-data-seam.md); the
society-SaaS product gap is the remaining scope.
