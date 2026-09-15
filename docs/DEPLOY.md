# Deploying Draazy

The local counterpart is [`LOCAL_DEV.md`](./LOCAL_DEV.md). The *shape* of the deployment — Cloud Run
in `asia-south1`, Supabase Postgres in Mumbai, Cloudflare R2 — is decided in
[`system/platform-architecture.md`](./system/platform-architecture.md) §6 and ADR-007/ADR-013. This
file is the runbook: what to set, in what order, and which mistakes are silent.

> **Source of truth for the variable list is `ProdProfileContractTest`**, not this page. That test
> loads the real `application-prod.properties` and fails if a `${ENV}` lookup appears without being
> added to its checklist. If this page and that test disagree, the test is right.

> **Performing a deploy rather than reading about one?** Go to
> [`DEPLOY_WALKTHROUGH.md`](./DEPLOY_WALKTHROUGH.md) — the same ground as a single ordered sequence
> across all six components (Supabase, container, GCP, GitHub, Cloud Run, Cloudflare Pages + the
> GoDaddy domain), with macOS and Windows commands side by side. It links back here for the *why* of
> any individual value. Where the two disagree about a value, this page wins; about order, it does.

---

## 1. The one rule that governs the whole topology

**The SPA and `/api` must be same-*site*.** The refresh token rides a `SameSite=Lax`, `__Host-`
prefixed cookie, so a browser only returns it when the page and the API share a registrable domain.
Two arrangements satisfy that:

| Shape | `WEB_ORIGINS` | `API_PUBLIC_ORIGIN` |
|---|---|---|
| **Path proxy** (chosen) — one origin, `/api/*` proxied to the backend | `https://sandbox.draazy.com` | `https://sandbox.draazy.com` |
| Sibling subdomains — cross-origin but same-site | `https://www.draazy.com` | `https://api.draazy.com` |

A UI served from its own registrable domain — `*.netlify.app`, `*.pages.dev`, `*.vercel.app`, all
Public Suffix List entries — is **fatal**, and fatal in the worst way: the browser withholds the
cookie *silently*, so every session dies fifteen minutes after login and the server log is
indistinguishable from a visitor who was never signed in. `CookieDeliveryCheck` refuses to boot on
that shape, which is the only reason it is caught at all — no test can reach it, because dev and e2e
go through the Vite proxy where everything is same-origin by construction.

Note that this rules out running the sandbox on its `*.pages.dev` preview URL. The custom domain has
to be attached before anyone can stay signed in.

The path proxy was chosen because it is the only one of the two that can also deliver the readable
`__Host-draazy_session` marker, without which the Safari/ITP session recovery is inert.

### How the proxy is implemented

`frontend/functions/api/[[path]].js` — a Cloudflare Pages Function, not a `_redirects` rule.
**Cloudflare Pages does not proxy `_redirects` to an external origin**; it redirects to it, which
lands the browser on the backend's origin and loses the cookie exactly as described above. Netlify
did proxy such a rule, which is why `scripts/gen-redirects.mjs` existed and why it was deleted
rather than carried over — kept, it would have produced a deploy that looked configured and was not.

Pages resolves Functions before static assets and before `_redirects`, so the SPA fallback in
`frontend/public/_redirects` cannot shadow `/api`. The `/api` prefix is forwarded verbatim because
the backend runs with `server.servlet.context-path=/api`. The Function's own configuration is a
single Pages environment variable, `API_ORIGIN` (scheme + host of the Cloud Run service, no path);
unset, it answers 502 rather than falling through — a fall-through would return the HTML shell with
a 200, which `http.js` reads as success and renders as an affirmative "no results" on every
catalogue.

Security headers and the CSP moved to `frontend/public/_headers`, values unchanged from the Netlify
config.

**Release note (L2):** the first deploy carrying the `__Host-` cookie names signs every
already-signed-in user out once. Nothing is lost; the next sign-in is normal.

---

## 2. Database — Supabase (ADR-007)

Supabase is used as **plain Postgres**. Its Auth, Realtime and Edge Functions are unused, we run our
own Flyway migrations and our own JWTs, and that is what keeps the lock-in low enough to leave.

You need **two** connection strings, and this is the part that costs a day if it is guessed:

| Variable | Supabase connection | Port | Why |
|---|---|---|---|
| `DB_URL` | Supavisor pooler, **transaction** mode | `6543` | Cloud Run scales to zero and back; every cold start would otherwise open fresh backends against a free-tier connection ceiling measured in dozens |
| `FLYWAY_DB_URL` | Supavisor pooler, **session** mode | `5432` | Flyway locks concurrent deploys out with `pg_advisory_lock`, which is *session*-scoped. Transaction pooling moves the session between statements, so the lock is taken on one backend and released against another — Flyway's own docs call PgBouncer transaction mode unsupported |

