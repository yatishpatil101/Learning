# Package structure — decision record

> **Status:** Accepted · **Scope:** backend (`com.punenest.api`) · **Companion of:**
> [`api-standards.md`](./api-standards.md) §7 ·
> [`platform-architecture.md`](./platform-architecture.md) (modular-monolith ADRs).
> §3 below owns the 11 bounded contexts.

This fixes the definitive physical layout for the PuneNest modular monolith so every future slice has
**one obvious, low-friction home** and a later service extraction is **mechanical, not a rewrite**.
It reflects the tree as it exists today (auth+users is the only shipped slice), not a textbook ideal.

---

## 1. Decision

Adopt **package-by-bounded-context**, with **feature/aggregate sub-packages that are flat inside**
(no `controller/`, `service/`, `repository/` layer packages). Shared machinery stays top-level.

```
com.punenest.api
├─ PunenestApiApplication.java          # single @SpringBootApplication root
│
├─ identity/                            # ── CONTEXT 1: Identity & Access (SHIPPED) ──
│  ├─ auth/                             #   aggregate: login/OTP/refresh/logout
│  │   AuthController, AuthService, OtpService, OtpCode(+Repository),
│  │   RefreshToken(+Repository), RefreshTokenService, Tokens,
│  │   LoginRequest, StaffLoginRequest, RefreshRequest, AuthResponse   (record DTOs)
│  ├─ user/                            #   aggregate: profile + /me
│  │   MeController, User, UserRepository, UserService,
│  │   UserResponse, UserUpdate
│  └─ verification/                    #   aggregate: Aadhaar/KYC badge (ADR-019)
│      IdentityVerification, IdentityVerificationRepository
│
├─ <catalog|listing|leads|rentals|documents|services|billing|engagement|moderation|admin>/
│                                       #   future contexts — same shape, drop in with zero coupling
│
├─ common/                             # ── SHARED KERNEL (no feature may be imported here) ──
│  ├─ config/    CorsConfig, OpenApiDocsConfig
│  ├─ error/     ApiError, ApiException + subclasses, GlobalExceptionHandler, ValidationProblem
│  ├─ persistence/ BaseEntity, AuditedEntity, SoftDeleteEntity
│  ├─ web/       PageResponse, CorrelationIdFilter, RequestCorrelation
│  └─ audit/     AuditLog(+Repository), AuditService
│
├─ security/                           # ── SHARED: JWT chain, principal, role guards ──
│     SecurityConfig, JwtService, JwtAuthFilter, JwtProperties, AuthPrincipal,
│     CurrentUser, Roles, RestAuthEntryPoint, RestAccessDeniedHandler, SecurityErrors
│
└─ provider/                           # ── SHARED: external-world seams (mock-in-dev) ──
      OtpSender, KycProvider, PaymentGateway, FileStorage
```

A **single business slice is laid out end-to-end inside its aggregate package**:
`entity → repository → service → controller → DTO/mapper`, with the test package mirroring it
(`src/test/java/com/punenest/api/<context>/<aggregate>/`). No type for a slice lives outside its
package except the shared kernel it *depends on*.

---

## 2. Dependency rule (what may import what)

```
feature context ──▶ security ──▶ common       feature context ──▶ provider ──▶ common
        └─────────────────────▶ common
```

- **Shared kernel** (`common.*`, `security.*`, `provider.*`) may **never** import a feature package.
- A **feature context may import** the shared kernel, and may import a context **below it in the
  layering order** — never one above, so the graph stays acyclic.

**Context layering order** (low → high; an import may only point downward):

| Layer | Context | May import |
|---|---|---|
| 0 | `content`, `identity` | shared kernel only |
| 1 | `catalog` | layer 0 |
| 2 | `documents`, `leads`, `engagement`, `billing` | layers 0–1 |
| 3 | `finance`, `services` | layers 0–2 |
| 4 | `deals` | layers 0–3 |
| 5 | `moderation` | layers 0–4 |

Contexts sharing a rank never import one another; only the strict ordering is enforced.

`billing` sits at 2 and `finance` at 3 because the payment callback `finance` already owns is what
activates a paid subscription or boost — so the arrow is `finance → billing`. Ranking `billing`
higher would make that legitimate call a violation and invite someone to "fix" it by having
`billing` reach back into `finance`.

