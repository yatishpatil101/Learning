# Deploying Draazy

The local counterpart is [`LOCAL_DEV.md`](./LOCAL_DEV.md). The *shape* of the deployment — Cloud Run
in `asia-south1`, Supabase Postgres in Mumbai, Cloudflare R2 — is decided in
[`system/platform-architecture.md`](./system/platform-architecture.md) §6 and ADR-007/ADR-013. This
file is the runbook: what to set, in what order, and which mistakes are silent.

> **Source of truth for the variable list is `ProdProfileContractTest`**, not this page. That test
> loads the real `application-prod.properties` and fails if a `${ENV}` lookup appears without being
> added to its checklist. If this page and that test disagree, the test is right.

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

Both take the same `postgres.<project-ref>` username, so `DB_USER` / `DB_PASSWORD` cover both and
Spring falls back to them for Flyway automatically. If you use the *direct* connection for
migrations instead (username `postgres`, and IPv4 is a paid add-on on new projects), supply
`SPRING_FLYWAY_USER` and `SPRING_FLYWAY_PASSWORD` as plain environment variables.

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
buyer. `application-sandbox.properties` adds the seed location back and is activated as
`SPRING_PROFILES_ACTIVE=prod,sandbox` — in that order, because it is a delta on prod, not a
replacement for it. A seeded database can never be promoted to production: point production at its
own Supabase project.

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
| `CASHFREE_WEBHOOK_SECRET` | a blank value makes every forged signature valid |
| `WEB_ORIGINS` | see §1 |
| `API_PUBLIC_ORIGIN` | see §1 |
| `INTERNAL_PROXIES` | see §4 |

`SPRING_PROFILES_ACTIVE=prod` is baked into the image (`backend/Dockerfile`) rather than left to the
deploy, because Spring does not complain about an absent profile — a deploy that forgot it would
boot on the developer defaults and report itself healthy.

Optional, all off by default: `STORAGE_ENABLED` + `R2_*` (photo and document upload — without them
`R2FileStorage` is not wired and uploads throw), `CASHFREE_ENABLED` + `CASHFREE_APP_ID` /
`CASHFREE_SECRET_KEY` (KYC), `APP_BASE_URL`, `RATELIMIT_STORE`.

---

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

## 5. Order of operations

1. **Container builds and boots.** `docker build -t draazy-api backend/` then run it against the
   Supabase sandbox project with the §3 variables and `SPRING_PROFILES_ACTIVE=prod,sandbox`.
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
3. **R2 keys**, then one photo upload end-to-end. R2 is cross-origin from the SPA and must supply
   `Access-Control-Allow-Origin` itself, or browser-side perceptual hashing fails on the canvas read.
4. **Deploy job in CI.** `.github/workflows/ci.yml` currently has five jobs, all test and lint;
   nothing builds or pushes an image.

---

## 6. Known blockers

- **Nobody can log in.** `SmsOtpSender` — selected on every non-`dev` profile — is literally
  `throw new UnsupportedOperationException("SMS OTP provider not configured for prod yet")`. A
  gateway must be wired, or a sandbox-only sender chosen deliberately by name, before the first
  useful deploy. **Before wiring a real gateway, add a spend cap on the gateway account**:
  `OtpService` throttles per *recipient*, so walking thousands of valid-looking numbers gets a fresh
  budget for each one and turns the endpoint into a financial DoS.
- **No image build or deploy in CI** (see §5.4).
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