Both take the same `postgres.<project-ref>` username, so `DB_USER` / `DB_PASSWORD` cover both;
`application-prod.properties` and `application-sandbox.properties` bind them to `spring.flyway.user`
and `spring.flyway.password` explicitly because Spring Boot's dedicated Flyway DataSource does not
inherit them from `spring.datasource` when `spring.flyway.url` is set. If you use the *direct* connection
for migrations instead (username `postgres`, and IPv4 is a paid add-on on new projects), supply
`SPRING_FLYWAY_USER` and `SPRING_FLYWAY_PASSWORD` as plain environment variables to override them.

Getting `FLYWAY_DB_URL` wrong does not fail cleanly. The migration hangs holding a lock nobody owns,
the container never passes readiness, and nothing in the log names Flyway.

Append `?sslmode=require` to both. `application-prod.properties` already pins
`prepareThreshold=0` (the transaction pooler cannot keep server-side prepared statements alive; the
symptom is an intermittent `prepared statement "S_1" does not exist` on the busiest endpoints only)
and a small, drainable HikariCP pool.

**The sandbox carries the demo seed, and it takes a named profile to get it.**
`spring.flyway.locations` is migration-only under `prod`, deliberately —
`R__zz_DML_dev_demo_data.sql` is *repeatable*, so it would re-seed 38 fabricated listings and 78
fabricated users on every deploy whose checksum moved, indistinguishable from real inventory to a
buyer. `application-sandbox.properties` is a standalone profile activated as
`SPRING_PROFILES_ACTIVE=sandbox` — a self-contained copy of the prod configuration whose one
declared difference is that it adds the seed location back. A seeded database can never be promoted
to production: point production at its own Supabase project.

Sandbox and production read the same variable *names* and entirely different *values* — separate
Supabase projects, separate Secret Manager entries, separate Cashfree credentials.
`SandboxProfileContractTest` asserts the two files stay identical apart from the declared
divergence, so hardening prod without hardening sandbox fails the build.

All four tiers are in [`system/profiles.md`](./system/profiles.md).

---

## 3. Environment

Every variable below is declared with **no default**, so a deploy that omits one fails to start
rather than inheriting the developer values in `application.properties` (local Postgres credentials,
a committed JWT secret, `trusted-proxies=none`). That is the design, not an inconvenience.

| Variable | Notes |
|---|---|
| `DB_URL` | transaction pooler, `:6543`, `sslmode=require` |
| `DB_USER` / `DB_PASSWORD` | `postgres.<project-ref>` |
| `FLYWAY_DB_URL` | session pooler, `:5432` — see §2 |
| `JWT_SECRET` | HS256, ≥ 32 bytes, generated per environment |
| `REFERRAL_SIGNAL_SALT` | any long random string; **never** shared with dev. Rotating it is safe — stored digests simply stop matching, and they are discarded after 90 days anyway |
| `IDENTITY_HASH_SECRET` | any long random string; **never** shared with dev. Keys the one-way digest of verified ID-document numbers used for "one document = one badge". Rotating it makes every existing badge's digest stop matching new submissions, so rotate only with a re-verification plan |
| `CASHFREE_WEBHOOK_SECRET` | a blank value makes every forged signature valid |
| `WEB_ORIGINS` | see §1 |
| `API_PUBLIC_ORIGIN` | see §1 |
| `INTERNAL_PROXIES` | see §4 |

`SPRING_PROFILES_ACTIVE=prod` is baked into the image (`backend/Dockerfile`) rather than left to the
deploy, because Spring does not complain about an absent profile — a deploy that forgot it would
boot on the developer defaults and report itself healthy.

### 3.1 The sandbox login code — a stand-in for OTP delivery

Sandbox cannot send an OTP. WhatsApp is off while ADR-020 waits on Meta business verification, so
`SandboxOtpSender` accepts the send and drops it, and before this existed the shared environment
could not be signed into at all. `draazy.otp.sandbox-code` pins every code to one value so it can be
typed into the six-box OTP field like any other. It is **`000000`, hardcoded** in
`application-sandbox.properties` — the same code the e2e profile uses. Nothing to provision.

**Understand what this opens before you put anything real in that environment.** The demo seed
creates one `admin` and fifteen `staff` accounts, their mobiles are committed in
`R__zz_DML_dev_demo_data.sql`, and mobile-OTP login resolves a user by mobile without ever consulting
`password_hash`. There is also no network control in front of it: `cloudrun-sandbox.yaml` sets
`ingress: all` because Cloudflare Pages Functions reach the service from the public internet, so it
cannot be narrowed to IAM or internal-only without breaking the site.

