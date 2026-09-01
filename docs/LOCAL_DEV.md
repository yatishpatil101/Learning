# Running PuneNest locally (frontend + backend + Postgres)

How to run the full stack on one machine, and how to flip individual domains from mock data to the
real API. **Mock mode is the default and always works with no backend running** — that is how the UI
is developed and demoed.

---

## 1. Postgres

Two databases, and they must stay separate:

| Database | Used by | Contents |
|---|---|---|
| `punenest` | local dev / running the app | Flyway schema **+ demo data**, both built by Flyway |
| `punenest_test` | `mvn verify` | Flyway schema only, **kept empty of demo data** |

The test suite asserts exact row counts against a schema Flyway built from empty. Pointing dev at
`punenest_test` seeds it and breaks the suite with confusing `expected 2, got 18` failures.

```powershell
$env:PGPASSWORD = 'postgres'
$psql = 'C:\Program Files\PostgreSQL\13\bin\psql.exe'
& $psql -U postgres -h localhost -d postgres -c "CREATE DATABASE punenest;"
& $psql -U postgres -h localhost -d postgres -c "CREATE DATABASE punenest_test;"
```

Both are built entirely by Flyway on first boot. **The dev database is now reproducible**: boot the
backend against an empty `punenest` and you get the schema *and* the 38-listing demo catalogue. That
was not true before 2026-08-04 — the demo data existed only inside one database and no script could
regenerate it (tech-debt D81, now closed).

### How the schema changes: Flyway only, forward only

The rules, in the order they bite:

1. **Never edit a migration that has been applied anywhere.** Flyway records a checksum per file. A
   one-character edit to an applied `V__` script means every existing database refuses to boot with
   `Migration checksum mismatch`. This is not theoretical — it is exactly what happened on
   2026-08-04, and repairing it was impossible because the database was also twenty versions behind.
2. **New change → new script.** `V31__…`, `V32__…`. Never renumber, never reuse.
3. **Never truncate or drop the schema to get out of trouble.** If a migration is wrong, write the
   next one that corrects it.
4. **`R__` (repeatable) is for content, not structure** — the two seeds. They re-run whenever their
   checksum changes and always after every `V__`, which is what makes editing the demo catalogue a
   one-file change rather than a new migration.

Pre-launch, the version history is allowed to be untidy: nothing is deployed, so **the whole `V1..Vn`
chain can be flattened into one clean `V1__baseline.sql` later**, once the schema settles. Two things
have to be true when that happens — every environment is rebuilt from empty (there is no history to
preserve), and it is done as a deliberate reset rather than an edit-in-place, which is rule 1 again.

Two build-time guards, because both mistakes above are invisible in review:

- `MigrationChainTest` fails if two migrations create the same table (which makes the chain
  un-replayable from empty) or claim the same version number.
- `TestDatabaseIsolationTest` fails if the demo seed ever reaches the test database.

### Where the demo data lives

`backend/src/main/resources/db/seed/R__zz_dev_demo_data.sql` — 38 listings, 78 users, plus the
conversations, visits and contact requests that make the local app look like a product. Read its
header before changing it; it records three traps that cost real time (seed ordering, `ON CONFLICT`
scope, and one row that violated a constraint added after the data was created).

It is wired in `application-dev.properties` as `spring.flyway.locations=classpath:db/migration,classpath:db/seed`,
so **naming the `dev` profile is what asks for it**. It used to sit in the base file and be excluded
in two places; that made it a denylist, and any deploy not called `prod` — `staging`, `preview`, or
one that named no profile — would have loaded 78 fabricated users and 38 fabricated listings into a
live catalogue. The one remaining exclusion is still load-bearing:

| File | Why |
|---|---|
| `src/test/resources/application-dev.properties` | the test run activates the `dev` profile, and a profile-specific file outranks a plain one *from either source set* — so overriding this in the test's plain `application.properties` alone does not work. That was tried, and the suite died in Flyway before the first test |

To add a listing to the demo set: edit the seed, then recreate the dev database (below). The seed is
`ON CONFLICT DO NOTHING`, so it inserts what is missing and never updates what is there.

### Rebuilding the dev database

Safe to do at any time, and now lossless:

```powershell
# Optional but free: keep the old one until you are happy.
& $psql -U postgres -h localhost -d postgres -c "ALTER DATABASE punenest RENAME TO punenest_old;"
& $psql -U postgres -h localhost -d postgres -c "CREATE DATABASE punenest;"
cd backend; .\mvnw.cmd -o spring-boot:run -Dspring-boot.run.profiles=dev    # Flyway rebuilds schema + demo data
```

