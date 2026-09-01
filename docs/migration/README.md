# Migration Plan — Retire the mock, run the whole app on the real API + Postgres

**Status:** Planning (no code yet). Branch: `feature/backend-integration`.
**Owner decision (verbatim):** *"I don't want to keep anything on mockup anymore."*

This folder is the module-wise plan to move the **entire** PuneNest app — the React
frontend **and** the Playwright e2e suite — off the in-browser mock and onto the live
Spring Boot API backed by PostgreSQL, with permanent seed data, real file storage
(Cloudflare R2), and persistent real users in a dedicated test database.

It also moves **business logic out of the browser and into the backend**, keeps the code
minimal (ponytail), cleans up comments, and stands up static analysis.

## The documents

| Doc | What it decides |
|-----|-----------------|
| [01-storage-r2.md](01-storage-r2.md) | How photos and documents get **permanently stored** (Cloudflare R2 — already built, one flag away). |
| [02-seed-and-fixtures.md](02-seed-and-fixtures.md) | The **permanent seed** as a named-fixture contract so the app displays exactly as today (photos, localities, societies). |
| [03-e2e-database-and-users.md](03-e2e-database-and-users.md) | The persistent **`punenest_e2e`** database, **real user management that survives restarts**, OTP handling, and drift control. |
| [04-modules.md](04-modules.md) | The **per-domain migration matrix** — all 22 service domains: live status, what self-seeds, what must be rewritten. |
| [05-logic-to-backend.md](05-logic-to-backend.md) | **Business logic moves to the backend; the UI stays thin.** Full `frontend/src/lib/` inventory classified move / stay / delete. |
| [06-code-quality.md](06-code-quality.md) | **Ponytail discipline, comment hygiene, and Sonar/Checkmarx** — including the fact that neither scanner is configured today. |

## The one insight that sizes this whole effort

Flipping the frontend to the live API is **two lines of `.env.local`** (already proven —
the live e2e config works today). The expensive work is **not** wiring; it is the e2e
suite:

> Mock specs **self-seed `localStorage`** (`puneNestUser`, `puneNestDB_v5`, …) via
> `addInitScript`. The `http` providers **ignore `localStorage`** and call the API. So
> every self-seeding spec asserts against data the backend does not have. **The dominant
> cost of this migration is rewriting self-seeding specs into seed-reliant / create-via-API
> specs**, and growing `R__zz_dev_demo_data.sql` into a documented fixture contract.

Start the effort from the **seed-fixture inventory** ([02](02-seed-and-fixtures.md)) — it
sizes everything downstream.

## Principles

1. **Nothing stays on mock as a runtime driver.** The mock providers (`services/providers/mock/*`)
   and the computational stand-ins in `frontend/src/lib/*` (`qualityScore`, `rentPay`, `featured`,
   `freshness`, …) are deleted **only after** the live e2e suite is green — not before. Until then
   they remain the safety net.
2. **The API contract is law.** `backend/src/main/resources/static/openapi/punenest-api.yaml`
   (126 paths / 160 operations) is the source of truth. Mappers conform to it; we do not bend
   the contract to match the mock.
3. **Permanent means seeded and idempotent.** Every fixture the UI displays today must be
   reproducible from a migration/seed file (Flyway repeatable), so a fresh DB looks identical.
4. **Three databases, three jobs** (see [03](03-e2e-database-and-users.md)). Do not blur them.
5. **Storage has a public/private split at the vendor.** Photos → public bucket (permanent CDN
   URL). Documents/KYC → private bucket (short-lived signed GET). This boundary is already
   enforced in code; keep it.
6. **The server decides; the client renders.** If the UI computes a business answer, that
   computation belongs in a service and the answer belongs in the DTO. No component re-derives a
   value the API already returns ([05](05-logic-to-backend.md)).
7. **Delete before you write** (ponytail). Before porting any `lib/*` calculation into Java, check
   whether the API already returns it — usually the correct migration is `git rm`, not a port. No
   new abstraction with one implementation; no new dependency without naming what it replaces
   ([06](06-code-quality.md)).

## The three-database model

