# Package structure — decision record

> **Status:** Accepted · **Scope:** backend (`com.punenest.api`) · **Companion of:**
> [`api-standards.md`](./api-standards.md) §7 · [`backend-api-architecture-review.md`](./backend-api-architecture-review.md)
> (11 bounded contexts) · [`platform-architecture.md`](./platform-architecture.md) (modular-monolith ADRs).

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
        └─────────────────────▶ common                    (features never import each other)
```

- **Shared kernel** (`common.*`, `security.*`, `provider.*`) may **never** import a feature package.
- A **feature context may import** the shared kernel, but **not another feature context** — the one
  intentional exception today is documented in §5 (`security.JwtService` reads `identity.user.User`).
- Cross-context needs (notifications, audit, analytics) go through **events/ids**, not direct calls or
  shared tables — the seam that lets a context split out later (architecture-review §"Context map").

**Enforcement:** convention + code review **now**; a single **ArchUnit** boundary test is *specified
here but deferred* (see §4). We deliberately reject Spring Modulith / JPMS `module-info` as too heavy
for a one-slice codebase (`ponytail`): the guardrail's weight must be earned by a second context.

---

## 3. Bounded-context → package → schema → roadmap mapping

The 11 contexts from [`backend-api-architecture-review.md`](./backend-api-architecture-review.md) §
"Major business domains" each get **one top-level package**; sub-domains nest as aggregates
(as `identity` already nests `auth`/`user`/`verification`).

| # | Bounded context | Package | Flyway group (logical schema) | Roadmap phase |
|---|-----------------|---------|-------------------------------|---------------|
| 1 | Identity & Access | `identity` (`.auth/.user/.verification`) | `V2__identity_access` | **auth+users — SHIPPED** |
| 2 | Catalog & Search | `catalog` | `V3__catalog_listings` | properties/search |
| 3 | Listings | `listing` | `V3__catalog_listings`, `V5__deals_offers_finalization` | properties → deals |
| 5 | Leads & Contact | `leads` | `V4__leads_contact_visits` | contacts/gate → visits |
| 6 | Rentals & Payments | `rentals` | `V6__documents_rent_finance` | finance/rent |
| 7 | Documents | `documents` | `V6__documents_rent_finance` | finance/rent |
| 8 | Services & Support | `services` | `V7__ops_services_growth` | services/tickets |
| 9 | Billing & Growth | `billing` | `V7__ops_services_growth`, `V8__engagement_billing_cms` | services → CMS |
| 10 | Engagement | `engagement` | `V8__engagement_billing_cms` | content/CMS |
| 4 | Moderation | `moderation` | `V2`/`V3` (review of users+listings) | admin/analytics |
| 11 | Admin & Analytics | `admin` | `V8__engagement_billing_cms` | admin/analytics |

**Honest caveat — schema-per-context is *logical*, not physical.** The architecture review's target is
one Postgres schema per context; today **all 62 tables live in `public`** and contexts are expressed
only by **Flyway file grouping** (V1 foundation … V8 engagement_billing_cms). Several contexts share a
migration file. Physical `CREATE SCHEMA` per context is deferred to extraction time (§5) — the package
layout is aligned *now* so that move is later just a schema-qualifier change, not a code reshuffle.

---

## 4. Naming & placement conventions

| Kind | Convention |
|---|---|
| Controller | `<Aggregate>Controller` (or `MeController` for `/me`); thin — validate envelope, delegate, map at edge |
| Service | `<Aggregate>Service`; owns `@Transactional` + business logic; small & single-responsibility |
| Repository | `<Entity>Repository extends JpaRepository`; soft-delete-aware finders (`…AndArchivedFalse`) |
| Entity | domain noun (`User`, `OtpCode`); extends `common.persistence` base; never serialized |
| DTO | Java `record`; **request** = `<Verb>Request`/`<Noun>Update`, **response** = `<Noun>Response` with a `from(entity)` factory |
| Mapper | inline `from(...)` on the response record (no separate mapper class until a mapping earns one) |
| Exception | reuse `common.error.*`; add a feature exception only for genuinely feature-specific cases |
| Config | cross-cutting → `common.config`; a feature's own beans live in that feature package |
| Tests | mirror the main package exactly under `src/test/java/...` |
| OpenAPI-derived shapes | hand-written records matched to the spec (SSOT); no generated-code package |

Constructor injection only (no field `@Autowired`). Package names are **singular, lower-case, no
suffixes** (`listing`, not `listings`/`listingcontext`) — except where the domain noun is naturally
plural (`rentals`, `documents`, `services`).

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
