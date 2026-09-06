# Sandbox deploy — the ordered walkthrough

[`DEPLOY.md`](./DEPLOY.md) is the reference: what each variable means, and which mistakes are
silent. **This file is the sequence** — what to do first, what proves it worked, and what not to do
next. Where the two disagree about a value, `DEPLOY.md` wins; where they disagree about *order*,
this one does.

Target: **`https://sandbox.draazy.com`** serving the SPA and `/api/*` from one origin.

Everything is written for **macOS** and **Windows PowerShell** side by side, because the verification
machine is a MacBook and the development machine is Windows. Where only one column is given, the
command is identical on both.

> **Read [§0.1](#01-the-one-thing-that-differs-on-apple-silicon) before building anything on the
> Mac.** The default `docker build` there produces an image Cloud Run cannot run, and the failure
> arrives four steps later wearing a different mask.

---

## Contents

| Phase | What it establishes | Blocking? |
|---|---|---|
| [0](#0--prerequisites) | Tools and accounts | yes |
| [1](#1--dns-godaddy--cloudflare) | `draazy.com` answering from Cloudflare | yes |
| [2](#2--supabase) | The two connection strings | yes |
| [3](#3--prove-the-container-locally) | The image builds and boots | yes |
| [4](#4--google-cloud-bootstrap) | Project, registry, identities, secrets | yes |
| [5](#5--github-environment) | CI can deploy | yes |
| [6](#6--first-backend-deploy) | A running Cloud Run service | yes |
| [7](#7--cloudflare-r2) | Photo upload | no — defer if you like |
| [8](#8--cloudflare-pages--the-custom-domain) | One origin, both halves | yes |
| [9](#9--verification) | It actually works | yes |

> **Push your branch before phase 5.** Phases 5, 6 and 8.1–8.2 are the primary route, and both CI
> and Cloudflare's git integration can only build a branch the remote can see. If the push is
> blocked, or CI is broken, or you deliberately want a hand-built image,
> [§6.5](#65-deploying-without-ci--the-manual-path) and
> [§8.4](#84-deploying-pages-without-git-integration) are the fallbacks. Everything else is
> unchanged either way.

---

## 0 — Prerequisites

### 0.1 The one thing that differs on Apple Silicon

Cloud Run's container contract is explicit: *"Executables in the container image must be compiled for
Linux 64-bit. Cloud Run specifically supports the Linux x86_64 ABI format."* A multi-arch manifest
must include `linux/amd64`.

An M-series Mac builds **`linux/arm64`** by default, and `eclipse-temurin:25-jdk` is multi-arch — so
the base image pulls happily, Maven compiles happily, the image runs happily *on your Mac*, and
nothing warns you. It fails only once Cloud Run tries to start it, as a startup failure with no
useful log line, several steps after the mistake.

So on the Mac, always:

```bash
docker buildx build --platform linux/amd64 -t draazy-api backend/
```

Expect it to be slow the first time — the JDK stage runs under emulation. That is the cost of finding
out now instead of at [§6](#6--first-backend-deploy).

Check which machine you are on:

```bash
uname -m          # arm64 = Apple Silicon, x86_64 = Intel Mac
```

CI is unaffected — GitHub's `ubuntu-latest` runners are amd64, so
`.github/workflows/deploy-backend.yml` builds the right thing without asking. The platform flag is a
*local build* concern only.

### 0.2 Tools

| | macOS | Windows |
|---|---|---|
| Google Cloud SDK | `brew install --cask google-cloud-sdk` | `winget install --id Google.CloudSDK -e` |
| Docker | `brew install --cask docker`, then launch it | Docker Desktop, then launch it |
| GitHub CLI | `brew install gh` | `winget install --id GitHub.cli -e` |
| Node 20+ | `brew install node` | `winget install --id OpenJS.NodeJS.LTS -e` |
| Java 25 | `brew install --cask zulu@25` | already at `C:\Program Files\Zulu\zulu-25` |
| `envsubst` | `brew install gettext && brew link --force gettext` | ships with Git Bash |
| Wrangler | `npx wrangler` — no install needed | same |

Restart the terminal after installing `gcloud` — the installer edits `PATH`.

**macOS ships no `envsubst`.** It is only needed for the fallback manual deploy
([§6.5](#65-deploying-without-ci--the-manual-path)); CI's Ubuntu runner has it. Wrangler is likewise
only needed for the fallback Pages deploy ([§8.4](#84-deploying-pages-without-git-integration)).
Skip both installs unless you end up on one of those paths.

**`openssl` is present on macOS and absent on Windows.** Where §4 needs random bytes, use whichever
column applies; both produce the same thing.

Verify:

```bash
gcloud version && docker info --format '{{.ServerVersion}}' && gh --version && node -v
```

### 0.3 Accounts

Four, none of which can be created from a terminal:

1. **Google Cloud** with a **billing account attached.** Cloud Run's free tier still requires billing
   enabled; without it `gcloud services enable run.googleapis.com` fails with a permission error
   that does not mention billing.
2. **Supabase**, a project in **ap-south-1 (Mumbai)** — ADR-007. Region is fixed at creation.
3. **Cloudflare**, free plan.
4. **GoDaddy**, holding `draazy.com`, with access to the nameserver settings.

### 0.4 The repository, and where commands run

```bash
git clone https://github.com/yatishpatil101/Learning.git
cd Learning
git checkout feature/backend-integration
```

**Every command in this document runs from that repository root** unless it says otherwise. Paths
like `backend/` and `frontend/` are relative to it, and `docker build ... backend/` in particular
takes that path as its *build context* — run it one directory down and Docker looks for
`backend/backend/`.

---

## 1 — DNS: GoDaddy → Cloudflare

### 1.1 What "same domain paths" actually means here

The whole topology exists to satisfy one browser rule. The refresh token rides a `__Host-` prefixed,
`SameSite=Lax` cookie, and a browser returns that only when the page and the API share a registrable
domain. So:

```
                    https://sandbox.draazy.com
                              │
                    ┌─────────┴─────────┐
                    │  Cloudflare Pages │
                    └─────────┬─────────┘
              /api/*  │                 │  everything else
                      ▼                 ▼
        functions/api/[[path]].js    the built SPA (dist/)
                      │
                      │  fetch(API_ORIGIN + /api/...)
                      ▼
        https://draazy-api-sandbox-xxxx.a.run.app
```

**The browser never learns the Cloud Run URL.** It is a Pages *environment variable*, `API_ORIGIN`,
read server-side at request time. There is no DNS record for it and there must not be one.

The three consequences, all easy to get wrong:

- **Do not create `api.draazy.com`.** Pointing a subdomain at Cloud Run is the *other* supported
  shape (sibling subdomains) and it needs different `WEB_ORIGINS` / `API_PUBLIC_ORIGIN` values. Mixing
  the two halves gives you a service that boots and cannot hold a session.
- **Do not use the `*.pages.dev` URL for anything requiring login.** `pages.dev` is a Public Suffix
  List entry, which makes the SPA cross-*site* with `/api`. `CookieDeliveryCheck` refuses to boot
  into that shape, which is the only reason it gets caught.
- **`VITE_API_BASE` stays `/api`.** Relative, by design. An absolute value is the cross-origin
  topology and the CSP ships `connect-src 'self'`.

### 1.2 Move the nameservers

> **This does not move the domain off GoDaddy.** GoDaddy stays the *registrar* — you still own it
> there, renew it there, and pay them. What moves is *DNS hosting*: which nameservers answer
> "what is `sandbox.draazy.com`". Cloudflare DNS is free, and registrar-at-GoDaddy /
> DNS-at-Cloudflare is an ordinary arrangement. It is also reversible in minutes by pasting
> GoDaddy's original nameservers back. Transferring the *registrar* to Cloudflare is a different
> operation, is not needed, and is impossible for 60 days after registration anyway.

For a *subdomain* alone, Cloudflare lets you keep GoDaddy's DNS and add a CNAME. **Do the full
nameserver move anyway.** Three reasons, in ascending order of how much they will cost you later:

1. `draazy.com` at the apex — which you will want for production — **requires** the zone to be on
   Cloudflare. Pages cannot attach an apex domain otherwise, and GoDaddy does not support CNAME
   flattening, so there is no workaround at the registrar.
2. **ADR-015 chose "Cloudflare edge WAF / rate-limit / Turnstile"** as the abuse strategy instead of
   Redis. Those are *zone* features. Without the zone in your account they do not exist, and ADR-015
   quietly becomes a decision you did not implement.
3. `DEPLOY.md` §4's remediation 2 — restricting origin ingress — assumes the same.

Steps:

1. **Screenshot the GoDaddy DNS panel first.** Cloudflare's import is best-effort, and the records
   you will miss are the ones nothing on the website depends on — MX, SPF/DKIM `TXT`, an
   `autodiscover` CNAME. A website that still loads is not evidence that mail still arrives.
2. Cloudflare dashboard → **Add a site** → `draazy.com` → **Free**. It scans and imports the existing
   records; compare them against the screenshot before continuing.
3. Cloudflare shows two nameservers, e.g. `xxx.ns.cloudflare.com`.
4. GoDaddy → **My Products** → `draazy.com` → **DNS** → **Nameservers** → **Change** → **I'll use my
   own nameservers** → paste both → save.
5. If GoDaddy refuses, it is **Domain Protection** — disable it, change nameservers, re-enable.

**Three GoDaddy features break on the move**, because they are implemented on GoDaddy's own
infrastructure rather than as portable DNS records. None applies to a domain that has only ever
served a website, so skip this if the domain is fresh:

| Feature | After the move | Replacement |
|---|---|---|
| GoDaddy **email forwarding** | stops | Cloudflare Email Routing (free) |
| GoDaddy **domain / website forwarding** | stops | a Cloudflare Redirect Rule |
| **Microsoft 365 mail bought via GoDaddy** | survives *only* if MX, the `autodiscover` CNAME and the SPF/DKIM `TXT` records are all copied across | copy them, then send yourself a test mail |

Propagation is usually under an hour. Check:

| macOS | Windows |
|---|---|
| `dig NS draazy.com +short` | `Resolve-DnsName draazy.com -Type NS` |

**Checkpoint:** the answer names `*.ns.cloudflare.com`. Do not continue to [§8](#8--cloudflare-pages--the-custom-domain) until it does.

You do **not** create any DNS record by hand. Pages creates the `sandbox` record itself in §8.

---

## 2 — Supabase

### 2.1 Create the project

**Region: `ap-south-1` (Mumbai)** — ADR-007, and **fixed at creation.** Getting it wrong means
deleting the project and starting over, so check it twice; every millisecond here is paid on every
query for the life of the deployment, from a Cloud Run service sitting in `asia-south1`.

Supabase asks for a **database password** on the create form. **Record it now.** It is shown once,
it is what becomes `DB_PASSWORD`, and it is not recoverable — only resettable, at Settings →
Database → *Reset database password*, which invalidates any deployment already using it. If you did
not save it, reset it before continuing rather than after.

### 2.2 Where the strings live

Not in Settings any more — the **`Connect`** button in the top bar of the project dashboard. It
opens a panel with the connection methods as tabs. Three are offered; **you want two of them, and
neither is the first one.**

| Tab | Host / port | Take it? |
|---|---|---|
| **Direct connection** | `db.<project-ref>.supabase.co:5432` | **No.** IPv6-only unless you buy the IPv4 add-on |
| **Transaction pooler** | `aws-<n>-ap-south-1.pooler.supabase.com:6543` | **Yes** → `DB_URL` |
| **Session pooler** | `aws-<n>-ap-south-1.pooler.supabase.com:5432` | **Yes** → `FLYWAY_DB_URL` |

The two you want are **the same host with different ports.** That is the whole difference, and it is
why this is so easy to get wrong by eye.

Incidentally, the host is a free region check: if it does not contain `ap-south-1`, the project is
not in Mumbai and §2.1 needs doing again.

### 2.3 Why each one

| | `DB_URL` — transaction, `6543` | `FLYWAY_DB_URL` — session, `5432` |
|---|---|---|
| Used by | every request the app serves | Flyway, once per boot |
| Because | Cloud Run scales to zero and back, so each cold start would otherwise open fresh real backends against a free-tier ceiling measured in dozens | Flyway serialises concurrent deploys with `pg_advisory_lock`, which is **session**-scoped |
| Fails how | prepared statements break — `prepared statement "S_1" does not exist`, intermittently, on the busiest endpoints only. Already handled: `prepareThreshold=0` is pinned in `application-prod.properties` | **it hangs.** The lock is taken on one backend and released against another, readiness never passes, and nothing in the log says "Flyway" |

The direct connection *would* work for Flyway — it is a real session — but it is IPv6-only on the
free tier, and it uses a different username (`postgres`, not `postgres.<project-ref>`), which means
supplying `SPRING_FLYWAY_USER` and `SPRING_FLYWAY_PASSWORD` separately. The session pooler avoids
both problems for free.

### 2.4 Convert them — this is the step that catches people

Supabase shows a **libpq URI**, with the credentials embedded:

```
postgres://postgres.abcdefghijklmnop:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres
```

Spring needs a **JDBC URL**, with the credentials *removed* — `spring.datasource.username` and
`.password` are separate properties, fed from `DB_USER` / `DB_PASSWORD`. So three edits:

1. `postgres://` → **`jdbc:postgresql://`**
2. delete `postgres.<ref>:[YOUR-PASSWORD]@` — everything between `//` and the host
3. append **`?sslmode=require`**

Giving:

```
DB_URL         = jdbc:postgresql://aws-0-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require
FLYWAY_DB_URL  = jdbc:postgresql://aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require
DB_USER        = postgres.abcdefghijklmnop        ← the whole thing, dot included
DB_PASSWORD    = the password from §2.1
```

Four things worth knowing about that:

- **`[YOUR-PASSWORD]` is a literal placeholder**, not your password. Supabase does not store it in
  recoverable form, so it cannot show it to you.
- **`DB_USER` is `postgres.<project-ref>`, not `postgres`.** The dot and the ref are both required —
  Supavisor routes on them, which is how a multi-tenant pooler knows whose database you want.
  `FATAL: Tenant or user not found` is this.
- **Splitting the password out means no percent-encoding.** Left inside a URI, a password containing
  `@`, `/`, `:` or `#` would silently truncate the host. Since it travels as its own variable, paste
  it verbatim — and *do not* URL-encode it, or you will be authenticating with the literal `%40`.
- **`?sslmode=require` in the URL wins over the properties file**, which is the intended escape
  hatch and the only way to go *stricter* per-deploy. `application-prod.properties` already pins
  `sslmode=require` as a floor, because pgjdbc's default is `prefer`, which falls back to plaintext
  with no error at all.

### 2.5 Verify before going anywhere near GCP

```bash
# macOS — psql ships with `brew install libpq`, or use any GUI client
psql "postgres://postgres.<ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:6543/postgres" -c "select 1"
psql "postgres://postgres.<ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres" -c "select 1"
```

Note that `psql` takes the **libpq** form — credentials embedded, no `jdbc:` prefix. It is the one
place the original string is used as given, which makes it a clean test of the credentials
independently of the conversion above.

Both must answer. `1` twice means the host, the username, the password and both ports are right,
which is every way this can be wrong except mixing up which port went into which variable — and
§3's local container boot catches that, because Flyway will hang.

> **This project is the sandbox and can never become production.** `application-sandbox.properties`
> adds `classpath:db/seed`, which commits 38 fabricated listings and 78 fabricated users. Turning the
> profile off later does not remove rows that are already there. Production gets its own project.

> **Free-tier projects pause after 7 days with no connections**, and restoring one is manual. A
> sandbox nobody visits for a week is down until someone notices.

---

## 3 — Prove the container locally

Do this **before** touching GCP. Everything after this point costs money, creates identities, or
takes minutes per attempt; this step costs a coffee and catches four different failures, three of
which are otherwise discovered as *"the revision failed to start"* with a log that names none of
them.

### 3.1 What is actually unproven

| | Why it might be wrong | How it presents in CI instead |
|---|---|---|
| **The `buildDirName` override** | `.mvn/maven.config` pins `-DbuildDirName=target-cli` so command-line builds do not fight the VS Code language server over `target/`. `COPY .mvn/ .mvn/` puts that file **inside the builder**, so it applies there too — the Dockerfile passes `-DbuildDirName=target` explicitly to beat it. **That override has never executed on this machine, because no Docker daemon has ever been available.** | `COPY --from=build /build/target/*.jar` matches no file. Build failure, ~3 minutes in |
| **Image architecture** | see [§0.1](#01-the-one-thing-that-differs-on-apple-silicon) | deploys fine, revision never starts, no useful log |
| **`FLYWAY_DB_URL` port** | §2 verified both ports answer; it did not verify you put them in the right variables | container hangs, readiness times out, nothing says "Flyway" |
| **Schema vs. entities** | `ddl-auto=validate` compares every JPA entity against the migrated schema | startup exception, but only after a full deploy cycle |

### 3.2 Before you build

Docker must be *running*, not merely installed — the daemon is a separate thing from the CLI:

```bash
docker info --format '{{.ServerVersion}}'
```

An error mentioning a socket or a pipe means the daemon is down; launch Docker Desktop and wait for
the whale to settle.

### 3.3 Build

```bash
# macOS, Apple Silicon — the --platform flag is not optional, see §0.1
docker buildx build --platform linux/amd64 -t draazy-api backend/

# Intel Mac or Windows
docker build -t draazy-api backend/
```

`backend/` is the build **context** — the trailing path, not a flag. It is why `.dockerignore` lives
in `backend/` and why it now excludes key material and `deploy/`.

What happens, and roughly how long:

1. **`FROM eclipse-temurin:25-jdk`** — a few hundred MB, once.
2. **`dependency:go-offline`** — the whole tree including the Lombok + MapStruct annotation-processor
   path. Slow, cached afterwards, and *invalidated only by a change to `pom.xml`* — which is the
   entire point of copying the POM before `src/`.
3. **`package -DskipTests`** — compiles. **Tests are deliberately not run here:** CI runs them
   against a real Postgres before anything reaches this file, and a database inside the builder would
   make deploys fail for reasons CI already covers, minutes later and with worse logs.
4. **`FROM eclipse-temurin:25-jre`** — the runtime stage. The JDK, Maven and your source do *not*
   travel into the final image; only `app.jar` does.

On an M1 expect **8–10 minutes** the first time and ~2 on a rebuild. Emulating amd64 is the cost of
finding out here rather than in a Cloud Run revision.

**A successful build proves the jar assembles and the `COPY` found it.** It proves nothing about
configuration — that is the next step, and it is the one that matters.

### 3.4 Run it against Supabase

Ten variables, which is not a coincidence: `ProdProfileContractTest` asserts that the set of
`${ENV}` lookups in `application-prod.properties` is **exactly** this list, so it cannot drift
without a test going red. Omit any one and the container refuses to start rather than defaulting.

**macOS**

```bash
docker run --rm -p 8080:8080 \
  -e SPRING_PROFILES_ACTIVE='prod,sandbox' \
  -e DB_URL='jdbc:postgresql://aws-0-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require' \
  -e FLYWAY_DB_URL='jdbc:postgresql://aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require' \
  -e DB_USER='postgres.<project-ref>' \
  -e DB_PASSWORD='<from §2.1>' \
  -e JWT_SECRET="$(openssl rand -base64 48)" \
  -e REFERRAL_SIGNAL_SALT='any-long-random-string-for-now' \
  -e CASHFREE_WEBHOOK_SECRET='any-non-empty-value-for-now' \
  -e WEB_ORIGINS='https://sandbox.draazy.com' \
  -e API_PUBLIC_ORIGIN='https://sandbox.draazy.com' \
  -e INTERNAL_PROXIES='none' \
  draazy-api
```

**Windows** — identical with `` ` `` continuations instead of `\`:

```powershell
docker run --rm -p 8080:8080 `
  -e SPRING_PROFILES_ACTIVE='prod,sandbox' `
  -e DB_URL='jdbc:postgresql://aws-0-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require' `
  ... `
  draazy-api
```

Four of those deserve a note:

- **`SPRING_PROFILES_ACTIVE='prod,sandbox'`, in that order.** The image bakes `prod` as its default —
  deliberately, because `application.properties` holds developer values (local Postgres, a committed
  JWT secret, `trusted-proxies=none`) and Spring does not complain when a profile is simply absent, so
  a deploy that forgot the variable would boot on those and report itself *healthy*. `sandbox` is a
  **delta on prod**, not a replacement: later profiles win, so naming it second keeps env-only
  secrets, `Secure` cookies and migration-only Flyway, and adds back only the demo seed. Naming it
  *first* — or alone — silently drops all of that.
- **`WEB_ORIGINS` and `API_PUBLIC_ORIGIN` are both the public origin**, never a `localhost` and never
  the `*.run.app` URL. `CookieDeliveryCheck` compares them and refuses to boot on a cross-site shape.
  Using the real values here means you test the real check.
- **`JWT_SECRET` is throwaway here.** Generating a fresh one per run is fine and slightly better than
  reusing the real one on a laptop. Windows has no `openssl` — use the .NET RNG from [§4.7](#adding-the-values).
- **`CASHFREE_WEBHOOK_SECRET` must be non-empty even though payments are off.** A blank HMAC key makes
  every forged signature valid, which is why it has no default.

### 3.5 Read the log — three specific lines

```
Picked up JAVA_TOOL_OPTIONS: -XX:MaxRAMPercentage=75.0 ...
The following 2 profiles are active: "prod", "sandbox"      ← both, in that order
Flyway ... Successfully applied N migrations                 ← the FLYWAY_DB_URL proof
Tomcat started on port 8080 (http) with context path '/api'  ← note the context path
Started DraazyApiApplication in X seconds
```

**If it stops after Flyway announces itself and simply sits there, `FLYWAY_DB_URL` is on `6543`.**
That is the hang described in §2.3 — no error, no timeout, no further output. `Ctrl-C`, swap the
ports, run again.

Two things a clean start silently proves that no separate test covers: **Flyway ran to completion
against the real database**, and **`ddl-auto=validate` matched every JPA entity to the migrated
schema** — a boot that finishes is a schema that agrees.

### 3.6 Checkpoint

From a second terminal:

```bash
curl -fsS http://localhost:8080/api/actuator/health
```

Expect exactly `{"status":"UP"}`.

**The `/api` prefix is not decoration.** `server.servlet.context-path=/api` moves the actuator too,
so `/actuator/health` returns **404** — and a probe pointed there fails every revision forever while
the application underneath is perfectly healthy. It is the single most common way to make a working
deploy look broken.

The body is bare because `show-details` stays at its `never` default: a health endpoint that
enumerates the database, disk and mail sub-systems hands an attacker a component inventory.
`probes.enabled=true` also gives you `/api/actuator/health/readiness` and `/liveness`, which is what
Cloud Run's startup probe uses.

### 3.7 When it does not start

| Symptom | Cause |
|---|---|
| `COPY --from=build ... no such file` | the `buildDirName` override — the thing this step exists to catch |
| Hangs after Flyway, no further output | `FLYWAY_DB_URL` is the transaction pooler (`6543`) |
| `FATAL: Tenant or user not found` | `DB_USER` is `postgres`, not `postgres.<project-ref>` |
| `password authentication failed` | the password was percent-encoded, or it is the Supabase *account* password rather than the *database* one |
| `Could not resolve placeholder 'X'` | one of the ten is missing — the fail-fast working |
| `Schema-validation: missing table/column` | `ddl-auto=validate` found real drift; a migration is missing |
| Exits immediately, no Spring banner | on an M1, an arm64 image under an amd64 expectation — rebuild with `--platform` |

`--rm` means the container deletes itself on `Ctrl-C`; nothing to clean up. Keep the image, since §6
does not use it — CI rebuilds on its own amd64 runner — but a working local image is what lets you
tell a *code* problem from a *Cloud Run* problem later.

---

## 4 — Google Cloud bootstrap

`DEPLOY.md` §5 is the annotated version and explains *why* each grant is shaped as it is. This is the
same thing in order, in both shells. Run it once, by hand, as project owner — none of it belongs in
CI, because CI's credential is created *by* it.

### 4.1 What this phase builds

Six things, and the shape matters more than the commands:

| | What | Why not the default |
|---|---|---|
| 1 | A project, with billing linked | nothing runs without billing, including the free tier |
| 2 | A **spend cap** on Cloud Run | new since ADR-021 — GCP can now actually stop, not just email |
| 3 | Three APIs | disabled by default on a new project |
| 4 | An Artifact Registry repo, regional | cross-region image pulls pay latency on every cold start |
| 5 | A **runtime** identity holding one role | the default runtime SA carries project **Editor** |
| 6 | A **deploy** identity holding three | scoped to one SA and one repo, not to the project |

Two identities, not one. The deployer pushes images and replaces the service; the runtime is what the
container *is* while it runs. Collapsing them means the thing GitHub holds a key to can also read
every secret.

### 4.2 Variables

```bash
# macOS
PROJECT_ID=draazy-sandbox
REGION=asia-south1          # Mumbai. FIXED AT CREATION — wrong region means delete and recreate.
SERVICE=draazy-api-sandbox
RUNTIME="$SERVICE@$PROJECT_ID.iam.gserviceaccount.com"
DEPLOYER="github-deployer@$PROJECT_ID.iam.gserviceaccount.com"
```

```powershell
# Windows
$PROJECT_ID = 'draazy-sandbox'
$REGION     = 'asia-south1'
$SERVICE    = 'draazy-api-sandbox'
$RUNTIME    = "$SERVICE@$PROJECT_ID.iam.gserviceaccount.com"
$DEPLOYER   = "github-deployer@$PROJECT_ID.iam.gserviceaccount.com"
```

These are shell variables, not exported config — they vanish when you close the terminal. If you come
back to this phase later, re-run the block first.

### 4.3 The project, and billing

```bash
gcloud auth login

gcloud projects create "$PROJECT_ID" --name='Draazy sandbox'
gcloud config set project "$PROJECT_ID"

gcloud billing accounts list          # copy ACCOUNT_ID, format 0X0X0X-0X0X0X-0X0X0X
gcloud billing projects link "$PROJECT_ID" --billing-account=<ACCOUNT_ID>

# Confirm. An unlinked project fails the next step with a permission error
# that does not mention billing.
gcloud billing projects describe "$PROJECT_ID" --format='value(billingEnabled)'
```

Three things about the project ID:

- **It is globally unique across all of Google Cloud**, not unique to you. `draazy-sandbox` may be
  taken; add a suffix if `create` refuses.
- **It is immutable.** The display name can change; the ID cannot.
- **It cannot be reused after deletion.** A deleted project's ID is retired permanently, so if you
  tear this down and start over you need a new one.

The region is not set here — it is set at *resource* creation, and `cloudrun-sandbox.yaml` pins
`asia-south1` in a label. ADR-007 co-locates compute with the Supabase project you made in §2; a
service in the wrong region cannot be moved, only deleted and recreated under a new URL.

### 4.4 The spend guardrail — before anything can run

**ADR-021's cost concern has a better answer than it did when it was written.** It says the only
guardrail is a budget alert that notifies but does not cap. That is no longer true for this
workload: **Cloud Run is one of four services eligible for a *spend cap* budget** (preview, alongside
the Gemini API, Agent Platform and Cloud Run functions). A spend cap actually stops the service.

Set up **both**, in the Console — the cap is Console-only, and you want the alerts-only budget as
well because the cap covers exactly one service:

**Billing → Budgets & alerts → Create budget**

| | Spend cap budget | Alerts-only budget |
|---|---|---|
| Define | **Spend cap enforcement** | **Alerts only** |
| Scope | project `draazy-sandbox`, service **Cloud Run** | project `draazy-sandbox`, all services |
| Period | Monthly (forced) | Monthly |
| Amount | e.g. **$5** | e.g. **$10** |
| Alerts | 50 / 80 / 100%, fixed | 50 / 90 / 100%, editable |
| At 100% | **new requests blocked** until you lift it | an email |

What the cap does when it fires: new Cloud Run requests are refused, in-flight ones complete, and
**nothing is deleted** — no data, no image, no other service. You lift it by editing the budget, and
the service takes up to an hour to fully resume. Lifted within the same month, it will not re-arm
unless you raise the amount.

Three limitations worth knowing before you rely on it:

- **One project, one service, monthly only.** It does not cover Artifact Registry storage or Secret
  Manager, which is why the second budget exists.
- **Enforcement is not instant.** It runs on estimated costs — faster than billing reports, but
  overage during the lag is still billed. Set the cap below your actual pain threshold.
- **It cannot be converted from an alerts-only budget.** If you create the wrong type you must delete
  it and start again.

> **The trap that makes the alerts-only budget silent.** Alerts-only budgets measure spend **after**
> credits. A new account carries $300 of free trial credit, so a $10 budget will not alert for as
> long as the credit lasts — the guardrail you carefully set reports nothing, and you read that as
> "costing nothing" rather than "costs are being paid out of a balance that will run out". In the
> budget's Scope step, **clear the Savings / Promotions checkboxes** so it tracks gross spend. The
> spend cap is unaffected: it uses gross costs by design and cannot be configured otherwise.

Two smaller notes: the first notification can take several hours to arrive, and a monthly budget
keeps tracking into the first two days of the following month to absorb late-reported usage — so an
alert dated the 1st may belong to last month.

### 4.5 Enable the APIs

```bash
gcloud services enable run.googleapis.com \
                       artifactregistry.googleapis.com \
                       secretmanager.googleapis.com
```

Disabled by default on a new project, and each failure downstream is unhelpfully generic. If a later
command reports an API is not enabled, the error names it and gcloud offers to enable it inline.

### 4.6 Registry and runtime identity

```bash
gcloud artifacts repositories create draazy \
  --repository-format=docker --location="$REGION"

gcloud iam service-accounts create "$SERVICE" --display-name='Draazy API (sandbox) runtime'
```

The repository is **regional and co-located with the service** — the workflow's `AR_REPOSITORY: draazy`
and `REGION: asia-south1` must match what you just created, or the push target does not exist.

The runtime identity exists because Cloud Run's default is the Compute Engine service account, which
carries project **Editor**. A container compromise there is a compromise of the whole project. This
one ends up holding exactly one role, granted per-secret in the next step.

Note that you create the service account but **not** the Cloud Run service — §6 does that, from
`cloudrun-sandbox.yaml`, which names this identity by the address in `$RUNTIME`.

### 4.7 Secrets

```bash
# macOS
for s in db-password jwt-secret referral-signal-salt cashfree-webhook-secret \
         cashfree-app-id cashfree-secret-key; do
  gcloud secrets create "draazy-sandbox-$s" --replication-policy=automatic
  gcloud secrets add-iam-policy-binding "draazy-sandbox-$s" \
    --member="serviceAccount:$RUNTIME" --role=roles/secretmanager.secretAccessor
done
```

```powershell
# Windows
foreach ($s in 'db-password','jwt-secret','referral-signal-salt','cashfree-webhook-secret',
                'cashfree-app-id','cashfree-secret-key') {
  gcloud secrets create "draazy-sandbox-$s" --replication-policy=automatic
  gcloud secrets add-iam-policy-binding "draazy-sandbox-$s" `
    --member="serviceAccount:$RUNTIME" --role=roles/secretmanager.secretAccessor
}
```

The names are not free-form — `cloudrun-sandbox.yaml` refers to each by literal name in a
`secretKeyRef`, and a mismatch is a revision that will not start. Six secrets with one active version
each sits inside the free allowance.

**All six must exist before the first `gcloud run services replace`, including the two Cashfree
credentials you are not using yet.** A `secretKeyRef` pointing at a secret that does not exist is a
hard deploy error, not an empty string — Cloud Run rejects the revision outright. Placeholders are
safe while `CASHFREE_ENABLED` is `false`, because `CashfreeClient` is not instantiated at all in
that state, so nothing ever reads the value. Replace them with the real ones before turning payments
on.

The grant is **per secret**, not project-wide, so the runtime can read these six and nothing added
later without an explicit grant.

#### Adding the values

**This is the one step where PowerShell will silently corrupt a secret.** Piping a string to
`--data-file=-` appends a trailing `CRLF`, and `Out-File` prepends a UTF-8 BOM. Both become part of
the secret bytes. `JWT_SECRET` survives it (it is just bytes, and self-consistent), but
`CASHFREE_WEBHOOK_SECRET` does not — the HMAC never matches Cashfree's signature, and you meet it
weeks later as *every webhook rejected*, with nothing pointing at a stray newline.

```bash
# macOS — printf, never echo; and piped, never as an argument, because a command
# line lands in shell history and in the process table.
printf '%s' "$THE_VALUE" | gcloud secrets versions add draazy-sandbox-jwt-secret --data-file=-
```

```powershell
# Windows — write a BOM-less, newline-less temp file rather than piping.
function Add-DraazySecret {
  param([string]$Name, [string]$Value)
  $tmp = [System.IO.Path]::GetTempFileName()
  try {
    [System.IO.File]::WriteAllText($tmp, $Value, (New-Object System.Text.UTF8Encoding $false))
    gcloud secrets versions add $Name --data-file=$tmp
  } finally { Remove-Item $tmp -Force }
}
```

The six values:

| Secret | Value |
|---|---|
| `draazy-sandbox-db-password` | the Supabase password |
| `draazy-sandbox-jwt-secret` | HS256, ≥ 32 bytes, per environment |
| `draazy-sandbox-referral-signal-salt` | any long random string, **never** the local one |
| `draazy-sandbox-cashfree-webhook-secret` | from the Cashfree dashboard — required even with `CASHFREE_ENABLED` off, because a blank value makes every forged signature valid |
| `draazy-sandbox-cashfree-app-id` | from the Cashfree dashboard, or `placeholder` while payments are off |
| `draazy-sandbox-cashfree-secret-key` | from the Cashfree dashboard, or `placeholder` while payments are off |

Generating the JWT secret:

| macOS | Windows |
|---|---|
| `openssl rand -base64 48` | see below |

```powershell
$bytes = New-Object byte[] 48
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$JWT = [Convert]::ToBase64String($bytes)
```

Use the same values you proved the container with in §3 where they carry over — the database password
in particular, since that one is already known to work.

### 4.8 The deploy identity

```bash
gcloud iam service-accounts create github-deployer --display-name='GitHub Actions deployer'

# Scoped to the runtime SA, NOT the project. At project level, serviceAccountUser confers
# actAs on EVERY service account including the default Compute Engine one, which carries
# Editor — the holder deploys a container running as it and owns the project.
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME" \
  --member="serviceAccount:$DEPLOYER" --role=roles/iam.serviceAccountUser

# Scoped to the one repository.
gcloud artifacts repositories add-iam-policy-binding draazy --location="$REGION" \
  --member="serviceAccount:$DEPLOYER" --role=roles/artifactregistry.writer

# Project-wide, knowingly: Cloud Run IAM cannot be scoped to a service that does not exist
# yet, and this role creates it. Tighten to service-scoped after the first deploy — DEPLOY.md §5.
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$DEPLOYER" --role=roles/run.admin

gcloud iam service-accounts keys create key.json --iam-account="$DEPLOYER"
```

Three roles, and the shape of each is the point:

- `serviceAccountUser` **on `$RUNTIME`**, not on the project. Granted project-wide it means *act as
  any service account here*, which includes the default Compute Engine one — and deploying a
  container that runs as an Editor is owning the project.
- `artifactregistry.writer` **on the `draazy` repository**, not the project.
- `run.admin` **project-wide**, because Cloud Run IAM cannot name a service that does not exist yet
  and this is the role that creates it. It is the one deliberate over-grant; `DEPLOY.md` §5 explains
  how to narrow it once §6 has run.

The deployer needs **no** Secret Manager role — Cloud Run checks the *runtime* identity's grant when
it starts the container, not the caller's when it deploys. If you find yourself adding
`secretAccessor` here to fix something, the something is wrong elsewhere.

> `key.json` is a **permanent** credential: it does not expire, and anyone holding it can push an
> image and read every secret the runtime can. It is covered by `.gitignore`, but this repository is
> public — destroy it the moment §5 has consumed it. Do not paste it into a file, an issue or a chat
> window; a copy cannot be revoked, only the key rotated.

### 4.9 Checkpoint

```bash
gcloud projects describe "$PROJECT_ID" --format='value(projectId,lifecycleState)'
gcloud billing projects describe "$PROJECT_ID" --format='value(billingEnabled)'   # True
gcloud services list --enabled --format='value(config.name)' | grep -E 'run|artifact|secret'
gcloud artifacts repositories describe draazy --location="$REGION" --format='value(name)'
gcloud secrets list --format='value(name)'                                        # four
gcloud iam service-accounts list --format='value(email)'                          # two, plus defaults
ls -l key.json
```

Nothing is running yet and nothing is costing anything — Cloud Run has no service, and an empty
Artifact Registry repository is free. The next phase hands the key to GitHub and destroys the local
copy.

---

## 5 — GitHub environment

> **Push your branch first.** CI can only run a workflow that is on the remote, and Cloudflare's git
> integration in §8.1 has the same constraint. If you would rather not create a permanent credential
> yet, or CI is broken, [§6.5](#65-deploying-without-ci--the-manual-path) replaces this phase and
> §4.8 — but the git-driven path below is the one to keep, because it is the one that will still be
> correct on the tenth deploy.

```bash
# macOS
gh api --method PUT repos/yatishpatil101/Learning/environments/sandbox

gh secret   set GCP_SA_KEY            --env sandbox < key.json
gh variable set GCP_PROJECT_ID        --env sandbox --body "$PROJECT_ID"
gh secret   set SANDBOX_DB_URL        --env sandbox --body '<transaction pooler :6543>'
gh secret   set SANDBOX_FLYWAY_DB_URL --env sandbox --body '<session pooler :5432>'
gh secret   set SANDBOX_DB_USER       --env sandbox --body 'postgres.<project-ref>'

rm -P key.json          # macOS has no `shred`; -P overwrites before unlinking
```

```powershell
# Windows
gh api --method PUT repos/yatishpatil101/Learning/environments/sandbox

gh secret   set GCP_SA_KEY            --env sandbox --body (Get-Content key.json -Raw)
gh variable set GCP_PROJECT_ID        --env sandbox --body $PROJECT_ID
gh secret   set SANDBOX_DB_URL        --env sandbox --body '<transaction pooler :6543>'
gh secret   set SANDBOX_FLYWAY_DB_URL --env sandbox --body '<session pooler :5432>'
gh secret   set SANDBOX_DB_USER       --env sandbox --body 'postgres.<project-ref>'

Remove-Item key.json -Force
```

The connection strings are secrets rather than variables for one reason: **this repository is
public and they name the Supabase project.** That is about not committing them, not about
confidentiality after deploy — they reach Cloud Run as plaintext environment values and are recorded
verbatim in the Admin Activity audit log for 400 days. The password, which is the part that matters,
never leaves Secret Manager.

**Then, in the GitHub UI:** Settings → Environments → `sandbox` → **deployment branch policy**,
restricted to your deploy branch. `workflow_dispatch` accepts any ref and the workflow's confirmation
input checks the *environment name*, not `github.ref` — so without the policy anyone with write
access can dispatch a branch that edits `cloudrun-sandbox.yaml` to name a different runtime service
account. It belongs in the environment setting precisely because that cannot be changed by the same
pull request that would abuse it.

---

## 6 — First backend deploy

GitHub → **Actions** → **Deploy backend (sandbox)** → **Run workflow** → type `sandbox` into the
confirm box. If the Actions tab does not list the workflow, the branch carrying it has not reached
the remote — push it, or fall back to [§6.5](#65-deploying-without-ci--the-manual-path).

It builds on an amd64 runner, pushes to Artifact Registry tagged with the commit SHA, and applies
`backend/deploy/cloudrun-sandbox.yaml` with `gcloud run services replace` — `replace`, not `deploy`,
so the file is the whole truth and a setting deleted from the repo is deleted from the service
rather than lingering on it forever.

Read `backend/deploy/cloudrun-sandbox.yaml` before this runs. `maxScale`, `containerConcurrency`,
`memory` and `cpu-throttling` all encode consequences that are invisible from the console.

**Checkpoint** — the workflow deliberately does not print the URL, so fetch it:

```bash
gcloud run services describe "$SERVICE" --region="$REGION" --format='value(status.url)'
curl -fsS "$(gcloud run services describe "$SERVICE" --region="$REGION" --format='value(status.url)')/api/actuator/health"
```

If the revision fails to start, in order of likelihood: wrong `FLYWAY_DB_URL` port (hangs, no Flyway
in the log); an arm64 image if you pushed one by hand rather than via CI; a memory limit below `1Gi`,
which OOMs *during* startup because `MaxRAMPercentage=75` on 512 MiB leaves 128 MiB non-heap.

### 6.5 Deploying without CI — the manual path

**The fallback.** Reach for it when the workflow is not on the remote, when CI is failing for a
reason unrelated to the deploy, or when you want to ship a specific hand-built image. GitHub Actions
can only run a workflow file that exists on a branch it can see.

It is also a reasonable *first* deploy, because it proves the platform end to end before you create
a permanent credential.

**It replaces §4.8 and all of §5.** No `github-deployer`, no `key.json`, no repository secrets —
the account you ran `gcloud auth login` with owns the project and already holds every role that
service account would have been granted. Nothing long-lived is created, so nothing has to be
destroyed afterwards. It is not a substitute for §5 in the long run: every manual deploy is a step
someone has to remember, and the workflow is the thing that stays correct.

#### The one macOS prerequisite

```bash
brew install gettext        # macOS ships no envsubst
brew link --force gettext   # or call $(brew --prefix gettext)/bin/envsubst directly
```

#### 1. Variables — and these must be exported

```bash
export GCP_PROJECT_ID="$PROJECT_ID"    # the YAML token is GCP_PROJECT_ID, §4.2 defined PROJECT_ID
export DB_URL='jdbc:postgresql://...:6543/postgres?sslmode=require'
export FLYWAY_DB_URL='jdbc:postgresql://...:5432/postgres?sslmode=require'
export DB_USER='postgres.<project-ref>'
export IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/draazy/api:$(git rev-parse --short HEAD)"
```

> **`export`, not plain assignment.** `envsubst` reads the *environment*, not your shell's
> variables, and it substitutes an **empty string** for anything unset without warning or error.
> A missed `export` renders `serviceAccountName: draazy-api-sandbox@.iam.gserviceaccount.com` and
> an empty `DB_URL`, and you debug a malformed identity instead of a typo. The workflow guards
> against exactly this before calling `envsubst`; reproduce the guard below.

#### 2. Push the image you already proved

You built and ran this image against Supabase in §3. Tag *that* image rather than rebuilding, so
the bytes that deploy are the bytes you verified.

```bash
gcloud auth configure-docker "${REGION}-docker.pkg.dev"   # bare `configure-docker` only does gcr.io
docker tag draazy-api "$IMAGE"
docker push "$IMAGE"
```

If the local image is gone, rebuild it **with the platform flag** — this is the arm64 trap the
checkpoint above warns about, and on a manual deploy nothing else catches it:

```bash
docker buildx build --platform linux/amd64 -t draazy-api backend/
```

Confirm what you actually pushed:

```bash
docker manifest inspect "$IMAGE" | grep architecture     # must say amd64
```

#### 3. Render and apply

```bash
for v in GCP_PROJECT_ID IMAGE DB_URL FLYWAY_DB_URL DB_USER; do
  [ -n "${!v}" ] || { echo "$v is empty"; return 1 2>/dev/null || exit 1; }
done

envsubst '${GCP_PROJECT_ID} ${IMAGE} ${DB_URL} ${FLYWAY_DB_URL} ${DB_USER}' \
  < backend/deploy/cloudrun-sandbox.yaml > /tmp/service.yaml

grep -E 'image:|serviceAccountName:' /tmp/service.yaml    # eyeball before applying

gcloud run services replace /tmp/service.yaml --region "$REGION"
```

`envsubst` is given an explicit variable list on purpose. The file contains `${PORT:8080}` and other
tokens that belong to Spring; an unrestricted `envsubst` would blank them.

#### 4. Make it publicly invocable

`services replace` does not touch the IAM policy, so a new service answers **403** to everyone until
this runs:

```bash
gcloud run services add-iam-policy-binding "$SERVICE" --region "$REGION" \
  --member=allUsers --role=roles/run.invoker
```

If this fails with a policy-constraint error, your account is in an organisation that blocks public
invocation — see the appendix at the end of this document.

#### 5. Smoke test, and clean up

```bash
curl -fsS "$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')/api/actuator/health"
rm -f /tmp/service.yaml    # it contains the database URLs in plaintext
```

`{"status":"UP"}` means the revision is serving. Note the `/api` prefix — without it you get a 404
from a perfectly healthy service.

If the revision never becomes ready, read the logs rather than guessing:

```bash
gcloud run services logs read "$SERVICE" --region "$REGION" --limit 100
```

The three lines to look for are the same ones as §3.5: the active profile count, the Flyway summary,
and `Tomcat started ... context path '/api'`.

---

## 7 — Cloudflare R2

**Genuinely optional for a first deploy.** All six `R2_*` lookups carry an empty default in
`application.properties`, so they are *not* in the ten of §3.4 and the service boots without them.
`STORAGE_ENABLED` stays `false` and uploads throw; everything else works. Skip to §8 if you want the
site up first.

### 7.1 Buckets and a token

R2 → **Create bucket**, twice — ADR-013 splits them because the access rules differ, not for tidiness:

| Bucket | Holds | Public? |
|---|---|---|
| `draazy-sandbox-public` | listing photos | yes — enable **Public access / r2.dev** or attach a custom domain |
| `draazy-sandbox-private` | KYC and ownership documents | **no** — served only through pre-signed URLs |

Then R2 → **Manage API tokens** → **Create API token**, permission **Object Read & Write**, scoped
to those two buckets. It shows an **Access Key ID** and a **Secret Access Key** once. Record both.

You also need the **S3 API endpoint**, `https://<account-id>.r2.cloudflarestorage.com` — shown on the
bucket's settings page. That is not the same as the public base URL, which is the `r2.dev` address (or
your custom domain) for the *public* bucket only.

### 7.2 The six variables, and where each goes

```yaml
# backend/deploy/cloudrun-sandbox.yaml — add under `env:`
- name: STORAGE_ENABLED
  value: 'true'
- name: R2_ENDPOINT
  value: https://<account-id>.r2.cloudflarestorage.com
- name: R2_BUCKET_PUBLIC
  value: draazy-sandbox-public
- name: R2_BUCKET_PRIVATE
  value: draazy-sandbox-private
- name: R2_PUBLIC_BASE_URL
  value: https://pub-<hash>.r2.dev
- name: R2_ACCESS_KEY_ID
  valueFrom:
    secretKeyRef: { name: draazy-sandbox-r2-access-key-id, key: latest }
- name: R2_SECRET_ACCESS_KEY
  valueFrom:
    secretKeyRef: { name: draazy-sandbox-r2-secret-access-key, key: latest }
```

**The two keys go in Secret Manager, not in the YAML.** This file is committed to a public
repository. Create them the same way as §4.7, including the per-secret grant to `$RUNTIME`:

```bash
for s in r2-access-key-id r2-secret-access-key; do
  gcloud secrets create "draazy-sandbox-$s" --replication-policy=automatic
  gcloud secrets add-iam-policy-binding "draazy-sandbox-$s" \
    --member="serviceAccount:$RUNTIME" --role=roles/secretmanager.secretAccessor
done
```

Then redeploy — **editing the file changes nothing until `services replace` runs again.** Re-run
[§6.5 step 3](#65-deploying-without-ci--the-manual-path), or dispatch the workflow.

### 7.3 CORS, which is the part that bites

**R2 must send its own CORS headers.** It is cross-origin from the SPA by design — the photos come
from `r2.dev`, the page from `sandbox.draazy.com` — and R2 does not inherit the API's CORS config.

Bucket → **Settings** → **CORS policy**:

```json
[{ "AllowedOrigins": ["https://sandbox.draazy.com"],
   "AllowedMethods": ["GET", "PUT"],
   "AllowedHeaders": ["*"],
   "MaxAgeSeconds": 3600 }]
```

Without it the browser-side perceptual hashing fails at the canvas read — the upload half-works and
nothing surfaces as a CORS error, so it reads as a flaky uploader rather than a missing header.

**Checkpoint:** upload a listing photo, then reload the listing. If the image renders from an
`r2.dev` URL, all six variables and the CORS policy are right.

---

## 8 — Cloudflare Pages + the custom domain

Two routes. **§8.1–8.2 is the primary one and needs the branch on GitHub.** If the push is blocked,
[§8.4](#84-deploying-pages-without-git-integration) does the same job by hand; §8.3 is the same
either way.

### 8.0 Which variables are which — read this first

The single most confusing thing about this phase is that the three variables are not the same *kind*
of thing, and the difference decides where they go:

| | `VITE_API_BASE`, `VITE_GOOGLE_MAPS_API_KEY` | `API_ORIGIN` |
|---|---|---|
| Read | at **build** time, by Vite | at **request** time, by the Pages Function |
| Ends up | inlined as a literal in the JS bundle | never in the bundle; `context.env` only |
| So set it | wherever `npm run build` runs | on the Pages **project** |

With git integration, `npm run build` runs *on Cloudflare*, so all three are set in the same place
and the distinction is invisible — which is the main reason to prefer §8.1. **On the §8.4 fallback,
`npm run build` runs on your laptop**: putting `VITE_*` in the Pages dashboard then does nothing at
all, and the bundle ships with whatever your shell had. That is §8.4's main trap.

`VITE_GOOGLE_MAPS_API_KEY` is in the bundle either way, by necessity — the Maps JS SDK runs in the
browser. It is not a secret and cannot be made one; restrict it by HTTP referrer instead.

### 8.1 Create the project (git integration)

Workers & Pages → **Create** → **Pages** → connect the repo.

| Setting | Value |
|---|---|
| Production branch | `feature/backend-integration`, or `main` once merged |
| Root directory | `frontend` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node version | `20` or later |

Root directory is `frontend`, so `functions/` resolves to `frontend/functions` — which is where
`api/[[path]].js` lives. Pages requires the functions directory at the project root and **not**
inside the output directory; getting this wrong gives you a site that serves but 404s every `/api`
call.

### 8.2 Environment variables

Settings → Environment variables → **Production**:

| Name | Value | Notes |
|---|---|---|
| `API_ORIGIN` | the Cloud Run URL from §6 | scheme + host only, no path, no trailing slash |
| `VITE_API_BASE` | `/api` | relative, deliberately |
| `VITE_GOOGLE_MAPS_API_KEY` | your key | restrict to HTTP referrers + Maps JavaScript API only, and set a quota cap |

Leave `VITE_PMF_MODE` unset.

Setting a variable does **not** rebuild. Trigger a redeploy afterwards or the bundle keeps the old
values.

If `API_ORIGIN` is missing the Function answers **502** rather than falling through — a fall-through
would return the HTML shell with a 200, which `http.js` reads as success and renders as a confident
"no results" on every catalogue.

### 8.3 Attach the domain — order matters

1. Pages project → **Custom domains** → **Set up a domain** → `sandbox.draazy.com`.
2. Because the zone is now on Cloudflare (§1.2), the CNAME is created for you. Confirm it.

Doing this in the other order — creating the DNS record before registering the domain on the Pages
project — produces a **522** and looks like an origin outage.

**Do not test login on the `*.pages.dev` URL.** Every deployment gets one, and it is cross-*site*
with `/api` because `pages.dev` is on the Public Suffix List, so the refresh cookie is withheld.
Browsing works there; sessions do not. §1.1 has the full reasoning.

**Checkpoint:** `https://sandbox.draazy.com` serves the SPA, and:

```bash
curl -fsS https://sandbox.draazy.com/api/actuator/health
```

returns `UP` through the proxy. Both halves, one origin.

### 8.4 Deploying Pages without git integration

**The fallback**, for when the branch is not on the remote or the Cloudflare build is failing. It is
the same deployment — the same Function, the same custom domain — differing only in that the build
happens locally and Wrangler uploads the result.

> **Do not use dashboard Direct Upload.** Cloudflare is explicit that *"Direct Upload from the
> Cloudflare dashboard is currently not supported with Functions."* Drag-and-drop uploads the static
> site and silently omits `api/[[path]].js`, so the SPA loads and every `/api` call 404s. The
> Wrangler CLI path below **does** support Functions. This is the one distinction that matters here.

#### 1. Create the project and set the runtime variable

```bash
cd frontend

npx wrangler login
npx wrangler pages project create draazy-sandbox --production-branch=main

# API_ORIGIN is read at request time, so it belongs on the project, not in the build.
npx wrangler pages secret put API_ORIGIN --project-name=draazy-sandbox
# paste the Cloud Run URL from §6 — scheme + host, no path, no trailing slash
```

`pages secret put` rather than a plain variable: both arrive on `context.env` identically, and a
secret is not readable back out of the dashboard.

#### 2. Build locally — with the build-time variables set

```bash
VITE_API_BASE=/api \
VITE_GOOGLE_MAPS_API_KEY='<your key>' \
npm run build
```

These must be present **in this command**, not in the Pages dashboard — see §8.0. A `.env.production`
file in `frontend/` works too and is easier to get right twice.

Confirm the key actually made it in, because the failure is a blank map with a console error rather
than a build error:

```bash
grep -c 'AIza' dist/assets/*.js | head    # a non-zero count somewhere
```

#### 3. Deploy

```bash
npx wrangler pages deploy dist --project-name=draazy-sandbox --branch=main --commit-dirty=true
```

Run it **from `frontend/`** — this is the one place §0.4's rule does not hold. Wrangler looks for
`functions/` beside your working directory, and from the repo root it finds nothing and uploads a
Function-less site.

`--branch=main` matches `--production-branch` above, which is what makes this the *production*
deployment and therefore the one your custom domain serves. Any other value creates a preview
deployment on a URL nobody is pointing at. `--commit-dirty=true` just silences the uncommitted-changes
warning.

#### 4. Verify the Function shipped

```bash
curl -fsS "https://draazy-sandbox.pages.dev/api/actuator/health"
```

`UP` means the Function is deployed and `API_ORIGIN` is right. A **404** means the Function was not
uploaded — you ran the deploy from the wrong directory. A **502** means `API_ORIGIN` is unset or
malformed.

Then continue to [§8.3](#83-attach-the-domain--order-matters); attaching the domain is identical.

> **Every subsequent frontend change needs steps 2 and 3 again.** There is no git trigger on this
> path, so nothing rebuilds on its own. This is the main reason to switch to §8.1 once you push.

---

## 9 — Verification

### 9.1 What you can check today

None of these needs a login, so do them as soon as §8 is green:

```bash
# The proxy reaches the API, and the context path is right.
curl -fsS https://sandbox.draazy.com/api/actuator/health          # {"status":"UP"}

# The SPA is served, not the API.
curl -fsS https://sandbox.draazy.com/ | grep -c '<div id="root"'  # 1

# A real data endpoint — proves Flyway's seed landed and the DB is reachable from Cloud Run,
# not just that the health check passes. GET /properties is permitAll in SecurityConfig.
curl -fsS https://sandbox.draazy.com/api/properties

# A protected route rejects cleanly rather than erroring. /me/** has no permitAll entry.
curl -s -o /dev/null -w '%{http_code}\n' https://sandbox.draazy.com/api/me   # 401, not 500
```

The third is the one worth watching. A **200 with an empty list** where the seed should have put 38
listings means the request never reached Cloud Run — `API_ORIGIN` is wrong and something is
answering with the SPA shell. A **502** means `API_ORIGIN` is unset.

Then in a browser: the catalogue renders cards, a listing detail page opens, and the map appears. A
blank map with a console error is `VITE_GOOGLE_MAPS_API_KEY` — either missing from the build (§8.0)
or referrer-restricted to the wrong hostname.

### 9.2 The test that actually matters — and cannot run yet

`DEPLOY.md` §1 names the only test that proves the cookie topology, and Playwright structurally
cannot perform it — dev and e2e both go through the Vite proxy, where everything is same-origin by
construction.

1. Sign in at `https://sandbox.draazy.com`.
2. **Wait past the 15-minute access-token expiry.** Do not refresh, do not navigate.
3. Make one authenticated request.

If it survives, the refresh cookie is being delivered *and* the edge forwards `Cookie` to the proxy
target. If the session dies, the cookie is being withheld silently and the server log is
indistinguishable from a visitor who was never signed in — go back to §1.1 and check that nothing
points a second hostname at the backend.

> **Blocked until WhatsApp OTP is live** (below), because step 1 is impossible. Everything up to §9.1
> is still worth doing; come back to this one.

---

## Known blockers

- **Nobody can sign in.** `UnconfiguredOtpSender` is selected on every non-`dev` profile while
  `draazy.providers.whatsapp.enabled` is false, and throws on every send. Unblocking it needs Meta
  **business verification** — weeks (ADR-020). Until then the sandbox is
  unauthenticated-browse-only, which is enough to check the catalogue, the SPA and the proxy.
  **Before turning the flag on, set a spend cap on the Meta billing account:** `OtpService` throttles
  per *recipient*, so walking valid-looking numbers gets a fresh budget for each. On WhatsApp that is
  worse than a bill — sends to non-WhatsApp numbers drag the sending number's quality rating down,
  which cuts the daily messaging limit and takes sign-in itself offline days later.
- **The eight `@Scheduled` sweeps do not run.** CPU throttling freezes the scheduler thread between
  requests. Accepted on the sandbox, fatal for production — ADR-011 / ADR-021, and `DEPLOY.md` §7.
- **`INTERNAL_PROXIES=none`.** The anonymous rate limiter is advisory, not enforcing. Do not open the
  sandbox to untrusted traffic until one of `DEPLOY.md` §4's three remediations is in place.
- **Supabase free pauses after 7 days with no connections**, and has no PITR.
- **GitHub Actions are tag-pinned, not SHA-pinned.**
- **`workflow_dispatch` accepts any ref** until the `sandbox` environment carries a deployment branch
  policy — the confirmation input checks the environment name, not `github.ref`. Set the policy in
  §5 before the first CI deploy, not after.
- **This sandbox has no rollback story.** `services replace` keeps the previous Cloud Run revision,
  so `gcloud run services update-traffic "$SERVICE" --region "$REGION" --to-revisions=<previous>=100`
  recovers the API. Pages keeps prior deployments and can roll back from the dashboard. Neither
  reverses a Flyway migration — the database only moves forward.

---

## If the organisation blocks public invocation

If your Google Cloud organisation enforces `constraints/iam.allowedPolicyMemberDomains`, the
workflow's "Allow public invocation" step fails — `allUsers` cannot be granted. Either exempt the
project, or accept that Cloudflare must authenticate to the origin. The latter is `DEPLOY.md` §4's
remediation 2 arriving early, and it means §4 stops being deferred: the Pages Function has to mint an
identity token.