So the sandbox back office is open to anyone who finds the URL and types the obvious code. That is an
acceptable trade for disposable demo inventory and a deliberate one — it is not a gap to be reported.
It stops being acceptable the moment the sandbox database holds anything you would not publish; at
that point make the code a generated per-deploy secret in Secret Manager.

It is a key of its own rather than a reuse of `DRAAZY_OTP_FIXED_CODE` on purpose. That one is refused
on *every* deployment profile by `OtpService.rejectFixedCodeInProduction`, and sandbox counts as one,
so reusing it would have disarmed the guard that also covers prod.
`OtpService.rejectSandboxCodeOutsideSandbox` is the matching lock on the new key: the boot fails
unless `sandbox` is the *only* deployment profile active, so neither a copied properties file nor a
`prod,sandbox` activation can carry it into production. `application-prod.properties` also pins the
key empty, so a properties-only mistake never reaches that check.

One deploy consequence: the Dockerfile bakes in `SPRING_PROFILES_ACTIVE=prod`, so a sandbox deploy
has to override it to `sandbox` — and to `sandbox` alone. Left at `prod`, or set to `prod,sandbox`,
the boot fails on this key, which is the intended way to discover the mistake.

Optional, all off by default: `STORAGE_ENABLED` + `R2_*` (photo and document upload — without them
`R2FileStorage` is not wired and uploads throw), `CASHFREE_ENABLED` + `CASHFREE_APP_ID` /
`CASHFREE_SECRET_KEY` (KYC), `APP_BASE_URL`, `RATELIMIT_STORE`.

---

### 3.2 The public photo bucket must send `Access-Control-Allow-Origin`

A listing photo is not only rendered. The create-listing wizard draws each one to a `<canvas>` to
compute a perceptual hash, which the duplicate probe compares across owners, and reading pixels back
from a canvas that has drawn a cross-origin image throws unless that image arrived with CORS headers.

The failure is silent by construction: the client degrades to no hashes, the listing posts normally,
and the only symptom is that duplicate listings sharing photographs stop being flagged. Nothing in
the repository can assert it — the URL is R2's, the header is bucket configuration, and the dev
stand-in is same-origin (`DevObjectStore.publicUrl`), so no test will ever go red if the rule is
missing. It is written down because that is the only control available.

## 4. `INTERNAL_PROXIES` — the value that has no safe guess

`WriteRateLimitFilter` keys anonymous callers on the client address, and `POST /page-views` is
`permitAll` and fires on ordinary browsing — so the 120-writes-per-60s budget is consumed by
*traffic*, not by attackers. Get this wrong in either direction and it is an outage:

- **Too narrow / `none`** behind a proxy: every visitor arrives as the proxy's address, the whole
  internet lands in one bucket, and the limiter becomes the outage it was added to prevent.
- **Too permissive**: the backend is still directly reachable at its own host, so anyone matching the
  regex picks their own bucket by sending an `X-Forwarded-For` of their choosing. An in-app limiter
  that can be spoofed is worse than none, because it reads as protection.

It must be a **Java regex** matching the actual egress of whatever sits in front of the app, or the
literal `none` for a directly-exposed instance. `TrustedProxyConfig` validates it at boot and names
the property when it is wrong.

On the chosen Cloudflare Pages → Cloud Run shape there are **two** hops. `frontend/functions/api/[[path]].js`
sets `X-Forwarded-For` from `CF-Connecting-IP`, overwriting anything the client sent and refusing to
forward at all if that header is absent; then Cloud Run's own front end appends the caller's address
before Tomcat sees the request. So the regex has to match Google's internal proxy range at minimum.

**And that is not yet enough, which is why this variable is still unset.** Adding Cloudflare's
egress ranges makes the value spoofable, because those addresses are **shared with every other
Cloudflare account**: anyone who learns the `*.run.app` URL can deploy their own free Worker,
`fetch` the origin directly with a forged `X-Forwarded-For`, and have `RemoteIpValve` pop the
Cloudflare hop and adopt the attacker's chosen address. That buys unlimited rotation of the
anonymous write budget, satisfies `BotDefenceFilter.verify` for arbitrary addresses, and — run the
other way — lets one address be pinned to a victim's IP to 429 them off the platform. Leaving
Cloudflare out instead collapses all anonymous traffic into the single Cloudflare-egress bucket.
Neither option is safe on its own.

The exit is to make the origin able to tell *this* proxy apart from any other Cloudflare tenant.
Three ways, in ascending order of work:

