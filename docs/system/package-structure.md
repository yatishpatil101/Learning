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

`moderation` sits at the top because it is the one context that legitimately reaches into
everything: taking content down means touching `catalog`, `identity` and `engagement` at once.

`finance` sits **below** `deals`, which reads backwards at first glance — closing a deal is what
creates a tenancy, so the arrow looks like it should point the other way. It does not, because
`finance` never needs to know a deal exists: a tenancy is a lease, and a ledger row is a rupee
against a property. `DealService.close` calls `TenancyService.openFromClosedDeal`, and that is the
only edge. Ranking `finance` lower keeps the ledger extractable and stops the reverse import from
ever being added.

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
| DTO | Java `record`; **request** = `<Verb>Request`/`<Noun>Update`, **response** = `<Noun>Response` — a plain record, no `from(entity)` factory (see Mapper) |
| Mapper | a dedicated `<Aggregate>Mapper` per **api-standards.md §8.1** — MapStruct by default, hand-written only where the whole projection is trust-shaping. Superseded the original inline `from(entity)` style once masking rules appeared: a factory *on the response record* has no access to the viewer, so it cannot decide what to reveal, and every callsite silently got the same answer. |
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
