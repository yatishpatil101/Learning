# Running PuneNest locally (frontend + backend + Postgres)

How to run the full stack on one machine, and how to flip individual domains from mock data to the
real API. **Mock mode is the default and always works with no backend running** — that is how the UI
is developed and demoed.

---

## 1. Postgres

Two databases, and they must stay separate:

| Database | Used by | Contents |
|---|---|---|
| `punenest` | local dev / running the app | Flyway schema **+ seeded demo data** |
| `punenest_test` | `mvn verify` | Flyway schema only, **kept empty of demo data** |

The test suite asserts exact row counts against a schema Flyway built from empty. Pointing dev at
`punenest_test` seeds it and breaks the suite with confusing `expected 2, got 18` failures.

```powershell
$env:PGPASSWORD = 'postgres'
$psql = 'C:\Program Files\PostgreSQL\13\bin\psql.exe'
& $psql -U postgres -h localhost -d postgres -c "CREATE DATABASE punenest;"
& $psql -U postgres -h localhost -d postgres -c "CREATE DATABASE punenest_test;"
```

Flyway builds the schema automatically on first boot (and on the first test run). See
`backend/LOCAL_DB_STATUS.md` for the seeded fixtures and sample IDs.

## 2. Backend

```powershell
$env:JAVA_HOME = 'C:\Program Files\Zulu\zulu-25'
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
cd backend
mvn spring-boot:run
```

Serves `http://localhost:8080`. Defaults (all env-overridable via `DB_URL` / `DB_USER` /
`DB_PASSWORD` / `JWT_SECRET`) live in `src/main/resources/application.properties`. The `prod` profile
re-declares them as bare `${ENV}` lookups, so a missing secret fails the boot instead of silently
falling back to a well-known local value.

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
`localhost:8080` and strips the prefix, so requests stay same-origin. An absolute cross-origin base
reintroduces CORS *and* is blocked outright by the page's `connect-src 'self'` CSP — which surfaces
only as a generic "login failed".

## 4. Verifying the integration

All three require the backend running with `VITE_API_DOMAINS=auth`.

```powershell
# Mock and live auth providers return the same shapes for every field the UI relies on.
cd frontend
node scripts\contract-parity.mjs --otp-log <path-to-backend-console-log>

# Real OTP login, token persistence, session survives reload, 401 -> silent refresh.
cd e2e
node _live_auth_probe.mjs <path-to-backend-console-log>

# Two tabs refreshing at once must not trip server-side reuse-detection.
node _crosstab_refresh_probe.mjs <path-to-backend-console-log>
```

The probes read the OTP straight from the backend console log, so redirect it to a file:

```powershell
mvn spring-boot:run 2>&1 | Tee-Object -FilePath $env:TEMP\boot.log
```

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