1. **Shared secret.** The Function sends `X-Proxy-Auth: ${ORIGIN_SHARED_SECRET}`; a filter ordered
   ahead of `WriteRateLimitFilter` rejects anything without it, constant-time compared. Roughly
   forty lines plus one more entry in the deploy contract. Also makes the Cloud Run URL leaking
   stop mattering.
2. **Restricted ingress**, so the service is unreachable except through the proxy — which is the
   assumption every trusted-proxy scheme silently makes.
3. **Cloudflare Authenticated Origin Pulls** (mTLS), verified at the origin. Strongest, no secret to
   rotate, most setup, and awkward to exercise locally.

**Decision deferred** (2026-09-02). Until one is in place, treat the anonymous rate limiter as
advisory rather than enforcing, and do not open the sandbox to untrusted traffic.

Whatever the choice, set `INTERNAL_PROXIES` **last**, against the `X-Forwarded-For` a real deployed
request actually produces rather than a published range taken on faith.

---

## 5. Google Cloud — one-time bootstrap

Run once per environment, by a human, from a machine with `gcloud` authenticated as a project owner.
Deliberately **not** scripted: half of it creates secrets whose values only you know, and a bootstrap
script that dies in the middle leaves a project in a state nobody can read.

The service definition itself is `backend/deploy/cloudrun-sandbox.yaml`, rendered through `envsubst`
by the backend job — the `${…}` tokens are the only per-environment inputs and everything else is a
deliberate literal, reviewable here rather than guessed at deploy time. `replace` makes that file the
whole truth: anything a console click added out of band is removed on the next deploy.

Five settings in it encode consequences that are invisible from the console:

| Setting | Value | Why not the default |
|---|---|---|
| `autoscaling.knative.dev/maxScale` | `4` | Each instance opens up to 5 Postgres connections (`spring.datasource.hikari.maximum-pool-size`), so the ceiling multiplies straight into Supabase's budget: 4 × 5 = 20, which the free-tier pooler absorbs. At the default of 100 the same arithmetic gives 500 and the database refuses connections under a spike — arriving as scattered 500s on unrelated endpoints, never as anything naming the pool. It is also the runaway-cost stop: a crawler cannot cost more than four instances' compute. |
| `containerConcurrency` | `40` | Tomcat accepts 200 by default and then parks 195 of them on Hikari until its 30-second connection timeout expires, which surfaces as slow 500s rather than honest backpressure. Forty keeps the queue short enough that Cloud Run scales out instead. |
| `timeoutSeconds` | `120` | Well past any normal request; short enough that a hung one releases its database connection rather than holding it for the platform default of five minutes. The only legitimate slow request is a 13 MB multipart upload (`spring.servlet.multipart.max-request-size`) over a slow mobile uplink. |
| `resources.limits.memory` | `1Gi` | The Dockerfile sets `-XX:MaxRAMPercentage=75.0`, so this is a 768 Mi heap with ~256 Mi for metaspace, thread stacks and code cache — which Spring Boot 4 plus Hibernate genuinely uses. At 512 Mi the same percentage leaves 128 Mi of non-heap and the container is OOM-killed during startup, after the health check has already begun waiting. |
| `startupProbe` | HTTP, `30 × 5s` | A TCP probe passes the moment Tomcat binds, so Cloud Run would route traffic to a context that is not finished refreshing. The path carries `/api` because `server.servlet.context-path` moves the actuator too. 150 seconds of grace is for the deploy that carries a slow migration — exactly when a tight probe would roll back a good release. `livenessProbe` watches the `liveness` group, which deliberately excludes the database indicator: restarting the container is no part of the remedy for Supabase being down. |

`SPRING_PROFILES_ACTIVE=sandbox` is set on the service, overriding the `prod` baked into the image.
`application-sandbox.properties` is standalone rather than a delta — its own datasource, secrets,
cookie flags, OTP throttle and proxy CIDR — and `SandboxProfileContractTest` asserts it agrees with
prod on every security-critical key. `WEB_ORIGINS` and `API_PUBLIC_ORIGIN` are public literals;
`CookieDeliveryCheck` refuses to boot if they describe a cross-site shape. `DB_URL`, `FLYWAY_DB_URL`
and `DB_USER` are rendered from repository secrets because the repository is public and they name the
Supabase project — that is about not committing them, not about confidentiality afterwards: as
plaintext env values they are readable by any project viewer and recorded in the Admin Activity audit
log for 400 days.

