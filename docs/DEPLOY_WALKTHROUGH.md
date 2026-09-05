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

Restart the terminal after installing `gcloud` — the installer edits `PATH`.

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

Create the project in **ap-south-1 (Mumbai)**, then collect **two** connection strings from
Settings → Database. They differ only in port, and guessing costs a day:

| Variable | Mode | Port | Why |
|---|---|---|---|
| `DB_URL` | Supavisor **transaction** | `6543` | Cloud Run scales to zero and back; direct connections would exhaust a free-tier ceiling measured in dozens |
| `FLYWAY_DB_URL` | Supavisor **session** | `5432` | Flyway's `pg_advisory_lock` is *session*-scoped. Transaction pooling moves the session between statements, so the lock is taken on one backend and released against another |

Append `?sslmode=require` to both. Username is `postgres.<project-ref>` for both, so `DB_USER` /
`DB_PASSWORD` cover them together.

Getting `FLYWAY_DB_URL` wrong does not fail cleanly: the migration hangs holding a lock nobody owns,
readiness never passes, and nothing in the log says "Flyway".

> **This project is the sandbox and can never become production.** `application-sandbox.properties`
> adds `classpath:db/seed`, which commits 38 fabricated listings and 78 fabricated users. Turning the
> profile off later does not remove rows that are already there. Production gets its own project.

---

## 3 — Prove the container locally

Do this **before** touching GCP. It is the cheapest place to find the one genuinely untested thing in
the deploy path: `backend/.mvn/maven.config` pins `-DbuildDirName=target-cli`, and the Dockerfile
overrides it back to `target` so `COPY --from=build /build/target/*.jar` matches something. **That
override has never executed.** If it is wrong you get a COPY that matches no jar — and you want that
in a local build, not in CI four steps later.

```bash
# macOS, Apple Silicon
docker buildx build --platform linux/amd64 -t draazy-api backend/

# Windows / Intel
docker build -t draazy-api backend/
```

Then boot it against Supabase. Substitute real values:

**macOS**

```bash
docker run --rm -p 8080:8080 \
  -e SPRING_PROFILES_ACTIVE=prod,sandbox \
  -e DB_URL='jdbc:postgresql://...pooler.supabase.com:6543/postgres?sslmode=require' \
  -e FLYWAY_DB_URL='jdbc:postgresql://...pooler.supabase.com:5432/postgres?sslmode=require' \
  -e DB_USER='postgres.<project-ref>' \
  -e DB_PASSWORD='...' \
  -e JWT_SECRET="$(openssl rand -base64 48)" \
  -e REFERRAL_SIGNAL_SALT='...' \
  -e CASHFREE_WEBHOOK_SECRET='...' \
  -e WEB_ORIGINS='https://sandbox.draazy.com' \
  -e API_PUBLIC_ORIGIN='https://sandbox.draazy.com' \
  -e INTERNAL_PROXIES='none' \
  draazy-api
```

**Windows** — same, with `` ` `` line continuations and `-e KEY='value'` unchanged.

**Checkpoint:**

```bash
curl -fsS http://localhost:8080/api/actuator/health
```

Note the `/api` prefix — `server.servlet.context-path=/api` moves the actuator too, and a probe on
`/actuator/health` 404s. `UP` also proves Flyway ran and `ddl-auto=validate` matched every entity
against the real schema; a boot that completes is a schema that agrees.

---

## 4 — Google Cloud bootstrap

`DEPLOY.md` §5 is the annotated version and explains *why* each grant is shaped as it is. This is the
same thing in order, in both shells. Run it once, as a human, as project owner.

### 4.1 Variables

```bash
# macOS
PROJECT_ID=draazy-sandbox
REGION=asia-south1          # Mumbai. FIXED AT CREATION — wrong region means delete and recreate.
SERVICE=draazy-api-sandbox
```

```powershell
# Windows
$PROJECT_ID = 'draazy-sandbox'
$REGION     = 'asia-south1'
$SERVICE    = 'draazy-api-sandbox'
```

### 4.2 Project, APIs, and the spend guardrail

Do the budget **first**. Per ADR-021, GCP's failure mode is a bill you did not choose — a budget
alert is the only guardrail that exists, and note that it *notifies*, it does not cap.

```bash
gcloud auth login
gcloud config set project "$PROJECT_ID"

gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com billingbudgets.googleapis.com

gcloud billing accounts list      # copy the ACCOUNT_ID
gcloud billing budgets create --billing-account=<ACCOUNT_ID> \
  --display-name='draazy sandbox' --budget-amount=5USD \
  --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0
```

### 4.3 Registry and runtime identity

```bash
gcloud artifacts repositories create draazy \
  --repository-format=docker --location="$REGION"

gcloud iam service-accounts create "$SERVICE" --display-name='Draazy API (sandbox) runtime'
RUNTIME="$SERVICE@$PROJECT_ID.iam.gserviceaccount.com"
```

The runtime identity exists because Cloud Run's default is the Compute Engine service account, which
carries project **Editor**. A container compromise there is a compromise of the whole project.

### 4.4 Secrets

```bash
# macOS
for s in db-password jwt-secret referral-signal-salt cashfree-webhook-secret; do
  gcloud secrets create "draazy-sandbox-$s" --replication-policy=automatic
  gcloud secrets add-iam-policy-binding "draazy-sandbox-$s" \
    --member="serviceAccount:$RUNTIME" --role=roles/secretmanager.secretAccessor