If you have added data locally that you care about, dump it first — it is not in the seed:

```powershell
& "C:\Program Files\PostgreSQL\13\bin\pg_dump.exe" -U postgres -h localhost -d punenest `
    --data-only --column-inserts -f "$env:USERPROFILE\punenest-backup.sql"
```

For the fixture ids and sample data, see [`docs/system/fixture-registry.md`](system/fixture-registry.md).
(This used to point at `backend/LOCAL_DB_STATUS.md`. That file is gitignored, so it only ever existed
on one machine; on every other checkout it was an empty stub pointing nowhere, which is how it was
found — the source-tree hygiene guard flagged it. The registry is tracked, so it cannot rot the same way.)

### How the test suite uses the database

Worth stating plainly, because the answer is not the usual one:

- **The database is long-lived, not created per run.** `punenest_test` is created once by hand.
  `mvn verify` connects to it, lets Flyway bring the schema up to date, and Hibernate validates the
  entity mapping against it (`ddl-auto=validate`) — so a green boot is itself a check that entities
  and migrations still agree.
- **Isolation comes from transaction rollback, not from a fresh database.** `AbstractApiTest` is
  `@Transactional`, so every test's writes are rolled back when it ends. That is why 733 tests can
  share one database and still assert exact row counts.
- **The standing exception is audit rows.** `AuditService` writes `REQUIRES_NEW`, which commits
  regardless of the caller's rollback — deliberately, since an audit trail that vanishes when a
  transaction fails is not an audit trail. A test that triggers one has to clean `audit_log` itself
  in an `@AfterEach`.
- **There is no Testcontainers.** Docker is unavailable in this environment (org sign-in
  enforcement), so tests run against the real local Postgres. The cost is that the suite needs
  infrastructure to be up; the benefit is that it runs against the actual engine, so `CHECK`
  constraints, `ON CONFLICT` and native queries are genuinely exercised rather than approximated.
- **Nothing verifies the chain replays from empty.** The suite only ever migrates *forward* from
  whatever `punenest_test` already contains, so a migration that cannot build a database from
  scratch stays green indefinitely — which is exactly how the duplicate `society_leads` in V7/V24
  survived. To check it, point the backend at a throwaway:

  ```powershell
  & $psql -U postgres -h localhost -d postgres -c "CREATE DATABASE punenest_replay;"
  $env:DB_URL = 'jdbc:postgresql://localhost:5432/punenest_replay'
  cd backend; .\mvnw.cmd -o spring-boot:run -Dspring-boot.run.profiles=dev     # look for "Successfully applied N migrations"
  ```

  Verified on 2026-08-04: all 31 migrations replay cleanly into an empty database.

## 2. Backend

### One-time setup: `PUNENEST_DEV_MACHINE`

Do this once per machine, before the first run:

```powershell
[Environment]::SetEnvironmentVariable('PUNENEST_DEV_MACHINE', '1', 'User')
```

Then **open a new terminal** — and restart VS Code, so the `backend: spring boot` task inherits it.

If you skip it, the backend refuses to start, and says so:

```
The 'dev' profile is active but the PUNENEST_DEV_MACHINE environment variable is not set,
so nothing here proves this JVM is a developer's machine.
  On a developer machine: set PUNENEST_DEV_MACHINE=1 once in your user environment and start
  again — docs/LOCAL_DEV.md has the exact command. Nothing in the repository sets it for you:
  not run-local.ps1, not the VS Code task, not .env.local, because a control that a committed
  file can satisfy is not a control.
  On a server this failure is the control working, and setting the variable is the wrong fix: ...
