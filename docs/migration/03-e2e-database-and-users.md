# 03 — E2E database & real user management

**Owner requirement (verbatim):** *"we should have real user management in test DB. once the user
is created it should be reused in new session/after restart also. if needed we can have separate
schema for e2e suite."*

**Answer:** yes — a **separate, persistent `punenest_e2e` database** (not a schema inside the Java
test DB). The Java suite's DB and the browser suite's DB have opposite isolation needs and must not
share.

## Why the e2e DB must be separate from `punenest_test`

| | `punenest_test` (Java suite) | `punenest_e2e` (Playwright) |
|-|------------------------------|-----------------------------|
| Isolation | `@Transactional` — **every row rolls back** after each test (`AbstractApiTest`) | **No rollback** — rows commit and persist |
| Seed | **Schema only** — must be empty (`TestDatabaseIsolationTest` asserts `properties == 0`) | Named-fixture baseline seed |
| Users survive restart? | **No** (rolled back) | **Yes** — this is the requirement |
| Count assertions | 126 exact global counts depend on emptiness | Assert against fixture invariants, not global counts |

Putting persistent users in `punenest_test` would immediately break the Java suite. They belong in
a database that is *designed* to keep committed rows — the new `punenest_e2e`.

> **Schema vs database:** a separate *schema* inside the same DB would work technically, but a
> separate *database* is cleaner — independent Flyway history, independent connection string, no
> risk of the Java suite's "must be empty" guard tripping over e2e rows. Recommend a **separate
> database**.

## How persistent users work end-to-end

The dev/e2e Postgres is a real, on-disk database — committed rows already survive process restarts.
So "user reused after restart" is automatic **once e2e stops self-seeding `localStorage` and starts
creating/reusing real DB users**.

The e2e auth helper changes from *inventing* a `localStorage` user to a **create-or-reuse** flow:

1. Attempt login (request OTP → verify) for the fixture mobile.
2. If the user does not exist, register it, then log in.
3. Cache nothing in `localStorage`; the session is a real JWT from `/auth/...`.

Because the fixture users are also in the **baseline seed**, step 2 is rarely hit — they exist from
the first `flyway migrate`. Runtime-registered users (from registration specs) simply accumulate and
persist, exactly as asked.

## The OTP problem (and the fix)

Login requires OTP. In dev, `MockOtpSender` logs `[MOCK OTP] mobile=… code=…` to the console; the
code is SHA-256 hashed in `otp_codes` (unreadable from the DB). The existing `live-*` specs read the
code from `BACKEND_LOG`. That works but is brittle for a broad suite.

**Recommended e2e affordance:** a deterministic OTP under an `e2e` profile (or a
`punenest.otp.e2e-fixed-code` property) so `MockOtpSender` accepts a fixed code (e.g. `000000`) for
**e2e only**. This keeps OTP real in shape but removes log-scraping from every login. Guard it hard:

- Active **only** under the `e2e` profile / property — never `dev`, never prod.
- Still writes/reads through `otp_codes` so the flow is genuine.
- Keep the log-scrape path as the fallback for any spec that must exercise real OTP issuance.

Confirm the exact `OtpService` hooks before implementing (60s cooldown, MAX_SENDS_PER_WINDOW=5/hr
still apply — the fixed code changes verification, not rate limiting).

## Drift control — the hard part of a persistent, mutating DB

A persistent DB + mutating specs = rows accumulate → any spec asserting a **global** count breaks
over time. The owner also wants created users to **persist**, so we cannot blanket-wipe. Reconcile
with three rules:

1. **Reset the baseline to a known state at run START, not teardown.** At the start of a full run,
   re-apply the idempotent baseline seed (upserts) so the named fixtures are exactly as documented.
   This repairs anything a previous run mutated **without** deleting independently-registered users.
2. **Specs assert against fixture invariants, never global counts.** "Meera owns 4 listings" (scoped
   to Meera), not "there are N listings total." Scoped assertions are drift-proof.
3. **Mutating specs create their own uniquely-named data** (unique mobile/slug per run) and assert
   on *that*, so parallel/repeat runs never collide. `punenest_e2e` runs `workers:1` today, which
   also helps.

For a **hard reset** when needed (schema/seed change), drop+recreate `punenest_e2e` and re-migrate —
cheap, and the only time persistent users are intentionally cleared.

## Wiring

- New connection string (e.g. `E2E_DB_URL=jdbc:postgresql://localhost:5432/punenest_e2e`).
- The Playwright live config boots the backend against `punenest_e2e` (extend
  `playwright.config.js`, which already sets `VITE_API_DOMAINS`, proxy, and reads
  `BACKEND_LOG`).
- Flyway runs `db/migration` **+** the e2e baseline seed (a dedicated seed location, so it does not
  leak into `punenest` or `punenest_test`).
- Postgres 13 at `C:\Program Files\PostgreSQL\13\bin\psql.exe` (not on PATH), postgres/postgres.

## Migration checklist

- [x] `createdb punenest_e2e`; add `E2E_DB_URL`.
- [x] Define the e2e baseline seed location (idempotent upserts of the fixture registry).
- [x] Add the `e2e` profile + fixed-OTP affordance; guard it out of dev/prod; keep log-scrape
      fallback.