Secrets use `key: latest` rather than a pinned version, so a rotation reaches the next revision
without editing the file — and so a bad rotation reaches it the same way. The consequence worth
knowing: the SHA-tagged image makes *redeploy a known tag* a complete rollback for **code** and not
for **secrets**. Yesterday's image still picks up today's `latest` `JWT_SECRET`, which invalidates
every issued token. The two Cashfree secrets are referenced unconditionally and must **exist** before
the first deploy even though `CASHFREE_ENABLED` is `false` — a `secretKeyRef` to a missing secret is a
hard error, not an empty string. Create them with a placeholder; `CashfreeClient` is not instantiated
while the flag is off, so it never reads them.

```bash
PROJECT_ID=draazy-sandbox          # your project
REGION=asia-south1                 # Mumbai, co-located with Supabase (ADR-007). NOT CHANGEABLE LATER.
SERVICE=draazy-api-sandbox

gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com

# Image registry, in the same region as the service. A cross-region pull adds latency to the cold
# start, which is already the slowest request the platform serves.
gcloud artifacts repositories create draazy --repository-format=docker --location="$REGION"

# Runtime identity. One role. Cloud Run's default is the Compute Engine service account, which
# carries project Editor — a container compromise there is a compromise of the whole project.
gcloud iam service-accounts create "$SERVICE" --display-name="Draazy API (sandbox) runtime"
RUNTIME="$SERVICE@$PROJECT_ID.iam.gserviceaccount.com"

# Five secrets, one active version each — inside Secret Manager's free allowance of six.
for s in db-password jwt-secret referral-signal-salt cashfree-webhook-secret identity-hash-secret; do
  gcloud secrets create "draazy-sandbox-$s" --replication-policy=automatic
  gcloud secrets add-iam-policy-binding "draazy-sandbox-$s" \
    --member="serviceAccount:$RUNTIME" --role=roles/secretmanager.secretAccessor
done
```

Then add each value — **piped, never as an argument**, because a command line lands in shell history
and in the process table:

```bash
printf '%s' "$THE_VALUE" | gcloud secrets versions add draazy-sandbox-jwt-secret --data-file=-
```

`JWT_SECRET` is HS256 and must be at least 32 bytes, generated per environment —
`openssl rand -base64 48`. `REFERRAL_SIGNAL_SALT` is any long random string and must never be the dev
one. An unsalted or publicly-salted digest of an IPv4 address is reversed by enumerating 2^32 values,
which turns a fraud signal into a stored address — so prod carries no default, though the base file
does for local runs. `CASHFREE_WEBHOOK_SECRET` is required even though `CASHFREE_ENABLED` is off,
because a blank value makes every forged signature valid. `IDENTITY_HASH_SECRET` is the one secret
here that is **set-once rather than rotatable**: it keys the digest that makes one document grant one
badge, so a new value silently turns every existing holder into a stranger the uniqueness check has
never seen.

### The deploy identity

The backend job in `.github/workflows/deploy.yml` authenticates by **Workload Identity Federation**,
so no GCP credential is stored anywhere in the repository: GitHub mints a short-lived OIDC token and
GCP exchanges it for an access token that expires in about an hour. §5.1 below defines the trust, and
the whole of it rests on the provider's attribute condition — a pool created without one mints tokens
for any repository on earth that knows the provider's resource name, and that name is public.

The deployer service account therefore has **no key to rotate**. If one was ever created, delete it
(`gcloud iam service-accounts keys list --iam-account="$DEPLOYER"`) and delete the `GCP_SA_KEY`
secret with it; a key that still exists is a permanent credential regardless of whether the workflow
uses it. Keep its roles to these three.

```bash
gcloud iam service-accounts create github-deployer --display-name="GitHub Actions deployer"
DEPLOYER="github-deployer@$PROJECT_ID.iam.gserviceaccount.com"

# Scoped to the runtime service account, NOT the project. This is the grant that decides whether a
# leaked deploy key is a deploy-path compromise or a project takeover: at project level,
# serviceAccountUser confers actAs on EVERY service account in the project, including the default
# Compute Engine one — which carries Editor. The holder would deploy a container running as it and
# own the project, defeating the whole point of giving the runtime identity a single role.
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME" \
  --member="serviceAccount:$DEPLOYER" --role=roles/iam.serviceAccountUser

# Scoped to the one repository. The deployer pushes images; it has no business reading or deleting
# any other repository the project acquires later.
gcloud artifacts repositories add-iam-policy-binding draazy --location="$REGION" \
  --member="serviceAccount:$DEPLOYER" --role=roles/artifactregistry.writer

# The one grant that stays project-wide, and knowingly. Cloud Run IAM cannot be scoped to a service
# that does not exist yet, and this role creates it. `run.admin` rather than `run.developer` because
# the workflow's "Allow public invocation" step calls setIamPolicy, which developer lacks.
#
# THE COST: on this project the deploy key can describe every Cloud Run service and read its
# plaintext environment. Tighten it after the first successful deploy by swapping the binding for a
# service-scoped one — `gcloud run services add-iam-policy-binding "$SERVICE" --region "$REGION"
# --member="serviceAccount:$DEPLOYER" --role=roles/run.admin` — and removing the project binding.
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$DEPLOYER" --role=roles/run.admin