| DB | Job | Seed | Isolation | Persists across restart |
|----|-----|------|-----------|-------------------------|
| `punenest` | Local dev driver | Full demo seed (`R__zz_dev_demo_data.sql`) | none | yes |
| `punenest_test` | Java unit/integration suite | **schema only** (guarded by `TestDatabaseIsolationTest`) | `@Transactional` rollback per test | no (rolled back) |
| **`punenest_e2e`** (new) | Playwright browser suite | Named-fixture baseline seed | **no rollback** — reset-to-baseline at run **start** | **yes** (this is the requirement) |

`punenest_test` **must stay empty** — 126 exact-count assertions depend on it. The persistent
real users the owner wants live in the **new** `punenest_e2e`, never in `punenest_test`.

## Phased sequencing

Each phase ends green before the next starts. UI instability on this branch is accepted.

- **Phase 0 — Local integration (cheap, reversible).** Commit a `frontend/.env.local`
  (`VITE_API_DOMAINS=*`, `VITE_PROXY_TARGET=http://localhost:8080`) and a `dev:live` npm script /
  VS Code task. Frontend now runs fully on the live API for manual dev. Mock still available by
  toggle. **No spec changes yet.**
- **Phase 1 — Seed becomes a fixture contract.** Inventory what today's UI shows; promote the
  demo seed into stable named actors with documented invariants ([02](02-seed-and-fixtures.md)).
  Keep photos as external URLs for now (they already display for free).
- **Phase 2 — Storage flip — DONE 2026-08-13.** The six `R2Properties` come from `R2_*` in a
  git-ignored `backend/.env.local`; `application.properties` already bound them, so nothing
  committed changed and `STORAGE_ENABLED` stays `false` by default ([01](01-storage-r2.md)).
  Proven with `STORAGE_ENABLED=true` against the real sandbox: `R2FileStorageLiveTest` (2),
  `MePhotosLiveTest` (public half, whole server chain), and a new `MePersonalDocumentsLiveTest`
  (private half — KYC file lands in the private bucket under an owner-scoped key, the signed GET
  returns the bytes, the unsigned URL is refused). All three frontend-side risks the plan listed
  turned out to need no code change; see the Risks section there. Dev without keys still works via
  the existing local `DevObjectStore`.
- **Phase 3 — `punenest_e2e` + persistent users.** Stand up the third DB, its baseline seed, the
  reset-at-start hook, and the e2e OTP affordance ([03](03-e2e-database-and-users.md)).
