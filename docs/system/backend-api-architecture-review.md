# PuneNest — Backend API Architecture Review

> **Audience:** Architecture Review Board / backend implementation team.
> **Scope:** Reverse-engineered backend architecture for the PuneNest real-estate
> marketplace, derived from the React frontend prototype and the existing system docs.
> **Companion artifacts:**
> - [`data-model.md`](./data-model.md) — ER map + persistence design (field shapes live in the OpenAPI schemas).
> - [`app-architecture.md`](./app-architecture.md), [`cross-cutting.md`](./cross-cutting.md) — auth, roles, gates, audit.
> - **OpenAPI 3.1 spec:** [`backend/src/main/resources/static/openapi/punenest-api.yaml`](../../backend/src/main/resources/static/openapi/punenest-api.yaml)
>   (served at `/openapi/punenest-api.yaml`; Swagger UI at `/docs`).

This review does **not** restate every endpoint — that is the job of the OpenAPI spec. It provides the architectural narrative an ARB needs: domain boundaries,
performance and security posture, a microservice roadmap, and platform recommendations.

---

## 1. Executive Summary

### Application understanding
PuneNest is a **Pune-first, owner-direct real-estate marketplace** (rent + buy) positioned
against NoBroker / MagicBricks / 99acres. The React prototype implements a full two-sided
product: consumer discovery (search, map, listing detail, localities, reels), an owner console
(listings, leads, offers, visits, deals, finances, documents, tenancies), a tenant/buyer
workspace (saved searches, contact requests, rent payments, tenant profile), a services layer
(rent agreements, paid services, support tickets), growth surfaces (plans, boosts, referrals,
society/builder B2B leads), and a staff/admin back-office (moderation, KYC, reports, CMS,
analytics, audit). The frontend already targets a Spring Boot backend at
`http://localhost:8080/api` through a mock↔http provider seam.

The distinguishing product mechanic is the **contact gate**: owner contact details and documents
are never exposed until the seeker passes **auth + Aadhaar verification**, and sensitive staff
actions run through a **maker-checker** approval flow with a full **audit trail**. These are
cross-cutting invariants, not per-screen features, and they shape the API and security design.

### Major business domains (11 bounded contexts)
| # | Bounded context | Core responsibility |
|---|-----------------|---------------------|
| 1 | **Identity & Access** | Auth (OTP + staff password), profile, sessions, RBAC, Aadhaar gate |
| 2 | **Catalog & Search** | Public listing discovery, filters, map, localities, cities, fees |
| 3 | **Listings** | Owner listing lifecycle, offers, visits, deals |
| 4 | **Moderation** | Listing review, user/KYC verification, reports, staff management |
| 5 | **Leads & Contact** | Contact requests (gated), enquiries, deal finalization |
| 6 | **Rentals & Payments** | Finances, rent payments/ledger, mandates, payouts, tenancies, tenant profiles |
| 7 | **Documents** | Property documents, access requests, secure share links |
| 8 | **Services & Support** | Service requests/workflows, support tickets, rent agreements, owner KYC |
| 9 | **Billing & Growth** | Plans/subscriptions, boosts, paid services, referrals |
| 10 | **Engagement** | Saved searches/alerts, reviews, share-a-flat, notifications, CMS content |
| 11 | **Admin & Analytics** | KPIs, analytics, platform settings, audit log, CMS admin, society leads |

### Recommended architecture
Start as a **modular monolith** (single Spring Boot deployable) with **package-per-bounded-context**
and strict inter-module boundaries (module APIs only, no cross-module entity reach-through). Front
it with an **API Gateway** for auth/rate-limiting/routing. Use an **outbox + event bus** from day one
for cross-context side-effects (notifications, audit, alerts, analytics) so contexts can later be
extracted to independent services with minimal refactoring. This delivers microservice *readiness*
without paying microservice *operational cost* prematurely — appropriate for the current product
stage and team size.

---

## 2. Domain Analysis

### Business capabilities → bounded contexts
The 33 domains enumerated in the OpenAPI spec collapse into the **11 bounded contexts** above.
The consolidation removes UI-driven duplication (e.g. the frontend's separate "finance",
"rent payments", "tenancies", and "tenant profile" screens are one **Rentals & Payments**
context; "announcements/services/faqs/banners" are one **Engagement/CMS** capability with a
shared content model).