```

**Why a variable and not a line in a file.** The `dev` profile turns on three things that are
holes anywhere real: an OTP sender that prints the code to the log, a file store that writes KYC
documents to local disk, and `POST /me/verification/aadhaar/simulate`, which hands the caller the
Verified badge that owners use to decide who may contact them. Everything that gated them was a
string in a file — and files are the thing deployments copy. A container that terminates its own
TLS (so it configures no proxy) and picks up `SPRING_PROFILES_ACTIVE=dev` from an environment file
someone copied off a laptop was, until 2026-08-09, indistinguishable from a developer's machine as
far as the code could tell. It booted green with all three live.

So the second signal is deliberately one that a file cannot carry. It is in no committed file, and
`run-local.ps1` actively refuses to read it out of `.env.local` even though that file is
git-ignored; a git-ignored file is still a file, and `.env` is the single most-copied artefact in a
deployment. The backend reads it with `System.getenv` rather than through Spring's `Environment`,
because Spring's relaxed binding would resolve `PUNENEST_DEV_MACHINE` from a `punenest.dev-machine`
entry in `application-dev.properties` — which would put the whole thing straight back inside the
repository. The one action left is a human typing it on the machine it describes, which is exactly
the action a mis-provisioned deploy cannot perform by accident.

The old check is still there as a second, independent tripwire: `dev` alongside `prod`, or `dev`
with a load balancer configured in `punenest.security.trusted-proxies`, still kills the boot. It
catches the opposite mistake — someone who *has* exported the variable and then ships an image
built from their shell profile.

`mvn verify` is exempt, and does not need the variable. The suite activates `dev` for all ~880 of
its tests (that is what wires the keyless providers they assert against), and the exemption keys on
`spring-boot-test` being on the classpath — a `test`-scoped dependency that is not in the packaged
application and that no file, flag or variable can switch on. The alternative was committing the
value somewhere for CI, which is the hole again.

### Running it

```powershell
$env:JAVA_HOME = 'C:\Program Files\Zulu\zulu-25'
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
cd backend
mvn spring-boot:run -Dspring-boot.run.profiles=dev
```

Or `.\run-local.ps1`, which pins the JDK, loads `.env.local`, and checks the variable above before
Maven spends a minute compiling.

**The `dev` profile is not optional.** The mock OTP sender and the local-disk file store are opted
into by `dev` rather than merely excluded from `prod` (D147), so a bare `mvn spring-boot:run` boots
with their production counterparts — which exist only to throw. The app starts and looks healthy;
you then cannot complete an OTP login or upload a document, and the failure reads as a 500 from the
endpoint rather than as a missing profile.

Serves `http://localhost:8080`. Defaults (all env-overridable via `DB_URL` / `DB_USER` /
`DB_PASSWORD` / `JWT_SECRET`) live in `src/main/resources/application.properties`. The `prod` profile
re-declares them as bare `${ENV}` lookups, so a missing secret fails the boot instead of silently
falling back to a well-known local value. It adds one more, `INTERNAL_PROXIES`, which must be a Java
regex matching the load balancer's addresses — the write rate limiter keys anonymous callers on the
client address, so a deploy that leaves this unanswered would put the whole internet in one bucket.
Locally the base file answers `none`, which is correct for a directly exposed app; the boot refuses
to start rather than guess.

Confirm Flyway actually ran — a healthy boot logs:

```
o.f.core.internal.command.DbValidate : Successfully validated 10 migrations
c.punenest.api.PunenestApiApplication : Started PunenestApiApplication
```

If Flyway logs *nothing at all*, the `spring-boot-flyway` autoconfiguration module is missing from
`pom.xml`. Under Spring Boot 4, `flyway-core` alone is not enough.

### Getting an OTP in dev

Login is passwordless mobile + OTP. The dev `OtpSender` is a mock that prints the code to the backend
console rather than sending an SMS:

```
c.punenest.api.provider.MockOtpSender : [MOCK OTP] mobile=9876500001 code=993399
```

## 3. Frontend

```powershell
cd frontend
npm install
npm run dev          # http://localhost:5173
```

By default **every domain uses mock providers** — no backend required.

### Pointing a domain at the real API

Integration is incremental, so the switch is **per domain**, not global:

```powershell
$env:VITE_API_DOMAINS = 'auth'          # auth is live, everything else stays on mocks
npm run dev
```

| Value | Effect |
|---|---|
| *(unset)* | All mocks — the default |
| `auth` | Only the auth domain talks to the real API |
| `auth,property` | Two domains live |
| `*` | Every domain that has an http provider goes live |

A domain opted in without a matching `providers/http/<domain>Provider.js` logs a warning and falls
back to its mock — it never takes the app down over a typo.

**Keep `VITE_API_BASE` as the relative `/api`.** The Vite dev proxy forwards it to
`localhost:8080` **without rewriting the path** — the backend genuinely serves under
`server.servlet.context-path=/api` — so requests stay same-origin and the dev and deployed URLs are
the same shape. An absolute cross-origin base reintroduces CORS *and* is blocked outright by the
page's `connect-src 'self'` CSP — which surfaces only as a generic "login failed".

