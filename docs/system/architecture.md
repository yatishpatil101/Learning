# System Architecture

PuneNest is a Pune-first real-estate marketplace (competing with NoBroker / MagicBricks).
This document describes the architecture of the React web app as it exists in the repo, and
the shape of the future backend it is designed to grow into.

Related docs:
- [`./domain-model.md`](./domain-model.md) - canonical entities (SSOT for the PostgreSQL schema).
- [`./cross-cutting.md`](./cross-cutting.md) - auth/roles, contact + Aadhaar gate, maker-checker, soft-delete/audit, error shape.
- [`./api-contract.md`](./api-contract.md) - REST endpoints the future backend must expose.

---

## 1. Overview and context

PuneNest is a single-page React application. Today it is **frontend-only**: there is no server
and no database. Every piece of "business" data (properties, users, enquiries, visits, deals,
services, tickets, reports, referrals, plans, reels, notifications, messages, settings,
analytics, and so on) is shipped as seed JSON under `src/data/` and loaded into the browser's
`localStorage` on first run. All reads and writes go through an in-browser mock API layer that
returns Promises to simulate network latency.

Two consequences follow from this "frontend-only reality":

- **The mock layer is the business logic.** Filtering, moderation, maker-checker finalization,
  contact gating, finance math, etc. currently live in JavaScript in the browser. The
  `docs/` set exists to capture that logic precisely so it can be re-implemented server-side.
- **There is no real security.** Auth, roles, and route guards are UX conveniences backed by
  editable `localStorage` (see `src/components/RouteGuards.jsx`, which states this in a comment).
  A real backend must own authentication and authorization.

**Future backend.** The intended target is a **Spring Boot + PostgreSQL** REST backend. The app
is already wired so it can flip from the in-browser mock to real HTTP without UI changes (see
section 4). `src/services/config.js` names the default backend URL `http://localhost:8080/api`,
which is the conventional Spring Boot port.

---

## 2. Tech stack

| Layer | Choice | Notes / file |
| --- | --- | --- |
| UI library | **React 19** (`react` / `react-dom` `^19.2.7`) | `package.json`. Rendered in `StrictMode`. |
| Build tool / dev server | **Vite 6** (`^6.0.5`) with `@vitejs/plugin-react` | `vite.config.js` |
| Router | **react-router 7** (`^7.18.1`) using `BrowserRouter` | `src/main.jsx`, `src/App.jsx` |
| Styling | **Tailwind CSS 3** (`^3.4.17`) + PostCSS + Autoprefixer | `tailwind.config.js`, `postcss.config.js` |
| Icons | `lucide-react`, `@phosphor-icons/react` | - |
| Charts | `chart.js` + `react-chartjs-2` (admin analytics) | code-split as `vendor-charts` |
| PDF / docs | `jspdf`, `pdfjs-dist` (statements, secure viewer) | code-split vendor chunks |
| Maps | `@vis.gl/react-google-maps` (Google Maps + Places) | bootstrapped once in `main.jsx` |
| i18n | `i18next` + `react-i18next` + language detector | `src/i18n`, imported in `main.jsx` |
| Tests | **Playwright** (`@playwright/test`) | `playwright.config.js`, `tests/*.spec.js` |
| Lint | ESLint 8 + React / hooks / jsx-a11y plugins | `npm run lint` |

Note: the design brief mentioned "React 18", but the repo actually pins React 19 and
react-router 7. This document follows the code.

**Tailwind theme.** A dark "ink" palette (`ink`, `ink-2`, `ink-card`) plus a teal/indigo/coral
`brand` scale, the `Outfit` font, and a few keyframe animations (`heroGradient`, `fadeUp`,
`slideIn`) are defined in `tailwind.config.js`.

**Build packaging.** `vite.config.js` splits heavy, self-contained vendor libraries
(`jspdf`, `pdfjs-dist`, `chart.js`, `react-dom`/`react-router`, etc.) into their own long-lived
cacheable chunks via `manualChunks`. Route-level code splitting is done in `App.jsx` with
`React.lazy` + `Suspense` (only `Home`, `Signin`, `Signup`, `StaffLogin`, `Stub` are eager).

### App bootstrap and provider tree

`src/main.jsx` mounts the app and wraps it in the global context providers (outermost to
innermost):

```
BrowserRouter
  AuthProvider        // current user + role (localStorage-backed)
    CityProvider      // active city + "coming soon" waitlist
      CompareProvider // property compare tray (max 4)
        ToastProvider // transient toast notifications
          APIProvider (Google Maps, only when a key is configured)
            App
```

`App` is additionally guarded at the route level by two more flag contexts,
`AppFlagsContext` (consumer feature flags) and `AdminFlagsContext` (admin module RBAC + tab
flags), consumed inside `src/components/RouteGuards.jsx`.