- [x] ~~Rewrite~~ **Bypass** `e2e/helpers/auth.js` + `seed.js` — see the deviation below.
- [x] Add reset-to-baseline at run start (not teardown).
- [x] Point the live/default Playwright backend at `punenest_e2e`.
- [x] Prove: register a user in a spec → restart backend → same user logs in.
- [x] Keep `punenest_test` empty (re-run Java suite; `TestDatabaseIsolationTest` green) — **and it
  was not.** The re-run passed 1483/0/0, but a direct count found the database holding four `users`
  rows and 12,267 `audit_log` rows, both from writes that commit in their own `REQUIRES_NEW`
  transaction and therefore outlive the class-level `@Transactional` rollback. The `users` half is
  **closed at source**: `AuthEndpointsTest` now clears the buyers that `UserService.provisionBuyer`
  auto-creates, in a static `@AfterAll` — the only per-class position that works, because a
  committing delete in `@AfterEach` runs on a second connection and blocks forever on the row locks
  the still-open test transaction holds. The `audit_log` half is **truncated by hand and carried as
  D217**: it needs one suite-wide sweep, not per-class teardowns, and three existing `@AfterEach`
  cleanups for it are silent no-ops for the reason just given. Post-fix state: `users` empty,
  `audit_log` empty, only reference data (348 societies, 155 localities, 4 settings) remains — which
  is what `TestDatabaseIsolationTest` asserts.

## What was actually built, and where it departs from the plan above

**The seed location is `db/seed`, which already existed.** The plan says "a dedicated seed location,
so it does not leak into `punenest` or `punenest_test`" — that location was already there and
already had exactly that property. `spring.flyway.locations` lists `db/migration` everywhere and
appends `classpath:db/seed` only under `dev` and `e2e`, so `punenest_test` never sees the fixtures.
A second location would have meant two seeds to keep in step for no gain, and the e2e suite asserting
against fixtures the dev database does not have.

**`helpers/auth.js` and `helpers/seed.js` were not rewritten — a new `helpers/liveAuth.js` was added
alongside them.** The plan assumed the live specs went through those helpers. They do not: each live
spec carried its *own* private OTP log-scraping login, and the two shared helpers are used only by
the mock suite, which must keep passing with **no backend running at all** (that is how the UI is
developed and demoed). Rewriting them to talk to a live API would have broken the mock suite to fix
a file the live specs never called. So the change is additive, and the two mock helpers retire on
their own schedule with the mock provider in Phase 5.

**The fixed OTP has three independent guards, not one.** The plan said "guard it hard"; concretely
that is (1) `punenest.otp.fixed-code` defaults to empty, so absent configuration means no affordance
rather than a default code, (2) `application-prod.properties` pins it empty explicitly so a stray
environment variable cannot supply one, and (3) `@PostConstruct rejectFixedCodeInProduction()`
refuses to start the context if a non-empty code survives into a production profile. Any single guard
could be defeated by a configuration mistake; the third makes the mistake loud at boot instead of
silent at runtime. Issuance, hashing and `otp_codes` are untouched — only the comparison changes, so
the flow stays genuine as the plan required.

**Reset is `TRUNCATE`-discovers-its-own-tables, not a Flyway replay or a template database.** Flyway
cannot re-run a seed whose checksum has not changed, and a Postgres template DB needs `DROP DATABASE`,
which fails while any connection is open — meaning a backend restart on every run. So
`e2e/scripts/reset-e2e-db.sql` reads `pg_tables` and truncates everything except
`flyway_schema_history` in one `RESTART IDENTITY CASCADE` statement, and the three seeds re-apply in
Flyway order. The table list is discovered rather than written down because a hand-written list goes
stale silently — a new table simply never gets cleared, and the drift it causes surfaces somewhere
unrelated weeks later.

**Reset runs at start, and that is load-bearing.** A teardown only runs if the run *reaches* it, so
a crash leaves the database dirty for the next run — and in the one case where you most want the
evidence, a teardown is also what destroys it.

### Proof recorded

- Reset is idempotent: two consecutive runs both settle at `81 users` / `38 properties`, and a stray
  row written by the previous run was confirmed gone. Observed:
  `[live] punenest_e2e reset to baseline in 5040ms (81 users).`
- Persistence across restart: `9700009911` registered as
  `a768c4d0-2819-4217-b7e0-b6fedfec499e`, JVM killed and restarted, same id returned. This is the
  owner requirement, proven directly.
- OTP honesty, four steps: replay → 401 *"No active OTP"*; fresh request → 200 `otpSent`; wrong code
  → 401 *"Incorrect OTP"*; fixed code → 200 authenticated. The affordance changes which code is
  accepted, not whether verification happens.
- `live-society-rating.spec.js` — 2 passed, exit 0. End-to-end proof of reset + fixed OTP + helper +
  config together.
- `live-user-restore-email-collision.spec.js` — 3 passed.

### Left red on purpose

`tests/ops/live-drafting-desk.spec.js` is `test.describe.fixme`. Its six tests are correct and its
customer half is proven over HTTP; what blocks them is that **`/staff-login` has never been converted
to the live API** — `StaffLogin.jsx` still builds a user out of `lib/mockApi.js` and hands it to a
provider that wants `{ email, password }`. That is `04-modules.md`'s `team` domain, which already
lists itself as not in the toggle. `fixme` rather than `skip` so the runner reports them as
known-broken instead of quietly passing.

`D216` records a defect this phase surfaced but did not cause: `archive()` never moves the `status`
column and `UserResponse` carries no `archived` field, so the API reports an archived user as
`active`. The spec now asserts through `GET /users?archived=true` instead — it was previously
asserting on the bug.