gcloud iam service-accounts keys create key.json --iam-account="$DEPLOYER"
```

The deployer needs **no** Secret Manager role. Cloud Run checks the *runtime* identity's
`secretAccessor` grant when it starts the container, not the caller's when it deploys.

Paste `key.json` into the GitHub **environment** `sandbox` as `GCP_SA_KEY`, then **delete the local
file** — `shred -u key.json`. Also on that environment:

| Kind | Name | Value |
|---|---|---|
| variable | `GCP_PROJECT_ID` | the project id |
| secret | `SANDBOX_DB_URL` | transaction pooler, `:6543` (§2) |
| secret | `SANDBOX_FLYWAY_DB_URL` | session pooler, `:5432` (§2) |
| secret | `SANDBOX_DB_USER` | `postgres.<project-ref>` |

The connection strings are repository secrets rather than variables for one reason only: **this
repository is public, and they name the Supabase project.** That is about not committing them, not
about confidentiality after deploy — they reach Cloud Run as plaintext environment values, readable
by any project viewer and recorded verbatim in the Admin Activity audit log for 400 days. Treat the
project ref as known to anyone with access to the GCP project; the password, which is the thing that
matters, never leaves Secret Manager.

**Decide the deployment branch policy on the `sandbox` and `sandbox-web` environments.**
`workflow_dispatch` accepts any ref, and the workflow's confirmation input checks the environment
name rather than `github.ref` — so under "All branches", anyone with write access can deploy an
unreviewed branch, including one that edits `cloudrun-sandbox.yaml` to name a different runtime
service account, or one that edits `frontend-publish` to exfiltrate the Cloudflare token. Restricting
the policy to `main` closes that and costs the ability to deploy a feature branch — which is the
reason the trigger is manual in the first place. Sandbox keeps "All branches" deliberately; a
production environment must not. Either way the environment setting is the right place for the
decision, because it cannot be changed by the same pull request that would abuse it.

**If the organisation enforces `constraints/iam.allowedPolicyMemberDomains`**, the workflow's
"Allow public invocation" step fails: `allUsers` cannot be granted. Either exempt the project from
the policy or accept that Cloudflare must authenticate to the origin, which is remediation 2 in §4
arriving early — in which case §4 stops being deferred and the Pages Function needs to mint an
identity token.

### 5.1 Workload Identity Federation, and the gates in front of it

`bootstrap-project.sh` wires the deploy identity with Workload Identity Federation instead of the
JSON key above: GitHub mints a short-lived OIDC token for the deploy job and GCP exchanges it for an
access token valid about an hour, so the repository stores no permanent credential. `GCP_WIF_PROVIDER`
and `GCP_DEPLOYER_SA` are environment **variables**, not secrets — a provider resource name and a
service-account email are identifiers, and holding them as secrets would imply the exchange is gated
on knowing them.

**The provider's attribute condition is the whole security boundary.** The provider resource name is
printed in a public workflow file. Without a condition, any repository on GitHub that reads it can
mint a token against the pool. `bootstrap-project.sh` pins two claims:

- `assertion.repository == 'owner/repo'` — checked against a claim the subject template cannot rewrite.
- `assertion.sub == 'repo:OWNER@OWNER-ID/REPO@REPO-ID:environment:sandbox'` — narrows the grant from
  the repository to **one job in it**. `assertion.repository` alone is satisfied by any workflow here
  holding `id-token: write`, including one added later by a pull request. GitHub only puts
  `environment` in the subject for a job that declares one, so requiring it makes `environment:
  sandbox` load-bearing for credential *issuance* rather than bookkeeping — and puts that
  environment's reviewer and branch policies genuinely in front of GCP.

Two ways to get that string wrong, both of which fail every deploy with a permission error that names
neither cause:

- **The environment name is compared as a string, including case.** Creating it in the UI as
  "Sandbox", or renaming `jobs.deploy.environment` in the workflow alone, breaks the exchange. Change
  both sides together and re-run the bootstrap script, which re-applies the trust.
- **The subject carries numeric IDs.** Repositories created after 2026-07-15 use GitHub's immutable
  subject format (`repo:OWNER@OWNER-ID/REPO@REPO-ID:...`); this one was created 2026-07-25. The
  `repo:OWNER/REPO:...` shape most tutorials show matches nothing here. The IDs are the point: they
  survive a rename or a transfer. Verify with `github/actions-oidc-debugger` if a deploy fails on it.

The service-account binding uses `principal://...subject/`, not
`principalSet://...attribute.repository/`, so both halves agree on the same scope — binding on the
repository attribute would grant deploy rights to every job in the repo and leave the provider
condition as the only thing refusing them.