---

## 3. Folder structure

Annotated tree of `src/` (selected, representative entries):

```
src/
  main.jsx              App entry: provider tree, Maps bootstrap, scroll-restore guard.
  App.jsx               Route table. Consumer / admin / ops route groups + guards + lazy imports.
  i18n/                 i18next setup + translation resources.
  styles/               Tailwind entry (index.css) and global styles.

  context/              React context providers (global client state).
    AuthContext.jsx       Current user, role, team; login/register/staffLogin/logout/update.
    CityContext.jsx       Active city, live-city roster, "coming soon" waitlist requests.
    CompareContext.jsx    Compare tray of up to 4 property ids.
    ToastContext.jsx      Toast queue + <Toast> UI.
    AppFlagsContext.jsx   Consumer feature flags (gates routes like /compare, /saved).
    AdminFlagsContext.jsx Admin tab flags + per-user module access (RBAC).

  services/             The mock -> http provider seam (see section 4). NEW abstraction.
    config.js             Reads VITE_API_MODE; resolves mock vs http provider per domain.
    index.js              Barrel re-export of the service modules.
    propertyService.js    Public API a component imports (property discovery + moderation).
    authService.js        login / staffLogin / logout / getMe / updateMe.
    dealService.js        Deals, maker-checker finalization, offers/negotiation.
    contactService.js     Owner contact-request flow.
    financeService.js     Owner property finance (basis, transactions, loans, budgets, reports).
    providers/
      mock/               localStorage-backed providers (active). One *Provider.js per domain.
        propertyProvider.js, authProvider.js, dealProvider.js, contactProvider.js,
        financeProvider.js, adminProvider.js, listingProvider.js, savedProvider.js,
        visitProvider.js, contentProvider.js, documentProvider.js
      http/               REST providers for the future backend. EMPTY today (scaffold only).

  lib/                  Non-UI logic + the original mock API. Most business logic lives here.
    mockApi.js            Barrel re-exporting mockApi/*; importing it runs the localStorage seed.
    mockApi/              Domain modules: core.js (seed/load/save), properties.js, users.js,
                          team.js, tickets.js, collections.js, audit.js, staff.js, ...
    auth.js               Mock session (puneNestUser) + user registry; role helpers.
    format.js             fmtINR / fmtNum / timeAgo / esc / classNames formatting helpers.
    persist.js            Dev-only disk persistence of the mock DB (via Vite plugin).
    data/                 Page-specific data modules that read/write the same mock DB directly.
    store.js, permissions.js, geoConfig.js, mapsConfig.js, places.js, ... (many helpers)

  data/                Seed JSON = the test data. db.json is the composed snapshot.
    db.json               Full seeded DB (users, listings, tickets, enquiries, visits, deals,
                          localities, services, reviews, reports, referrals, plans, reels,
                          notifications, messages, settings, team, share*, analytics, auditLog).
    properties.json, users.json, ... per-collection seed files (see scripts/generate-seed.mjs).

  components/          Reusable UI. layout/ (ConsumerLayout, AdminLayout, Navbar, Footer),
                      RouteGuards.jsx, property/, dashboard/, admin/, ui/ primitives, etc.

  pages/              Route screens.
    consumer/           Home, Listings, Property, Owner, Compare, Services + services/*, account
                        pages, Locality, Reels, ShareFlat, Support, legal pages, DevSeed, ...
    admin/              Back-office: Dashboard, Properties (verification queue), Analytics, Users,
                        Services, Enquiries, Finance, Content, Reports, Flatmates, Team, Settings.
    ops/                Team-scoped queues: Requests, RentAgreement, Legal, Interior, Packers,
                        Valuation, Referrals, ShareReview (shared OpsQueue pattern).
    Stub.jsx            404 catch-all.
```

Route groups in `App.jsx`:

- **Consumer** (`ConsumerLayout`): public pages plus `ProtectedRoute`-gated account pages, with
  several routes behind consumer feature flags (`AppFlagRoute`).
- **Admin** (`AdminLayout variant="admin"`): guarded by `RoleRoute roles={['admin','manager']}`,
  and each tab additionally wrapped in `ModuleRoute` (per-user RBAC) and/or `FlagRoute` (tab on/off).
- **Ops** (`AdminLayout variant="ops"`): guarded by `RoleRoute roles={['staff','admin']}`, with
  service queues further scoped by `TeamRoute` (staff must belong to the team).

---

## 4. The mock -> http provider seam (key architectural point)

This is the most important structural decision in the app. Components never talk to
`localStorage` or `fetch` directly for the seam'd domains; they import a **service** module,
which delegates to whichever **provider** is active. Flipping the whole app from the in-browser
mock to a real REST backend is a single environment variable, with **zero component changes**.