That callback lives in **`finance.payment`** (`PaymentWebhookController`, `POST /webhooks/cashfree/payment`),
settling subscriptions, boosts and service requests. It used to sit in `common.payments`, where it
broke this section outright: the shared kernel may never import a feature, and a webhook that
activates a subscription necessarily does. `ArchitectureBoundaryTest` names it. Moving it down into
the context that already owned the arrow was the smaller change — the alternative was an event bus
whose only subscriber would have been `billing`.

`moderation` sits at the top because it is the one context that legitimately reaches into
everything: taking content down means touching `catalog`, `identity` and `engagement` at once.

`finance` sits **below** `deals`, which reads backwards at first glance — closing a deal is what
creates a tenancy, so the arrow looks like it should point the other way. It does not, because
`finance` never needs to know a deal exists: a tenancy is a lease, and a ledger row is a rupee
against a property. `DealService.close` calls `TenancyService.openFromClosedDeal`, and that is the
only edge. Ranking `finance` lower keeps the ledger extractable and stops the reverse import from
ever being added.

`finance` currently holds four aggregates: `ledger` (the owner's per-property transactions, basis,
summary, cashflow and dues), `tenancy` (leases and tenant profiles), `payment` (the gateway
webhook), and `rental` (`tenant_rentals` — the tenant's own note about a home they rent, usually not
one of ours). `rental` is a sibling of `ledger` rather than a mode of it precisely because it has no
owner and no property: every `ledger` read is scoped `(propertyId, ownerId)`, and a tenant holds
neither key. The aggregate that once sat here and moved money between the two — `finance.rent` —
was deleted with its tables in V127.

**Why this replaced "features never import each other."** That rule was aspirational and was already
false the day it was written. `identity.user.User` *is* "who" and `catalog.property.Property` *is*
"which listing"; every transaction context needs both to say anything at all. Six such edges exist
today (`catalog→identity`, `leads→{catalog,identity}`, `finance→{leads,catalog,identity}`,
`deals→{finance,leads,catalog,identity}`), so
enforcing the original rule would have required an allowlist naming essentially every pair — a
guardrail that permits everything and therefore guards nothing.

What actually matters is that the graph never grows a **cycle**: the moment `identity` imports
`deals`, the contexts have fused and none of them can ever be extracted. The layered rule forbids
exactly that and permits the rest, so it is both true today and worth failing a build over.

Direct cross-context **repository** access (rather than going through the owning service) is
permitted downward and is used deliberately: `leads` and `deals` read `PropertyRepository` and
`UserRepository` to resolve a listing or a participant. These are read-only lookups of another
context's identity, not invocations of its behaviour — routing them through a service would add a
pass-through method per call and no invariant. **Writes to another context's tables remain
forbidden**; a cross-context write goes through that context's service (e.g. finalization-accept
calls `DealService.closeForFinalization`, it does not write `deals` rows itself).

Cross-context needs that are genuinely *behavioural* and point **upward** (notifications, audit,
analytics) go through **events/ids** or a `common.*` port — never a direct call. That is the seam
that lets a context split out later (architecture-review §"Context map"), and it is why slice 3's
contact gate lives in `common.trust.ContactGate` rather than in `leads`.

**Enforcement:** `ArchitectureBoundaryTest` (ArchUnit) fails the build on an upward or cyclic
context import, and on any shared-kernel → feature import. We still reject Spring Modulith / JPMS
`module-info` as too heavy (`ponytail`): one test class, no runtime cost, no build plugin.

---

## 3. Bounded-context → package → schema → roadmap mapping

The 11 bounded contexts each get **one top-level package**; sub-domains nest as aggregates (as
`identity` already nests `auth`/`user`/`verification`). The 33 API domains enumerated in the OpenAPI
spec collapse into these 11.