- **Phase 3.5 — ~~Authorisation logic to the server~~ — CLOSED 2026-08-13, no work needed.**
  Audited before writing any Java, per [05](05-logic-to-backend.md)'s own first checklist item.
  Both are **already enforced server-side**: `BackOfficePermissions` guards every route with two
  independent fences and may only narrow a role baseline, and the http contact provider owns the
  gate entirely. `lib/permissions.js` speaks a vocabulary migration V61 **deleted**, so it fails
  *closed*; `lib/contact.js`'s gate functions are imported only by the mock provider and retire by
  `git rm` in Phase 4. Not a security finding. See
  [05 § Audit result](05-logic-to-backend.md#audit-result--neither-needs-a-port-both-are-already-enforced-server-side)
  and open decision 3 below for the one real item it surfaced.
- **Phase 4 — Per-domain pass: provider + logic + specs + comments — DONE 2026-08-13.** All 22 rows
  in [04-modules.md](04-modules.md) are ✅; `VITE_API_DOMAINS` in `playwright.live.config.js` names
  every one. The last three were `team`, `fees` and `photo`; converting `photo` meant converting
  `/staff-login`, the only screen still authenticating against `lib/mockApi.js`, to the live
  `/auth/login` mobile-OTP flow — role and team now come from the server, and the demo quick-access
  block survives only behind `{!authIsLive && …}` until Phase 5 removes it. New live evidence:
  `live-fees-and-photos.spec.js` (published fee + GST, the estimate wording the NULL statutory pair
  demands, and a photo whose URL the server minted rather than a `FileReader`) and
  `live-drafting-desk.spec.js`, un-`fixme`d and green. Two things the plan did not predict, both
  recorded where they bite: the drafting-desk fixture had to move to the free `valuation` desk
  because `rent-agreement` is the one priced type and never leaves `awaiting-payment` without a
  payment webhook, so the rental queue is unreachable from e2e by design; and the photo test does
  not fetch its bytes back, because `MockFileStorage.storePublic` deliberately mints them on a host
  that does not resolve — that claim is `R2FileStorageLiveTest`'s. Walk order for each domain was:
  1. Convert self-seeding specs to seed-reliant / create-via-API; keep `e2e/COVERAGE.md` in step.
  2. Move that domain's business logic server-side; add the field to the DTO + OpenAPI; delete the
     `lib/*` file ([05](05-logic-to-backend.md)).
  3. Apply the ponytail ladder — prefer deleting the client calculation over porting it.
  4. Review the comments in every file touched; a comment that is now false is a defect
     ([06](06-code-quality.md)).
- **Phase 5 — Make live the default; retire the mock; harden.** Point the default
  `playwright.config.js` at the live backend (retire the "must pass with no backend" invariant).
  Delete `services/providers/mock/*`, `lib/mockApi*`, `data/db.json`, and the remaining
  computational `lib/*` stand-ins. Remove the Vite `persistPlugin` mock-persistence route. **Then**
  stand up static analysis — scanning before the mock is deleted just produces findings on code
  that is about to disappear ([06](06-code-quality.md)).

  **Measured 2026-08-13, and it changes the shape of this phase.** The one-liner above assumes
  deleting the mock retires scaffolding. It does not — it invalidates tests. The legacy suite
  (`playwright.config.js`) is **220 files / 1,541 tests**, of which **164 files seed their fixtures
  through `localStorage` / `addInitScript`**, which becomes a no-op the moment the mock provider is
  gone. The live suite is 5 files / 48 tests. So "delete the mock and repoint the config" is a
  1,541-test coverage cliff, not a cleanup.

  **Chosen strategy: convert in waves, delete last.** The mock stays alive and unchanged while
  legacy specs move onto the live suite folder by folder — `platform` → `consumer` → `admin` + `ops`
  → `mobile` — and a mock provider is deleted only once nothing imports it. Slower, and the mock
  lives a while longer, but no window exists in which coverage is knowingly down. The rejected
  alternatives are worth recording: flipping now and `fixme`-ing the fallout trades real coverage
  for calendar time, and reclassifying the mock as a permanent test double is ponytail-optimal but
  contradicts the definition of done below.

  **The blocker is not the provider folder.** 58 files import `lib/mockApi.js` *directly*, bypassing
  the `services/*` seam entirely (22 admin, 18 consumer, 4 components, 3 ops, 3 context, 1 root, plus
  8 mock providers which legitimately do). Those direct imports are what actually pin `db.json` in
  place, and each one is invisible to `VITE_API_DOMAINS` — there is no switch to look at, so a screen
  reading mock data in live mode says nothing about it. Seaming them is the bulk of the work.

  Two Phase-5 items listed here previously as defects were **verified already correct** on
  2026-08-13 and need no code: `providers/http/feesProvider.js` preserves the deliberately-NULL
  statutory pair rather than coercing it to `0`, and `useRentAgreement.js` answers a NULL by deriving
  locally and listing the field in `cost.computed`. That `computed` array is load-bearing — it is why
  the sidebar says "estimated total" instead of quoting a figure as the price, and it is what
  `live-fees-and-photos.spec.js` asserts on.

  **Follow-up raised by the `settings` seam: three consumer kill switches now write to one place and
  read from another.** `AdminSettings` PUTs `flags` and `geo` to the API, but the consumers of those
  same keys still read `rawDb()` — `ConsumerLayout.jsx:37` (`flags.maintenanceMode`, "block all
  consumer access"), `AppFlagsContext.jsx:7` (`flags`, including `signupsEnabled`) and
  `geoConfig.js:72` (the Places blacklist and city limit). The http provider raises
  `punenest-settings-change` and those listeners dutifully re-read localStorage, where nothing has
  changed. This is **not** a regression in real enforcement — the controls were always browser-local,
  so they never protected anyone but the operator's own tab — but it does mean an abuse-response
  switch now reports success and does nothing at all. `AppFlagsContext` is the next consumer to move
  onto `settingsService.js`, and it should move before anyone relies on maintenance mode.

## Definition of done

- [ ] `frontend` runs against the live API with **no** mock provider reachable.
- [ ] Default Playwright config drives the **live** backend; suite is green.
- [ ] Every listing photo, locality, and society the UI showed on mock is reproduced from seed.
- [ ] User-uploaded photos land in the R2 public bucket; documents/KYC in the private bucket.
- [ ] A user registered in e2e is still logged-in-able after a backend restart.
- [ ] `services/providers/mock/*`, `lib/mockApi*`, `data/db.json` and the `lib/*` computational
      stand-ins are deleted.
- [ ] No business rule, score, money calculation, or authorisation check is computed in the browser.
- [ ] Bundle size measured before/after the `lib/` deletions; headroom recorded.
- [ ] Comments in every migrated file are still true; stale mock-era narration removed.
- [ ] Backend `mvnw test` runs in CI (it does not today).
- [ ] Sonar wired and findings triaged by severity; Checkmarx-vs-CodeQL decision recorded.
- [ ] `docs/coverage-matrix.md` / `e2e/COVERAGE.md` reflect the live suite.

## Open decisions

1. **Checkmarx or CodeQL?** Neither Sonar nor Checkmarx is configured in this repo today, and CI has
   no backend job at all. Checkmarx is commercial — wire it only if your organisation licenses it;
   otherwise GitHub CodeQL is the free native equivalent. See [06](06-code-quality.md).
2. **Caching.** There is **no caching layer** (no `@EnableCaching`/`@Cacheable`/Redis/Caffeine).
   Moving heavy lifting server-side ([05](05-logic-to-backend.md)) puts every one of those
   computations on an uncached Postgres. Per D133, **measure the real call count first** — no cache
   until a profiler asks for one.
3. **How should the admin console bind to the permission catalogue?** *(raised 2026-08-13 by the
   [05](05-logic-to-backend.md) pre-port audit, which found no port was needed.)* The server owns a
   16-atom `module:action` model with per-account documents that may only narrow a role baseline,
   and serves it at `GET /admin/permission-catalogue`. The console instead computes navigation from
   `lib/permissions.js` using `customRoles`/`roleId`/`moduleAccess` — a vocabulary migration V61
   deleted and `PUT /admin/settings` now refuses with 422. It fails *closed*, so nothing is exposed;
   the console simply cannot express the real model, and `AdminFlagsContext` reads it from
   `lib/mockApi.js` in live mode.

   Not started — rewiring the console's access model is architectural. The options are (a) render
   the grid from the catalogue and drive nav from the caller's resolved atoms, deleting
   `lib/permissions.js` and the module-key vocabulary with it; (b) keep the module keys as a purely
   cosmetic nav grouping and map them onto atoms in one adapter; (c) defer until the `team` domain
   flips to http in [04](04-modules.md), which is when `AdminFlagsContext`'s seam violation has to
   be fixed anyway. **(c) is the cheapest and is the recommendation** — the seam fix forces the
   question, and doing it then avoids touching the console twice.

   **Update 2026-08-13 — the seam half is done; the binding half is still open.** `team` flipped in
   Phase 4, so (c) came due. `AdminFlagsContext` and `AdminSettings.jsx` now read and write through
   a new `services/settingsService.js` (`GET`/`PUT /admin/settings`, `settings` added to
   `VITE_API_DOMAINS`), so the admin console no longer reads its flags, fee schedule and geo policy
   out of `db.json` in live mode. The http provider answers `getCustomRoles()` with `[]`, because
   V61 deleted the key and there is nothing to fetch.

   That makes the **consequence** of the unresolved binding concrete rather than theoretical: live,
   a back-office account that is not an `admin` now resolves to role plus the always-on base modules
   only. It fails closed — no tab is exposed that should not be — but a scoped account sees less
   than it should, and no amount of provider work can fix that, because the console is asking a
   question (`can this user open the "enquiries" module?`) the server has no answer to. Choosing
   between (a) and (b) is still required, and it is now the only thing standing between the console
   and the server's real access model.