> The proxy used to strip `/api` before forwarding, because the backend served `/auth/login`. That
> made the prefix a dev-only fiction that worked here and 404'd the moment `VITE_API_BASE` named a
> real host. Anything that calls the backend **directly** — `curl`, the parity harnesses, a REST
> client — must therefore include `/api` itself: `http://localhost:8080/api/properties`. Swagger UI
> is at `/api/docs` and health at `/api/actuator/health`.

## 4. Verifying the integration

All three require the backend running with `VITE_API_DOMAINS=auth`. Only the first is automated.

```powershell
# Mock and live auth providers return the same shapes for every field the UI relies on.
cd frontend
node scripts\contract-parity.mjs --otp-log <path-to-backend-console-log>
```

It reads the OTP straight from the backend console log, so redirect it to a file:

```powershell
mvn spring-boot:run -Dspring-boot.run.profiles=dev 2>&1 | Tee-Object -FilePath $env:TEMP\boot.log
```

Two things `contract-parity.mjs` does **not** cover, and which no automated check currently does
either — verify them by hand against a live backend before trusting a release:

1. **Session survives a reload, and a 401 triggers one silent refresh rather than a logout.** Log in,
   hard-reload, then let the access token expire and make a request.
2. **Two tabs refreshing at once do not trip server-side reuse-detection.** Open the app in two tabs
   and reload both at the same moment; neither should be signed out.

This file used to document `_live_auth_probe.mjs` and `_crosstab_refresh_probe.mjs` for exactly these
two checks. Both files were zero bytes and had never contained anything — running them exited 0 and
verified nothing, which is worse than having no instruction at all. They were deleted and the checks
written out here instead (tech-debt D75).

### What the parity harnesses leave behind

There are eighteen `scripts/*-parity.mjs`. **They run against your real dev backend, so they write
to `punenest`** — there is no way around that: the harness drives the *real* http provider over
HTTP, and the backend, not the harness, chooses the database. Pointing a harness at a throwaway
database would mean pointing the whole backend at one.

Every one of them signs in, so every run mints a `users` row on a throwaway `987xxxxxxxx` mobile.
That is invisible and harmless. What was neither was `review-parity.mjs`: it posts a genuine
locality review, **reviews are public**, and so until 2026-08-09 each run left another "Parity probe
review." rendering on `/locality/aundh` for anyone browsing the dev site. Four of them had
accumulated, and the first live-reviews e2e asserted against them believing they were seed data
(tech-debt D100).

`review-parity.mjs` now removes its own row, and the contract is worth knowing before you read a
failure from it:

- It deletes **by the id the create returned**, straight through `psql` — never a
  `LIKE 'Parity probe%'` sweep, which on a shared database would delete a concurrent run's row.
- **Cleanup runs even when the assertions fail**, so a contract break does not also cost a public row.
- **If cleanup fails, the run exits non-zero and prints the surviving id plus the `DELETE` to run by
  hand.** A `PASS` therefore means both "the shapes agree" and "the row is gone"; a failure
  mentioning a review id is asking you to remove it, not merely reporting drift.
- Knobs, all defaulted to the values above so you normally pass none: `--db <uri>`
  (or `$PARITY_DB_URL`), `--psql <path>` (or `$PARITY_PSQL`; falls back to `psql` on PATH then
  `C:\Program Files\PostgreSQL\13\bin\psql.exe`), and `--keep` to leave the row deliberately —
  which says loudly that it did. **Pass `--keep` last**: these scripts read argv in `--flag value`
  pairs, so a valueless flag in the middle swallows the next argument.

`--db` must name the database the **backend** is using. Point it elsewhere and the delete matches
nothing, which the harness reports as a failure rather than a clean run.

`conversation-parity.mjs` is often assumed to litter the same way. It does not: its staged chats
live in `localStorage`, which under Node is an in-memory stub, so they never leave the process. Its
only database footprint is the login row.

## 5. Tests

```powershell
cd backend; mvn verify        # requires punenest_test to exist and be free of demo data
cd e2e;     npx playwright test
```

## Known local gotchas

- **`target-cli`** — CLI Maven builds write there, not `target` (via `.mvn/maven.config`). `target`
  belongs to the VS Code Java language server; sharing one directory makes the two race and corrupt
  each other's output.
- **Postgres 13** is below Hibernate's minimum supported 14.0, so a version warning on boot is
  expected and harmless.
- **`usePolling` is on** in `vite.config.js` — OneDrive locks files mid-sync on Windows, which
  otherwise crashes Chokidar's native watcher with `EBUSY`.
