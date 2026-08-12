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
- **Phase 2 — Storage flip.** Provision an R2 sandbox; set the six `R2Properties` + flip
  `punenest.providers.storage.enabled=true` in a git-ignored `backend/.env.local`
  ([01](01-storage-r2.md)). User-uploaded photos/docs now persist for real; dev without keys still
  works via the existing local `DevObjectStore`.
- **Phase 3 — `punenest_e2e` + persistent users.** Stand up the third DB, its baseline seed, the
  reset-at-start hook, and the e2e OTP affordance ([03](03-e2e-database-and-users.md)).
- **Phase 3.5 — Authorisation logic to the server (small, urgent).** `lib/permissions.js` and
  `lib/contact.js` are authorisation decisions currently computed in the browser. That is a
  security finding, not a tidy-up — it jumps the per-domain queue
  ([05](05-logic-to-backend.md)).
- **Phase 4 — Per-domain pass: provider + logic + specs + comments.** Walk
  [04-modules.md](04-modules.md) domain by domain. Each domain pass does **four things in one
  change**, because the file is already open:
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