**The deploy is manual, and that moves the second boundary.** `deploy.yml` has no push trigger and
no `workflow_run` trigger: nothing reaches Cloud Run or Cloudflare until someone opens Actions →
Deploy (sandbox) → Run workflow, picks a ref, and types `sandbox`. That removes the `workflow_run`
fork-pull-request problem outright — `workflow_run` hands the triggered workflow secrets and a write
token even when the triggering run had neither, and `branches: [main]` never guarded it because a
fork can name a branch `main` ("Preventing pwn requests", GitHub Security Lab). With the trigger
gone, no event an outsider can cause starts a job holding these credentials.

It also removes every automatic gate. **The workflow ships the ref you point it at and does not read
its CI result**, because a feature branch has no CI run to read — `ci.yml` runs on `push` to `main`
and on `pull_request`, so a branch pushed without a PR has none at all. Nothing checks that the
commit is the head of anything, either: dispatching an old ref will roll Cloud Run and its migrations
backwards without a warning. Read the checks on the commit before dispatching; the confirmation input
and the environment branch policy are the only things between the form and a live
`gcloud run services replace`.

### What the eight `@Scheduled` sweeps do here — nothing

Cloud Run allocates CPU **only while a request is in flight**. Between requests the JVM's scheduler
thread is frozen, so `fixedDelay` timers do not advance; an instance that never accumulates five
minutes of *CPU* time never reaches its first tick, and every sweep in the codebase uses a five
minute `initialDelay`. Nothing logs the non-execution.

On the sandbox this is accepted. It cannot ship to production: subscriptions keep entitling after
they lapse, abandoned checkouts never clear, and `page_views` grows unpruned against a 500 MB
database. The intended fix is already designed —
`docs/system/platform-architecture.md` §5.6 specifies Cloud Scheduler calling an OIDC-authenticated
job runner — and was simply never built; the code reached for `@Scheduled` instead. Always-on CPU
would also work and costs roughly USD 10–25/month, because it takes the service off the request-billed
free tier entirely.

---

## 6. Order of operations

1. **Container builds and boots.** `docker build -t draazy-api backend/` then run it against the
   Supabase sandbox project with the §3 variables and `SPRING_PROFILES_ACTIVE=sandbox`.
   Success is `GET /api/actuator/health` returning `UP` — note the `/api` prefix,
   `server.servlet.context-path=/api` moves the probes too. Migrations having run is implied:
   `spring.jpa.hibernate.ddl-auto=validate` means a boot that completes has proved the entities
   still match the schema.
2. **Cloudflare Pages**, building `frontend/` (`npm run build`, output `dist`), with `API_ORIGIN`
   set to the Cloud Run URL. Attach `sandbox.draazy.com` — the `*.pages.dev` URL cannot be used for
   anything requiring a session (§1). Then the only verification that exists for the cookie
   topology: sign in, wait past the 15-minute access-token expiry, make one authenticated request.
   If it survives, the refresh cookie is being delivered *and* the edge forwards `Cookie` to the
   proxy target. Playwright structurally cannot cover this.

   **Then disconnect the git integration** (Pages → Settings → Builds & deployments). From step 4
   the frontend is published by direct upload from CI, and that deploy is manual — so an integration
   left connected is the only thing still building on a push, and it will quietly replace whatever
   you deployed on purpose with the head of whatever branch was pushed. If the project refuses to
   disconnect, create a Direct Upload project and move the custom domain to it.

   `API_ORIGIN` stays configured **on the project**, not in the workflow. Direct uploads do not
   touch project environment variables, so it survives every deploy — and it names the Cloud Run
   service, which is infrastructure rather than build input.
3. **R2 keys**, then one photo upload end-to-end. R2 is cross-origin from the SPA and must supply
   `Access-Control-Allow-Origin` itself, or browser-side perceptual hashing fails on the canvas read.