### The three layers

1. **Service** (`src/services/*Service.js`) - the stable public API a component imports. Every
   function returns a Promise. Example (`propertyService.js`):

   ```js
   import { createProvider } from './config.js';
   const provider = createProvider('property');
   export const listProperties = (filters, sort) => provider().listProperties(filters, sort);
   export const getProperty   = (id) => provider().getProperty(id);
   ```

2. **Provider selector** (`src/services/config.js`) - reads the env flag and resolves the domain
   to a provider module, caching the result:

   ```js
   const API_MODE = import.meta.env.VITE_API_MODE || 'mock';   // 'mock' | 'http'
   export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8080/api';
   export const isMock = API_MODE === 'mock';
   // createProvider(domain) -> getMockProvider|getHttpProvider, resolved via import.meta.glob:
   //   ./providers/mock/<domain>Provider.js   or   ./providers/http/<domain>Provider.js
   ```

3. **Provider** (`src/services/providers/{mock,http}/*Provider.js`) - the interchangeable
   implementation. The **mock** provider wraps the existing `lib/` code and adapts it to the async
   Promise contract. Example (`providers/mock/authProvider.js`):

   ```js
   import { loginUser as _loginUser, readUser as _readUser } from '../../../lib/auth.js';
   export const login = (data) => Promise.resolve(_loginUser(data));
   export const getMe = () => Promise.resolve(_readUser());
   ```

   The **http** provider (future) will implement the same method names with `fetch(API_BASE + ...)`.

### The flip

```
VITE_API_MODE=mock   ->  services delegate to providers/mock/*  (localStorage, current default)
VITE_API_MODE=http   ->  services delegate to providers/http/*  (Spring Boot REST, future)
```

Because the service module signatures and their Promise contract are identical in both modes,
no page or component needs to change when the flag flips.

### Current status (important nuance)

- **`providers/http/` is empty.** The HTTP seam is scaffolded but no HTTP providers exist yet;
  setting `VITE_API_MODE=http` today throws `[services] No HTTP provider for domain "..."` from
  `config.js`. Writing those providers against the future backend is the migration work.
- **The seam only covers five domains so far:** `property`, `auth`, `deal`, `contact`, `finance`
  (`services/index.js`). Additional mock providers exist (`admin`, `listing`, `saved`, `visit`,
  `content`, `document`) but not every screen routes through a service yet. **Much of the app
  still calls `lib/mockApi.js` and other `lib/*` modules directly** (for example `CityContext`
  reads/writes `puneNestCity` and `pnCityRequests` itself). Broadening the seam to cover every
  data access path is part of the backend cut-over.

### What the backend must preserve

To let the http providers be thin wrappers, the Spring Boot + PostgreSQL backend must preserve
the semantics the mock layer already implements, including:

- **The domain method names and shapes** exposed by each `*Service.js` (the effective client
  contract) - see [`./api-contract.md`](./api-contract.md).
- **Entity identity and field shapes** as seeded in `src/data/db.json` - see
  [`./domain-model.md`](./domain-model.md).
- **Cross-cutting rules** the mock enforces: role-based access, the contact + Aadhaar gate,
  maker-checker finalization (deals), soft-delete/archive + audit log, and a consistent error
  shape - see [`./cross-cutting.md`](./cross-cutting.md).

---

## 5. Data flow

### Request lifecycle (seam'd domain)

```
Component (pages/*, components/*)
   |  import { listProperties } from services/propertyService.js
   v
Service  propertyService.js         // stable public API, returns Promise
   |  provider().listProperties(...)
   v
config.js  createProvider('property')   // picks mock vs http from VITE_API_MODE
   |
   v
Provider  providers/mock/propertyProvider.js   // wraps lib/mockApi.js + lib/data/*
   |  read/write
   v
lib/mockApi/core.js  ->  localStorage[key 'puneNestDB_v5']   // seeded from src/data/db.json
```