### Context map (dependencies)
```
                         ┌───────────────────┐
                         │ Identity & Access │  (issues JWT; owns users/roles)
                         └─────────┬─────────┘
        auth/RBAC everywhere ──────┼───────────────────────────────
                                   │
   ┌──────────────┐   publishes   ┌▼──────────────┐   moderates   ┌──────────────┐
   │Catalog&Search│◄──listing.*───│   Listings    │──────────────►│  Moderation  │
   └──────┬───────┘   events      └───┬───────────┘   review req   └──────┬───────┘
          │ read model                │ deal/offer                        │ verify
          │                           ▼                                   ▼
   ┌──────▼───────┐  contact gate ┌───────────────┐   KYC/Aadhaar  ┌──────────────┐
   │Leads&Contact │◄──────────────│Rentals&Payment│                │  (Aadhaar)   │
   └──────────────┘               └───┬───────────┘                └──────────────┘
                                      │ tenancy/agreement
                                      ▼
                              ┌───────────────┐   ┌──────────────┐   ┌──────────────┐
                              │  Documents    │   │Services&Suppt│   │Billing&Growth│
                              └───────────────┘   └──────────────┘   └──────────────┘

   Engagement (saved/alerts/reviews/CMS/notifications) subscribes to events from most contexts.
   Admin & Analytics consumes the audit/event stream (read-only projections).
```
Key rule: **Catalog & Search is a read-optimized projection** of Listings (denormalized,
independently scalable, eventually consistent). Owner writes go to **Listings**; the public
search index is updated via `listing.published` / `listing.updated` events.

### Entity relationships
Entity **field shapes** live in the OpenAPI component schemas; the ER map + persistence design live in [`data-model.md`](./data-model.md). The high-level map:

