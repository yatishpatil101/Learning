# Profiles

Four tiers, in the order a change travels from a keyboard to a stranger's phone.

| # | Activated as | What it is | Data | Secrets |
|---|---|---|---|---|
| 1 | `local` | a developer's machine | `draazy`, schema + demo seed | `.env.local`, git-ignored |
| 2 | `local,e2e` | the Playwright suite | `draazy_e2e`, schema + seed, wiped freely | none needed |
| 3 | `sandbox` | the shared test environment | Supabase sandbox, schema + demo seed | GCP Secret Manager |
| 4 | `prod` | real users | Supabase production, schema only | GCP Secret Manager |

Each tier has a file: `application-local.properties`, `application-e2e.properties`,
`application-sandbox.properties`, `application-prod.properties`. All four layer on
`application.properties`, which holds every value that is the same everywhere.

Every deployed tier names **exactly one** profile, and its file is self-contained: its own
datasource, its own secret lookups, its own cookie flags, throttles and proxy CIDR. Sandbox and
production read the same variable *names* and completely different *values* — separate Supabase
projects, separate Secret Manager entries, separate Cashfree credentials.

## The rule that makes the rest make sense

**Profiles are not mutually exclusive, and the last one wins.** `SPRING_PROFILES_ACTIVE` is a list,
not a choice. When two profile files define the same key, the value from the profile named *later*
is the one that survives.

That mechanism is still what `local,e2e` is built on, and it is still what makes one combination
dangerous:

- `local,e2e` — `e2e` is a *delta* on `local`. It keeps the mock providers and the demo seed, and
  overrides only what a test run needs differently: its own database, a fixed OTP code, and rate
  limits raised out of the way. Running `e2e` alone gets you the production stubs, which throw.
- `prod,local` — the dangerous one. It resolves `local`'s insecure-cookie setting *over* `prod`'s,
  producing a deployment that thinks it is production and ships session cookies without `Secure`.
  `LocalProfileGuard` refuses to finish booting on that combination.

Deployments deliberately do not use it. Sandbox used to run as `prod,sandbox` — a delta that
inherited prod's hardening and added the seed back. That made drift impossible, but it meant the
profile named `prod` was running against a database full of fabricated listings, and it made the
order of two words in a YAML file load-bearing in a way nothing on the page explained. Sandbox is
now standalone.

The cost of that is real: `application-sandbox.properties` is a near-copy of the prod file, so a
hardening line added to one and not the other would silently make sandbox a less faithful rehearsal
of production. `SandboxProfileContractTest` closes it — the two files must be identical except for
an explicitly declared list of divergences, which today has one entry (`spring.flyway.locations`).
Adding a setting to prod fails that test until it is copied across or the difference is written
down.

## 1. `local`

```powershell
cd backend; .\run-local.ps1
```

Turns on three things that are holes anywhere else: an OTP sender that prints the code to the log, a
file store that writes KYC documents to local disk, and `POST /me/verification/aadhaar/simulate`,
which grants the Verified badge on request. All three are `@LocalOnly` — opted *into* by `local`
rather than merely excluded from `prod` (D147), so a run that names no profile gets the production
counterparts, which exist only to throw.

Naming the profile is not sufficient. `LocalProfileGuard` also requires `DRAAZY_DEV_MACHINE` in the
process environment, because a profile name is a string in a file and files are what deployments
copy. Set it once per machine; nothing in the repository sets it for you. See
[docs/LOCAL_DEV.md](../LOCAL_DEV.md).

`spring.flyway.locations` adds `classpath:db/seed`, so the demo data is built by Flyway on boot and
the database is reproducible: drop it, start the app, get the same 38 listings back.

## 2. `local,e2e`

```powershell
cd backend; .\run-e2e-backend.ps1        # :8081, plus the lane scripts for parallel suites
```

A delta on `local` for the Playwright suite. What it changes and why:

- **Its own database** (`draazy_e2e`). The suite creates and deletes freely; pointing it at `draazy`
  would destroy the demo data, and pointing it at `draazy_test` would fight the Java suite's exact
  row-count assertions.
- **A fixed OTP code.** Without it every login has to scrape the backend log, which forces
  `workers: 1` and makes the suite serial.
- **Rate limits raised to 100000.** The real budgets exist to stop humans; a test suite is not one,
  and hitting them produces failures that look like product bugs.

## 3. `sandbox`

```
SPRING_PROFILES_ACTIVE=sandbox
```

The shared test environment on Cloud Run, at `sandbox.draazy.com`. Production configuration —
env-only secrets, `Secure` cookies, real TLS, real rate limits — with demo inventory so there is
something to look at. It reaches its own Supabase project through its own
`draazy-sandbox-*` secrets, and its own Cashfree account; nothing about the values is shared with
production.

Because it no longer names `prod`, it is named explicitly in `LocalProfileGuard.DEPLOYMENT_PROFILES`
instead. That list is what tells the guard an instance is a real deployment rather than a laptop,
and sandbox used to satisfy it for free by carrying the word `prod`. Sandbox sets
`trusted-proxies=none`, so the load-balancer signal does not fire there either — without the entry,
a public environment holding real credentials would have been treated as local.

The seed is a *repeatable* Flyway migration (`R__zz_DML_dev_demo_data.sql`), which means it re-runs
whenever its checksum changes. **A database that has been seeded can never be promoted to
production.** Sandbox and production are separate Supabase projects for that reason, and nothing
copies one to the other.

Deploy contract, variables and secrets: [docs/DEPLOY.md](../DEPLOY.md).

## 4. `prod`

```
SPRING_PROFILES_ACTIVE=prod          # baked into backend/Dockerfile
```

Real users. Migrations only — `spring.flyway.locations` is re-pinned to `classpath:db/migration`
alone, so no arrangement of profiles can drag the seed into a live catalogue.

Every secret is a bare `${ENV}` lookup with **no `:default`**. A missing value fails the boot rather
than silently falling back to a committed placeholder. `ProdProfileContractTest` pins that: it reads
`application-prod.properties` and asserts each required variable is undefaulted. **Adding a new
`${ENV}` to that file means adding it to `REQUIRED_DEPLOY_VARIABLES` in the same commit**, or the
test fails — and `SandboxProfileContractTest` will separately fail until the same lookup exists in
the sandbox file.

The image bakes `SPRING_PROFILES_ACTIVE=prod` rather than leaving it to the platform, so a container
started with no profile configured cannot boot on the base file's development-friendly defaults and
report itself healthy.

## Where each tier is named

| Place | Value |
|---|---|
| `backend/run-local.ps1` | `local` |
| `.vscode/tasks.json` | `local` |
| `backend/run-e2e-backend.ps1`, `run-lane-*.ps1` | `local,e2e` |
| `backend/src/test/resources/application.properties` | `local` (the Java suite) |
| `backend/Dockerfile` | `prod` |
| `backend/deploy/cloudrun-sandbox.yaml` | `sandbox` |

The Java suite runs under `local` because that is what wires the keyless providers its ~880 tests
assert against. It is exempt from the `DRAAZY_DEV_MACHINE` check, and the exemption keys on
`spring-boot-test` being on the classpath — a `test`-scoped dependency that is not in the packaged
application and that no file, flag or variable can switch on.