| # | Bounded context | Core responsibility | Package | Flyway group (logical schema) | Roadmap phase |
|---|-----------------|---------------------|---------|-------------------------------|---------------|
| 1 | Identity & Access | Auth (OTP + staff password), profile, sessions, RBAC, Aadhaar gate | `identity` (`.auth/.user/.verification`) | `V02__DDL_identity_access` | **auth+users — SHIPPED** |
| 2 | Catalog & Search | Public listing discovery, filters, map, localities, cities, fees | `catalog` | `V03__DDL_catalog_geo`, `V04__DDL_catalog_listings` | properties/search |
| 3 | Listings | Owner listing lifecycle, offers, visits, deals | `listing` | `V04__DDL_catalog_listings`, `V06__DDL_deals_offers` | properties → deals |
| 5 | Leads & Contact | Contact requests (gated), enquiries, deal finalization | `leads` | `V05__DDL_leads_conversations` | contacts/gate → visits |
| 6 | Rentals & Payments | Owner finance ledger, tenancies, tenant profiles, the tenant's self-declared rental | `rentals` | `V10__DDL_tenancy_finance` | finance/rent |
| 7 | Documents | Property documents, access requests, secure share links | `documents` | `V08__DDL_documents_vault` | finance/rent |
| 8 | Services & Support | Service requests/workflows, support tickets, rent agreements, owner KYC | `services` | `V07__DDL_service_requests` | services/tickets |
| 9 | Billing & Growth | Plans/subscriptions, boosts, paid services, referrals | `billing` | `V11__DDL_engagement_billing` | services → CMS |
| 10 | Engagement | Saved searches/alerts, reviews, flatmates, notifications | `engagement` | `V11__DDL_engagement_billing`, `V13__DDL_flatmates` | content/CMS |
| 4 | Moderation | Listing review, user/KYC verification, reports, staff management | `moderation` | `V02`/`V04` (review of users+listings) | admin/analytics |
| 11 | Admin & Analytics | KPIs, analytics, platform settings, audit log, CMS admin, society leads | `admin` | `V01__DDL_foundation`, `V12__DDL_cms_content`, `V14__DDL_analytics` | admin/analytics |

The "Flyway group" column names the consolidated domain file that now declares each context's
tables. It is deliberately a whole-file citation and not a line number: the chain was squashed from
127 incremental migrations into these 14, so a table's full shape is in one place and line numbers
would rot on the next edit. Note the gateway/webhook half of row 6 is gone — the online
rent-collection rail was withdrawn, and `V10` says so in its header.

**Honest caveat — schema-per-context is *logical*, not physical.** The target is one Postgres schema
per context; today **every table lives in `public`** (75 tables as of V33) and contexts are expressed
only by **Flyway file grouping** (V1 foundation … V8 engagement_billing_cms; later migrations extend
existing contexts rather than adding new ones). Several contexts share a migration file. Physical
`CREATE SCHEMA` per context is deferred to extraction time (§5) — the package layout is aligned *now*
so that move is later just a schema-qualifier change, not a code reshuffle.

---

## 4. Naming & placement conventions

| Kind | Convention |
|---|---|
| Controller | `<Aggregate>Controller` (or `MeController` for `/me`); thin — validate envelope, delegate, map at edge |
| Service | `<Aggregate>Service`; owns `@Transactional` + business logic; small & single-responsibility |
| Repository | `<Entity>Repository extends JpaRepository`; soft-delete-aware finders (`…AndArchivedFalse`) |
| Entity | domain noun (`User`, `OtpCode`); extends `common.persistence` base; never serialized |
| DTO | Java `record`; **request** = `<Verb>Request`/`<Noun>Update`, **response** = `<Noun>Response` — a plain record, no `from(entity)` factory (see Mapper) |
| Mapper | a dedicated `<Aggregate>Mapper` per **api-standards.md §8.1** — MapStruct by default, hand-written only where the whole projection is trust-shaping. Superseded the original inline `from(entity)` style once masking rules appeared: a factory *on the response record* has no access to the viewer, so it cannot decide what to reveal, and every callsite silently got the same answer. |
| Exception | reuse `common.error.*`; add a feature exception only for genuinely feature-specific cases |
| Config | cross-cutting → `common.config`; a feature's own beans live in that feature package |
| Tests | mirror the main package exactly under `src/test/java/...` |
| OpenAPI-derived shapes | hand-written records matched to the spec (SSOT); no generated-code package |

Constructor injection only (no field `@Autowired`). Package names are **singular, lower-case, no
suffixes** (`listing`, not `listings`/`listingcontext`) — except where the domain noun is naturally
plural (`rentals`, `documents`, `services`).

### 4.1 The service-split trigger — ~450 lines, split by use-case, never by layer

The `<Aggregate>Service` row above asks for services that are "small & single-responsibility", which
is a judgement call, and judgement calls are settled by whoever is holding the keyboard. The
operational definition is **450 physical lines**: once a service crosses it the presumption flips,
and the reviewer's default answer becomes "split this" rather than "it reads fine to me". Agreeing
the number in the abstract is the entire point — it costs nothing while nobody is defending a
particular file, and it is unwinnable once somebody is.