done
```

```powershell
# Windows
foreach ($s in 'db-password','jwt-secret','referral-signal-salt','cashfree-webhook-secret') {
  gcloud secrets create "draazy-sandbox-$s" --replication-policy=automatic
  gcloud secrets add-iam-policy-binding "draazy-sandbox-$s" `
    --member="serviceAccount:$RUNTIME" --role=roles/secretmanager.secretAccessor
}
```

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

The four values:

| Secret | Value |
|---|---|
| `draazy-sandbox-db-password` | the Supabase password |
| `draazy-sandbox-jwt-secret` | HS256, ≥ 32 bytes, per environment |
| `draazy-sandbox-referral-signal-salt` | any long random string, **never** the dev one |
| `draazy-sandbox-cashfree-webhook-secret` | from the Cashfree dashboard — required even with `CASHFREE_ENABLED` off, because a blank value makes every forged signature valid |

Generating the JWT secret:

| macOS | Windows |
|---|---|
| `openssl rand -base64 48` | see below |

```powershell
$bytes = New-Object byte[] 48
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$JWT = [Convert]::ToBase64String($bytes)
```

### 4.5 The deploy identity

```bash
gcloud iam service-accounts create github-deployer --display-name='GitHub Actions deployer'
DEPLOYER="github-deployer@$PROJECT_ID.iam.gserviceaccount.com"

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

The deployer needs **no** Secret Manager role — Cloud Run checks the *runtime* identity's grant when
it starts the container, not the caller's when it deploys.

> `key.json` is a **permanent** credential: it does not expire, and anyone holding it can push an
> image and read every secret the runtime can. It is covered by `.gitignore`, but this repository is
> public — destroy it the moment §5 has consumed it.

---

## 5 — GitHub environment

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
confirm box.

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

---

## 7 — Cloudflare R2

Optional for a first deploy — without `STORAGE_ENABLED` the app runs and uploads throw.

Create two buckets (public photos, private documents — ADR-013), then an API token, then add
`STORAGE_ENABLED=true` and the `R2_*` values.

**R2 must send its own CORS headers.** It is cross-origin from the SPA by design, and without
`Access-Control-Allow-Origin: https://sandbox.draazy.com` the browser-side perceptual hashing fails
at the canvas read — which surfaces as an upload that half-works, not as a CORS error anyone notices.

---

## 8 — Cloudflare Pages + the custom domain

### 8.1 Create the project

Workers & Pages → **Create** → **Pages** → connect the repo.

| Setting | Value |
|---|---|
| Root directory | `frontend` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node version | `20` or later |

### 8.2 Environment variables

Settings → Environment variables:

| Name | Value | Notes |
|---|---|---|
| `API_ORIGIN` | the Cloud Run URL from §6 | **not** a `VITE_` variable — read at request time by the Pages Function, never in the bundle. Scheme + host only, no path, no trailing slash |
| `VITE_API_BASE` | `/api` | relative, deliberately |
| `VITE_GOOGLE_MAPS_API_KEY` | your key | restrict it to HTTP referrers + Maps JavaScript API only, and set a quota cap |

Leave `VITE_PMF_MODE` unset.

If `API_ORIGIN` is missing the Function answers **502** rather than falling through — a fall-through
would return the HTML shell with a 200, which `http.js` reads as success and renders as a confident
"no results" on every catalogue.

### 8.3 Attach the domain — order matters

1. Pages project → **Custom domains** → **Set up a domain** → `sandbox.draazy.com`.
2. Because the zone is now on Cloudflare (§1.2), the CNAME is created for you. Confirm it.

Doing this in the other order — creating the DNS record before registering the domain on the Pages
project — produces a **522** and looks like an origin outage.

**Checkpoint:** `https://sandbox.draazy.com` serves the SPA, and:

```bash
curl -fsS https://sandbox.draazy.com/api/actuator/health
```

returns `UP` through the proxy. Both halves, one origin.

---

## 9 — Verification

`DEPLOY.md` §1 names the only test that matters, and Playwright structurally cannot perform it —
dev and e2e both go through the Vite proxy, where everything is same-origin by construction.

1. Sign in at `https://sandbox.draazy.com`.
2. **Wait past the 15-minute access-token expiry.** Do not refresh, do not navigate.
3. Make one authenticated request.

If it survives, the refresh cookie is being delivered *and* the edge forwards `Cookie` to the proxy
target. If the session dies, the cookie is being withheld silently and the server log is
indistinguishable from a visitor who was never signed in — go back to §1.1 and check that nothing
points a second hostname at the backend.

> **This test is blocked until WhatsApp OTP is live** (below), because step 1 is impossible. Do
> everything up to §8, then come back.

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

---

## If the organisation blocks public invocation

If your Google Cloud organisation enforces `constraints/iam.allowedPolicyMemberDomains`, the
workflow's "Allow public invocation" step fails — `allUsers` cannot be granted. Either exempt the
project, or accept that Cloudflare must authenticate to the origin. The latter is `DEPLOY.md` §4's
remediation 2 arriving early, and it means §4 stops being deferred: the Pages Function has to mint an
identity token.