- **User** (1)─(N) **Property**; a Property has (N) **Offer**, (N) **Visit**, (0..1) **Deal**.
- **Deal** (1)─(N) **DealParty**; a closed Deal may spawn a **Tenancy** and **RentAgreement**.
- **Property** (1)─(N) **Document**; **DocumentRequest** links a seeker to requested categories.
- **ContactRequest** / **Enquiry** link a (gated) seeker to a Property + owner.
- **Tenancy** (1)─(N) **RentPayment**; (0..1) **RentMandate**; owner has (0..1) **PayoutAccount**.
- **Property** (1)─(N) **Transaction** (owner finance ledger); **OwnershipBasis** (0..1).
- **Subscription**/**Boost**/**ServiceOrder**/**Referral** attach to a User (Billing & Growth).
- **AuditEntry** references any (entity, action, actor, checker) tuple (Admin & Analytics).

See [§6 Security Review](#6-security-review) for the gate/RBAC invariants that constrain which
relationships are traversable by whom.

---

## 3. API Catalog

The **authoritative, per-endpoint catalog** (URL, method, purpose, request/response schema,
validation, errors, security) lives in exactly one place, the OpenAPI 3.1 spec — **126 paths /
160 operations / 101 schemas**, grouped by the 11 bounded-context `tags`. Render it at `/docs`
(Swagger UI) or read the raw YAML at `/openapi/punenest-api.yaml`.

Rather than duplicate ~160 rows here, this section records the **design standards** every
endpoint in the catalog conforms to:

| Concern | Standard |
|---------|----------|
| Base path | `/api` (single versioned prefix; see versioning below) |
| Naming | Plural nouns, kebab-case multi-word (`/service-requests`, `/saved-searches`) |
| Verbs | `GET` (read, safe), `POST` (create/action), `PUT` (full replace/idempotent set), `PATCH` (partial), `DELETE` (soft-delete/archive) |
| Sub-resources | Nested only one level (`/properties/{id}/reviews`); actions as `POST /{id}/{action}` (`/offers/{id}/respond`, `/content/{id}/archive`) |
| Pagination | `?page=0&size=20` (zero-based, max size 100), `PageEnvelope` wrapper with `content[]` |
| Filtering | Typed query params per resource (e.g. `deal`, `bhk`, `locality`, `budgetMin/Max`) |
| Sorting | `?sort=field,direction` (repeatable) |
| Errors | `{ error, message, status, traceId }`; `422` uses `ValidationProblem` with `fields[]` |
| Idempotency | `Idempotency-Key` header on money/booking POSTs (subscribe, pay-rent, boost, order) |
| Auth | Global `bearerAuth` (JWT); public reads mark `security: []` (search, localities, CMS) |
| Money | Integer INR (no floats/paise) via the `Money` schema |
| Soft-delete | Archive/restore endpoints; no destructive hard `DELETE` on business entities |

**Versioning strategy:** URI-based major versioning is deferred ? the current contract is `v1`
implicitly under `/api`. When a breaking change is unavoidable, introduce `/api/v2/<resource>`
for the affected resources only (not a global bump), and keep `v1` alive through a deprecation
window advertised via `Deprecation` / `Sunset` response headers. Additive changes (new optional
fields, new endpoints) ship without a version bump.

---

## 4. OpenAPI 3.1 Specification

The complete Swagger definition is the file
[`backend/src/main/resources/static/openapi/punenest-api.yaml`](../../backend/src/main/resources/static/openapi/punenest-api.yaml).
It is **not** embedded here ? it is the single source of truth and is served live by the
Spring Boot skeleton.

Highlights of the spec structure:

- **`info`** ? title, version, and a `description` documenting the conventions above.
- **`servers`** ? local (`http://localhost:8080/api`), staging, and production base URLs.
- **`tags`** ? the 11 bounded contexts, so the API groups cleanly for future service extraction.
- **`security`** ? global `bearerAuth` (HTTP bearer / JWT); `oidc` (`openIdConnect`) declared for
  the target-state federation; public endpoints opt out with `security: []`.
- **`components.parameters`** ? reusable `Page`, `Size`, `Sort`, id params, and `Idempotency-Key`.
- **`components.responses`** ? reusable `BadRequest`, `Unauthorized`, `Forbidden`, `NotFound`,
  `ValidationError`, `TooManyRequests`.
- **`components.schemas`** ? 101 schemas including shared primitives (`Money`, `Mobile`, `Deal`,
  `PageEnvelope`, `Error`, `ValidationProblem`) and per-context DTOs, all `$ref`-reused.

**How to run it:** the Spring Boot app in `backend/` serves the raw YAML at
`/openapi/punenest-api.yaml` and Swagger UI at `/docs`. It was validated (YAML parses, zero
unresolved `$ref`s, no duplicate `operationId`s) and boots on Java 21 / Spring Boot 4.1.

---

## 5. Performance Review

### Bottlenecks implied by the UI patterns
1. **Search + map dual render.** The discovery screen renders a list and a map from the same
   query. A naive design issues two calls and refetches on every pan/zoom.
2. **Listing detail fan-out.** The detail page shows property + similar listings + reviews +
   locality stats + contact-gate state ? a classic N+1 / chatty-page risk.
3. **Owner dashboards.** Listings, leads, offers, visits, finances summary render together;
   per-widget calls create a request storm on load.
4. **Admin analytics + audit.** Large, filterable, time-series datasets over the full corpus.
5. **Rent ledger / finances.** Per-property transaction aggregation (income/expense/net/cashflow).

### Optimization recommendations
- **CQRS read model for search.** Serve Catalog & Search from a denormalized projection
  (Postgres materialized/read table now; Elasticsearch/OpenSearch later) updated by listing
  events. Map markers return a **minimal payload** (`id, lat, lng, price`) and popups lazy-load.
- **Aggregation / BFF endpoints** to kill chatty pages:
  - `GET /properties/{id}` returns the detail aggregate (specs + gate state), while
    `similar`/`reviews` load lazily below the fold.
  - Owner dashboard gets a `GET /me/dashboard` summary aggregate (counts + recent items) instead
    of 5 separate widget calls. (Recommended addition; see assumptions.)
- **Precomputed finance summaries.** `/me/finances/{propId}/summary` and `/cashflow` should read
  incrementally-maintained rollups, not scan the full transaction ledger per request.
- **Response payload discipline.** `PropertySummary` (card projection) vs `Property` (detail)
  split is already in the spec ? keep list endpoints on the summary shape.
- **Async offload.** Aadhaar/KYC verification, document virus-scan/OCR, notification/alert
  fan-out, rent-alert matching, and analytics rollups run **off the request thread** via the
  event bus + workers (see ?8).

### Caching strategy
| Data | Strategy | TTL / Invalidation |
|------|----------|--------------------|
| Search results | Edge/CDN + short server cache on common facets | 30?60s; invalidate on listing events |
| Listing detail (public) | CDN + `ETag`/`Cache-Control` | Invalidate on `listing.updated` |
| Localities / cities / fees / plans / CMS | Long-lived cache (rarely change) | Hours; purge on admin write |
| Static media (images/floorplans) | CDN with immutable hashed URLs | Immutable |
| Per-user (saved, notifications, finances) | **No shared cache**; private, `Cache-Control: private, no-store` | ? |
| Reference/master data | In-app cache (Caffeine) + Redis | Event/purge driven |

### API consolidation opportunities (challenging the frontend)
- Merge the prototype's separate finance/rent/tenancy/tenant-profile screens into the single
  **Rentals & Payments** context (done in the spec).
- Unify announcements/services/faqs/banners under one **content** model with a `type`
  discriminator and shared archive/restore (done: `/admin/content/{type}`).
- Collapse duplicate "reviews" (structured entity reviews vs admin moderation feed) into one
  `entity_type`+`entity_id`+`status` model (schema inconsistency #6).

---

## 6. Security Review

### Risks and mitigations
| Risk | Mitigation |
|------|------------|
| **Contact/PII leakage** (owner mobile, documents) | Enforce the **contact gate** server-side (auth + Aadhaar) ? never rely on the client to hide contact. Contact fields are `null` in DTOs until the gate passes. |
| **Aadhaar / KYC data exposure** | Store masked (`XXXX XXXX 1234`); never return full Aadhaar/PAN; encrypt at rest; restrict to Moderation role; audit every access. |
| **Privilege escalation** | RBAC checked at the resource-server per endpoint; staff actions scoped by `team`; sensitive mutations require **maker-checker**. |
| **IDOR on owner-scoped data** | Every `/me/**` and owner resource is filtered by the authenticated `user_id`, not by client-supplied ids (schema inconsistency #10 ? migrate mobile-keyed stores to `user_id` FKs). |
| **Payment fraud / double-charge** | `Idempotency-Key` on money endpoints; server-side amount validation; provider webhooks reconciled against the mandate/order. |
| **Document share-link abuse** | `/documents/shared` is token-scoped, time-boxed, and revocable ? not public-by-obscurity. |
| **Injection / oversized input** | Bean Validation on every DTO (`Mobile` regex, enums, min/max); reject oversized uploads (`413`/`415`). |
| **Scraping / spam listings & leads** | Rate limiting per IP + per user; captcha on public lead forms; freshness/expiry to de-rank stale listings. |
| **Token theft** | Short-lived access JWT (15 min) + rotating refresh; `persistAuthorization` only in the dev Swagger UI. |

### Authentication model
- **Consumers:** mobile + OTP (passwordless), yielding a JWT access token + refresh token.
- **Staff/admin:** email + password (`/auth/staff/login`), same token contract, `role`+`team` claims.
- **Aadhaar** is a **verification step layered on top of auth** (a `mobileVerified`/`aadhaarVerified`
  claim/attribute), not a second login ? it gates contact/document access, not API access.
- **Target state:** externalize to an **OIDC provider** (Keycloak/Auth0). The resource server
  already validates JWTs, so this is a configuration change, not a contract change (`oidc` scheme
  is pre-declared in the spec).

### Authorization model (RBAC)
Roles: `buyer`, `owner`, `staff`, `admin`
(+ staff `team` for functional scoping). Enforcement layers:
1. **Gateway** ? coarse auth (valid token, not revoked) + rate limiting.
2. **Resource server** ? per-endpoint role checks (method security) + ownership filters.
3. **Domain services** ? invariant enforcement (gate passed? maker?checker? deal stage valid?).
4. **Audit** ? every privileged mutation writes an `AuditEntry` (maker, checker, entity, action).

---

## 7. Microservice Roadmap

### Guiding principle
Ship a **modular monolith** now; extract services only when a context has a distinct
scaling profile, team owner, or availability requirement. The 11 bounded contexts are the
pre-drawn seams.

### Suggested services and extraction order
| Phase | Extract | Why first / trigger | Data ownership |
|-------|---------|---------------------|----------------|
| **0 (now)** | *Modular monolith* ? all 11 contexts, one deployable, one Postgres with a **schema per context** | Fastest path; enforce module boundaries + outbox events from day one | Shared DB, but no cross-schema FKs across contexts (reference by id + events) |
| **1** | **Catalog & Search** | Highest read volume; independent scaling; benefits from a search engine | Own read projection (Postgres RO table ? OpenSearch); source of truth stays in Listings via events |
| **2** | **Identity & Access** | Security isolation; enables OIDC federation; every service depends on it | Owns `users`, `roles`, sessions; issues JWTs validated everywhere |
| **3** | **Rentals & Payments** + **Billing & Growth** | PCI/financial isolation; independent compliance + uptime needs | Owns finances, payments, mandates, payouts, subscriptions, orders |
| **4** | **Documents** | Storage/throughput profile (uploads, OCR, virus scan, signed URLs) | Owns document metadata + object-store references |
| **5** | **Moderation** + **Services & Support** (workflow-heavy) | Operational tooling can iterate independently of consumer flows | Owns review/verification/ticket/service-request state |
| **later** | Engagement, Admin & Analytics | Extract if event/notification volume or reporting load demands it | Analytics is a read-only projection of the event stream |

### Service boundaries & shared concerns
- **Shared kernel (library, not a service):** `Money`, `Mobile`, error/envelope contracts,
  auth token verification, tracing/correlation ? versioned and published as a small internal lib.
- **Cross-cutting via events, not sync calls:** notifications, audit, alerts, analytics subscribe
  to domain events; contexts never reach into each other's tables.
- **Anti-corruption at seams:** each future service exposes its own API; the read model
  (Catalog) translates Listings events rather than sharing its schema.

### Data ownership strategy
One logical database per bounded context (start as separate **schemas** in one Postgres
instance, split to separate instances on extraction). No distributed transactions ? use the
**transactional outbox + idempotent consumers** pattern for cross-context consistency
(e.g. deal-closed ? create tenancy ? schedule first rent ? notify both parties).

---

## 8. Architecture Recommendations

### API Gateway
Adopt an API Gateway (Spring Cloud Gateway now; managed gateway/Kong/APIM later) for:
TLS termination, JWT pre-validation, **rate limiting/throttling**, request/response logging with
correlation ids, CORS, and routing. It is the single public ingress; internal services are never
directly exposed.

### Event-driven / messaging
- **Broker:** Kafka (or Redis Streams for the monolith stage) with a **transactional outbox** so
  events are published atomically with the owning write.
- **Event catalog (examples):** `listing.published/updated/archived`, `offer.made/accepted`,
  `visit.requested/confirmed`, `deal.closed`, `contact.granted`, `kyc.verified`,
  `payment.captured`, `document.uploaded`, `report.filed`. Consumers: search projection,
  notifications, alerts (saved-search matching), audit, analytics.
- **Async workers** own: Aadhaar/KYC verification, document OCR/virus-scan/signed-URL issuance,
  notification + rent-reminder fan-out, saved-search alert matching, finance/analytics rollups.

### Database
- **Primary:** PostgreSQL (schema-per-context). JSONB for flexible attributes (amenities,
  preferences, metadata); strong typing for money (`bigint` INR) and enums.
- **Search:** OpenSearch/Elasticsearch for Catalog (Phase 1) with geo queries for map search.
- **Cache:** Redis (sessions/refresh-token denylist, rate-limit counters, reference data).
- **Object storage:** S3-compatible for media + documents, served via CDN with signed URLs.
- **Migrations:** Flyway, one migration set per schema; reconcile the 10 recorded schema
  inconsistencies (see below) before the first production migration.

### Monitoring & observability
- **Tracing:** OpenTelemetry, propagate `traceId` end-to-end (already surfaced in the `Error`
  schema). **Metrics:** Micrometer ? Prometheus; dashboards in Grafana. **Logs:** structured
  JSON, correlation-id tagged, shipped to a central store.
- **Health:** Spring Boot Actuator `health` (liveness/readiness probes enabled) ? live now.
- **SLOs:** search p95 latency, contact-gate correctness (security), payment success rate,
  moderation queue age. **Audit** is a first-class observability surface for compliance.

---

## Assumptions & open items

Documented per the brief ? where frontend behavior was ambiguous, these are explicit choices,
not silent decisions:

1. **Aggregate/BFF endpoints** (`/me/dashboard`, listing detail aggregate) are *recommended
   additions* not present as such in the prototype; they reduce chatty pages but should be
   confirmed with the frontend team before implementation.
2. **Payments provider** is assumed to be an Indian gateway (Razorpay-style) with UPI autopay
   mandates; exact provider/webhook contract is TBD.
3. **Search engine** (OpenSearch) is a Phase-1 recommendation; Phase-0 can serve search from a
   denormalized Postgres read table.
4. **OIDC provider** (Keycloak/Auth0) is target-state; the monolith issues its own JWTs today.
5. **ID scheme** is assumed to standardize on opaque UUIDs in Postgres (prototype uses mixed
   prefixes) ? see inconsistency #1.
6. The **10 schema inconsistencies** catalogued in
   [`data-model.md` ?"Schema inconsistencies"](./data-model.md) must be reconciled during
   schema authoring: (1) ID prefixes, (2) `rera` boolean vs string, (3) `desc`/`description` +
   missing detail fields, (4) two `deals` shapes, (5) `transactions` field names, (6) reviews
   modeled twice, (7) `report.reason` enums, (8) `localities` fields, (9) nullable `users.email`,
   (10) mobile-keyed stores ? `user_id` FKs. These are the single most important pre-implementation
   cleanup and directly affect API response fidelity.

---

*Generated as part of the PuneNest backend reverse-engineering effort. Endpoint truth lives in
the OpenAPI spec; entity ER + persistence truth lives in `data-model.md`; this document is
the architectural narrative binding them.*