When a service does cross the line, **it splits by use-case, never by layer**. `FlatmateSupplyService`
becomes `FlatmateRoomService` and `FlatmateGroupService`: two things the business does, two names a
product person would recognise, each owning its own transactions, each testable without the other.
It must **never** become `FlatmateSupplyServiceHelper`. A helper class named after its parent is a
file split, not a design — both files still have to be read together, the seam between them is
arbitrary, the name says nothing about what the class does, and the parent keeps every
responsibility it had while now also depending on a class that exists only because a line count got
embarrassing. The same objection retires `FlatmateSupplyServiceImpl2`, `FlatmateSupplyServiceSupport`
and `FlatmateSupplyServiceUtils`. If the new half cannot be named after something the business
actually does, it is not a split.

**What a reviewer does when a service crosses the line.** Name the use-cases the service is serving
today. If they are genuinely one — a long but linear workflow with a single reason to change — say
so in the pull request and say why, because that is the case a line count is deliberately too blunt
for. Otherwise take the smallest use-case that owns its own data and its own transaction, move it
out together with its tests, and leave the caller talking to two services instead of one. Do not
extract a mapper, a validator or a "helper" and call it done: those are layers, and slicing one
aggregate by layer leaves both halves unable to make sense without the other.

**Enforcement:** `ServiceSizeGuardTest` fails the build when a `*Service.java` under
`src/main/java` exceeds 450 lines, and separately when a class appears whose name is an existing
service plus a filler suffix (`…ServiceHelper`, `…ServiceUtils`, `…ServiceSupport`, `…Service2`).
Six services were already over the line when the rule was written — `ServiceRequestService` at 1087
lines is the worst — and **none of them was split to make the guard pass**; a large untested
refactor performed to satisfy a lint is exactly the failure this rule is meant to prevent. They are
instead pinned in the test at their exact current size, so they may shrink but never grow. Raising a
pin means editing that table by hand, which is a deliberate and reviewable act rather than silent
drift — the same device the layering table in §2 uses for adding a context.

---

## 5. Migration — what moved now vs. deferred

**Applied now** (cheapest while `identity` is the only shipped slice; fully compiler+test-verified):

1. Nested the identity context: `auth → identity.auth`, `user → identity.user`, and the stray
   `IdentityVerification` into `identity.verification`.
2. Consolidated `config → common.config` (moved `OpenApiDocsConfig` beside `CorsConfig`).
3. Kept `security`, `provider`, `common.*` shared at top level.

These are **package moves only** — no URL, contract, JSON, or DB change; the only risk is
compile/test, fully caught by `mvn verify` (**41 tests green**, boots under `ddl-auto=validate`).

**Deferred (documented, dependency-ordered):**

| Deferred step | Trigger |
|---|---|
| Add the **ArchUnit** boundary test (1 dep + 1 rule: "no feature package imports another feature package") | when the **2nd context** lands |
| Resolve the `security.JwtService → identity.user.User` seam via a **claims projection** (so security doesn't import a feature) | only if/when Identity is **extracted** |
| Physical `CREATE SCHEMA <context>` + schema-qualified tables | at **service-extraction** time (keep `public` now) |

---

## 6. Rationale — options considered

| Option | Verdict | Why |
|---|---|---|
| **Package-by-bounded-context** (chosen) | ✅ | Physically embodies the 11-context model; a context is one directory you can lift out wholesale — the modular-monolith split-later goal, with zero per-slice churn. |
| Package-by-layer (`controller/`, `service/`, …) | ❌ | Scatters one feature across the tree; every new slice edits 4+ sibling packages; extraction means hunting types across layers. Contradicts `api-standards.md` §7. |
| Flat package-by-feature, no context grouping (today's `auth`, `user` at root) | ❌ | Fine at 2 packages, but 33 API domains → 33 root packages with no context boundary; loses the extraction unit and the schema mapping. Nesting under a context is a cheap, reversible improvement now. |
| Enforce with **Spring Modulith / `module-info`** | ❌ (deferred to ArchUnit) | Real machinery, real weight, flaky-resolution risk in this env, for a one-slice app — `ponytail` says earn it. A single ArchUnit rule gives 90% of the value at ~0 cost when the 2nd context arrives. |
| Keep a `commute` reference module | n/a | No `commute` module exists in this repo; `identity` (auth+users) is the canonical exemplar instead. |

**Net:** the cheapest structure that makes the *next* slice (properties/search) drop in with no
cross-feature coupling, and makes a *future* extraction a mechanical move — no purity tax paid today.