Every hop returns a Promise (the mock adds ~120 ms simulated latency in
`lib/mockApi/core.js`'s `delay`), so call sites already look like real API calls. Under the
future http mode the last two hops become one `fetch()` to the REST backend.

### Seeding and persistence of the mock DB

`lib/mockApi/core.js` owns the client-side "database":

- On first import it lazily seeds `localStorage` under key **`puneNestDB_v5`** from the bundled
  `src/data/db.json` (`rawLoad()` reseeds a fresh clone if the key is missing or corrupt).
  (README still cites the older `puneNestDB_v1`; the code has advanced the version key.)
- Several one-time migration side effects also run on import (seed concierge demo listings,
  flatmates data, refreshed FAQs, Move-in Pack config, Home-Loans team), each guarded by its own
  `puneNest_*_v*` marker key so it runs once per browser.
- **Dev-only disk persistence:** `lib/persist.js` mirrors the DB to `data/persist/<key>.json`
  through a small Vite middleware plugin (`vite.config.js` -> `persistPlugin`, endpoints
  `GET/POST /api/__persist/:key`). This lets mock data survive browser-cache clears and be shared
  across browsers during development. It is disabled in production builds and under automated test
  runs (`navigator.webdriver`) for deterministic tests.
- Regenerate all seed JSON with `npm run seed` (`scripts/generate-seed.mjs`, deterministic RNG).
- The in-app `/dev-seed` route resets the mock DB or clears the logged-in user.

Top-level collections in `db.json`: `users`, `listings`, `tickets`, `enquiries`, `visits`,
`deals`, `localities`, `services`, `announcements`, `reviews`, `reports`, `referrals`, `faqs`,
`banners`, `notifications`, `messages`, `plans`, `reels`, `auditLog`, `settings`, `team`,
`shareSeekers`, `shareGroups`, `groupApplications`, `analytics`.

### Auth and session

- The mock session lives in `lib/auth.js`: the current user is stored under the key
  **`puneNestUser`**, in `localStorage` when "remember this device" is on, otherwise in
  `sessionStorage` (tab-scoped). A separate `puneNestUsers` registry lets Sign In recognize a
  returning member.
- Roles: `buyer | owner | admin | staff (+ team) | manager | member`.
- `AuthContext` reads the user once (lazy `useState(() => readUser())`) and exposes
  `login / register / staffLogin / logout / update`, plus derived `isIn`, `role`, `team`.
- Route guards in `RouteGuards.jsx` (`ProtectedRoute`, `RoleRoute`, `TeamRoute`, `ModuleRoute`,
  `FlagRoute`, `AppFlagRoute`) enforce access **for UX only** - they read the same editable
  `localStorage`, so they are not real security. The future backend must enforce auth itself
  (see [`./cross-cutting.md`](./cross-cutting.md)).

### Client state via contexts

Global client state that is not "backend data" is held in React contexts rather than the mock DB:

- **AuthContext** - session/role (details above).
- **CityContext** - active city (`puneNestCity`), the live-city roster (from admin geo settings
  via `lib/geoConfig.js`), and "coming soon" waitlist capture (`pnCityRequests`). It re-pulls the
  geo policy on focus/`storage` events so a city going live in the admin portal reaches shoppers.
- **CompareContext** - a compare tray of up to 4 property ids (`puneNestCompare`).
- **ToastContext** - transient toast notifications (in-memory queue, auto-dismiss).
- **AppFlagsContext / AdminFlagsContext** - feature flags and admin module RBAC used by the
  route guards.

---

## 6. Deployment shape

**Today (frontend-only).** `npm run build` (Vite) produces a static bundle in `dist/`. Because
everything runs in the browser against `localStorage`, the app can be served from any static
host / CDN (for example object storage + CDN, or a static-site host). There is no server-side
runtime and no database in this mode.

```
[ Browser SPA (React, Vite build) ]
        |
        |  localStorage  (seeded from src/data/db.json)
        v
[ In-browser mock "DB": key puneNestDB_v5 ]
   (dev only) mirrored to data/persist/*.json via the Vite dev plugin
```

**Future (three tiers).** Once the http providers are written and `VITE_API_MODE=http`, the same
static SPA points at a real backend:

```
[ Browser SPA ]  --HTTPS/REST-->  [ Spring Boot API ]  --JDBC-->  [ PostgreSQL ]
   static host                     app server (default :8080/api)     managed DB
```

- **Frontend:** unchanged static bundle on a CDN/static host; `VITE_API_BASE` points at the API.
- **Backend:** Spring Boot service implementing the endpoints in
  [`./api-contract.md`](./api-contract.md); owns real authentication/authorization, validation,
  and the cross-cutting rules the mock currently fakes.
- **Database:** PostgreSQL schema derived from [`./domain-model.md`](./domain-model.md).

The SPA is decoupled from the backend by the service seam, so frontend and backend can be
deployed and scaled independently.

---

## 7. Cross-references

- [`./domain-model.md`](./domain-model.md) - canonical entities; source of truth for the
  PostgreSQL schema and the field shapes the providers must return.
- [`./cross-cutting.md`](./cross-cutting.md) - auth/roles, contact + Aadhaar gate, maker-checker,
  soft-delete/audit, pagination, provider seams, and the common error shape.
- [`./api-contract.md`](./api-contract.md) - the REST endpoints the future Spring Boot backend
  must expose so the `providers/http/*` layer can replace the mock without UI changes.