4. **Deploy pipeline.** `.github/workflows/deploy.yml` — **manual only.** Actions → Deploy (sandbox)
   → Run workflow, pick any branch or tag in "Use workflow from", type `sandbox`, choose `both` /
   `backend` / `frontend`. Nothing deploys on a push. It requires the §5 bootstrap to exist first.

   It ships **both halves from one commit, backend first**. The backend job builds the image,
   pushes it to Artifact Registry tagged with the commit SHA, and applies the service definition
   with `gcloud run services replace` rather than `deploy`: `replace` makes the file the whole
   truth, so a setting deleted from the repo is deleted from the service instead of lingering
   forever. `frontend-build` then builds `frontend/` and `frontend-publish` ships it with
   `wrangler pages deploy`, tagged with the same SHA so both dashboards name one commit.

   The order is not arbitrary. API changes here are additive (expand/contract), which makes the
   asymmetry total: an old UI always works against a new backend, and a new UI does not work
   against an old one. The frontend will not start until the backend's smoke test is green.

   Nothing is gated on CI, because the ref you pick need not have one — see §5.1. The `target`
   input is the whole decision: there is no path diff and no test-result lookup.

   **The frontend is two jobs, and the split is a security boundary.** `frontend-build` runs
   `npm ci` and `npm run build` — which execute dependency and project scripts — and holds no
   deploy credential and declares no environment. It hands `dist/` and `functions/` to
   `frontend-publish` as an artifact; that job checks out nothing, so `npx wrangler` cannot be
   redirected by an `.npmrc` or a shadowing `node_modules/wrangler` planted during the build. It
   uses a **separate environment, `sandbox-web`**, holding only the Cloudflare credentials: GitHub
   writes the environment name into the OIDC subject and the GCP provider is pinned to
   `:environment:sandbox`, so the publish job cannot mint Cloud Run credentials even if it is later
   granted `id-token: write`.

   **Two build-time hazards live in the frontend half.** Every `VITE_*` value is inlined by Vite at
   build time and every read in `src/` has a fallback, so a missing one produces a bundle that
   boots and is quietly broken in one feature; the build fails closed on `VITE_GOOGLE_MAPS_API_KEY`
   for that reason. And `wrangler pages deploy` finds `functions/` by convention relative to the
   working directory, so it must run from a directory where `functions/` sits beside `dist/` —
   run anywhere else it uploads the static assets alone, succeeds, and ships a site whose `/api`
   calls fall through to the SPA rule and return `index.html` with a **200**, which `http.js` reads
   as a successful empty response. The final smoke test asserts the *content type* of
   `/api/actuator/health` through `sandbox.draazy.com` precisely because the status code cannot
   tell those apart.

---

## 7. Known blockers

- **Nobody can log in on `prod` until WhatsApp is configured.** `UnconfiguredOtpSender` — selected on
  every profile except `local` and `sandbox` while `draazy.providers.whatsapp.enabled` is false —
  throws on every send. (`sandbox` is the exception: it uses a hardcoded login code, §3.1.) Set
  the flag plus the `WHATSAPP_*` credentials (ADR-020: `WHATSAPP_PHONE_NUMBER_ID`,
  `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_OTP_TEMPLATE_NAME`, `WHATSAPP_OTP_TEMPLATE_LANG`) before the
  first useful deploy. The token must be a **System User** token; the one the App Dashboard offers
  expires in 24 hours. **Before turning the flag on, add a spend cap on the Meta billing account**:
  `OtpService` throttles per *recipient*, so walking thousands of valid-looking numbers gets a fresh
  budget for each one. On WhatsApp that is worse than a bill — sends to non-WhatsApp numbers drag
  the sending number's quality rating down, which cuts the daily messaging limit and takes sign-in
  itself offline days later.
- **The eight `@Scheduled` sweeps do not run on Cloud Run.** CPU throttling freezes the scheduler
  thread between requests, so no timer advances — see §5. Accepted on the sandbox, fatal for
  production. This is a **drift from ADR-011**, which chose Cloud Scheduler → `/internal/jobs/run`
  and explicitly deferred native `@Scheduled` until `min-instances=1` *and* ShedLock; the code took
  the mechanism without either precondition. `platform-architecture.md` §4.3 / ADR-021 costs the
  alternative that removes the problem instead of working around it.
- **The frontend still seeds its mock store** into every visitor's `localStorage` from `main.jsx`,
  including on a fully-live build.
- **Backups.** Supabase's free tier has limited backups and no PITR. A scheduled logical dump to R2
  is the stopgap until Pro is justified.
- **The anonymous rate limiter is bypassable until §4 is decided.** Not a boot failure and not
  visible in any log — it simply does not do what it looks like it does.
- **Postgres TLS is `require`, not `verify-full`.** `application-prod.properties` pins `sslmode` so
  pgjdbc's default `prefer` cannot silently fall back to plaintext on the Cloud Run → Supabase hop,
  but `require` does not authenticate the server, so an active MITM is still possible. Raising it
  means baking the Supabase CA into the image and adding `sslrootcert`; `FLYWAY_DB_URL` needs the
  same, in the URL itself, because Flyway builds its own DataSource and the Hikari property does not
  reach it.
