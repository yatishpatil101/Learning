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
  `playwright.live.config.js`, which already sets `VITE_API_DOMAINS`, proxy, and reads
  `BACKEND_LOG`).
- Flyway runs `db/migration` **+** the e2e baseline seed (a dedicated seed location, so it does not
  leak into `punenest` or `punenest_test`).
- Postgres 13 at `C:\Program Files\PostgreSQL\13\bin\psql.exe` (not on PATH), postgres/postgres.

## Migration checklist

- [ ] `createdb punenest_e2e`; add `E2E_DB_URL`.
- [ ] Define the e2e baseline seed location (idempotent upserts of the fixture registry).
- [ ] Add the `e2e` profile + fixed-OTP affordance; guard it out of dev/prod; keep log-scrape
      fallback.
- [ ] Rewrite `e2e/helpers/auth.js` + `seed.js` from `localStorage` self-seed to create-or-reuse
      real users.
- [ ] Add reset-to-baseline at run start (not teardown).
- [ ] Point the live/default Playwright backend at `punenest_e2e`.
- [ ] Prove: register a user in a spec → restart backend → same user logs in.
- [ ] Keep `punenest_test` empty (re-run Java suite; `TestDatabaseIsolationTest` green).
