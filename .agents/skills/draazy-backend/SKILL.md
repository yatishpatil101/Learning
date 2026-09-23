---
name: draazy-backend
description: >-
    Project skill for the Draazy (formerly PuneNest) BACKEND — a Spring Boot 4 + PostgreSQL REST API
    behind the
    already-built React frontend (Pune-first real-estate marketplace competing with NoBroker /
    MagicBricks). Use whenever doing backend or system-design work on Draazy: designing the
    system/architecture, modeling the PostgreSQL database, writing Flyway migrations, implementing
    or reviewing REST endpoints, auth/JWT, role guards, contact-gate logic, soft-delete/archive,
    caching, external-provider seams (Google Routes, OTP/SMS, payments, storage), or wiring the
    frontend http service provider to the live API. Also use for API-contract questions, entity
    and DTO design, pagination, and error-shape conventions. This is the backend counterpart to the
    draazy-frontend skill — reach for it any time the work is server-side, database, or
    system-architecture rather than UI.
user-invocable: true
---

# PuneNest backend

PuneNest is a Pune-first real-estate marketplace. The **React frontend is complete** and already
talks to a service-abstraction layer (`src/services/*Service.js`) that resolves either to a
`localStorage` mock (`src/services/providers/mock/`) or to a live REST API
(`src/services/providers/http/`), chosen **per domain** via `VITE_API_DOMAINS` + `isHttpDomain()` in
`src/services/config.js` (`VITE_API_MODE=http` is a legacy alias for "all domains").

**Your job on the backend is to implement the server side of that `http` provider** as a
Spring Boot 4 + PostgreSQL application whose request/response shapes match the OpenAPI spec
(`backend/src/main/resources/static/openapi/punenest-api.yaml`) exactly, so components never change —
only the provider swaps.

This skill is versioned in this repo at `.agents/skills/draazy-backend/`; all paths below are
relative to the repo root (Windows, PowerShell). Backend lives in `backend/` (Spring Boot 4.1, Java 25, Maven, groupId
`com.punenest`, root package `com.punenest.api`). The **auth/identity slice**
(`com.punenest.api.identity` + `com.punenest.api.security`) is the reference implementation — study it
as the canonical example of the house style before writing new code.

## When to use this skill

- **System design / architecture** for the backend (the current priority): turning the contract
  into an ERD, a schema, cross-cutting foundations, and a build order.
- **Database work**: PostgreSQL schema, Flyway migrations, indexes, JSONB, soft-delete columns.
- **API implementation**: controllers, services, repositories, entities, DTOs for any of the
  endpoint domains defined in the OpenAPI spec.
- **Cross-cutting concerns**: JWT auth, role guards, the contact/Aadhaar gate, pagination,
  error handling, CORS, OpenAPI, config profiles, external-provider seams, caching.
- **Wiring**: connecting the frontend `http` provider to the live API.

## Always-on companions

This skill governs backend implementation. Keep consulting the project's always-on skills:
`real-estate-expert` (domain model — the source of truth for what listings/deals/gates *mean*),
`senior-product-manager-realestate` (scope & priority — build what matters first),
`ponytail` (laziest-that-works discipline — shortest correct diff, reuse before you build).
For frontend/contract questions, cross-reference `draazy-frontend`.

## Golden rules

1. **The contract is law.** The OpenAPI spec
   (`backend/src/main/resources/static/openapi/punenest-api.yaml`) is the single source of truth for
   every path, verb, auth level (`x-roles`/`security`), query param, and JSON shape; the standing
   conventions live in `docs/system/api-standards.md`. The frontend already codes against these
   shapes. Never invent a divergent shape; if the spec is wrong or missing something, fix the spec
   first (and flag it), then implement. When in doubt, match the mock provider output.
2. **Contract-first, vertical slices.** Build one domain at a time as a full slice
   (entity -> repository -> service -> controller -> DTO mapping -> test), not layer-by-layer across
   the whole app. A shipped, contract-accurate `/properties` beats forty half-wired controllers.
3. **Match the house style.** Study the auth/identity slice and mirror it: package **by feature**
   under `com.punenest.api` (`identity`, `catalog`, `deals`, `finance`, `provider`, …), constructor
   injection (no field `@Autowired`), **Java `record`s for DTOs**, Javadoc that explains *why* (the
   cost/design reason), and `// ponytail:` comments where you take a deliberate pragmatic shortcut.
   See `references/architecture.md`.
4. **Soft-delete, never hard-delete.** No `DELETE`-to-oblivion. Removals go through
   `archive`/`restore` (properties, users, content). Archived rows are excluded from public queries
   by default and included in admin views via `?archived=true`. This is a platform-wide policy.
5. **Respect the trust & gating model.** Owner contact details stay hidden until a contact request is
   approved (mask as `98XXXXX210`). The contact gate requires Aadhaar verification — return
   `403 { "error": "aadhaar_required" }` when missing. Editing a listing *foundation* fields
   (price, bhk, type, locality) reverts its status to `pending`. These rules live in the domain, not
   just the UI — enforce them server-side.
6. **Isolate the outside world behind a seam.** Every external dependency (OTP/SMS, payment gateway,
   file storage, Google Routes) sits behind an interface in `com.punenest.api.provider` with a
   deterministic **mock/dev impl** and a real impl marked `@Primary` for prod. The app must run and be
   demoable with zero paid keys.
7. **Windows / PowerShell.** No `&&` / `||`; chain with `;` and gate with `if ($?) { ... }`. Use
   backslash paths. The build targets Java 25, so pin the JDK first:
   `$env:JAVA_HOME='C:\Program Files\Zulu\zulu-25'; cd backend; cmd /c "mvnw.cmd -o -f pom.xml spring-boot:run"`
   (PowerShell mangles raw maven output — redirect through `cmd`).

## Stack & standing conventions

| Concern | Convention |
|---|---|
| Framework | Spring Boot 4.1, Java 25, Maven, groupId `com.punenest`, root package `com.punenest.api` |
| Base URL | `/api` (nominal dev `http://localhost:8080/api`; 8080 is often occupied — run on 8081) |
| Auth | Stateless JWT, `Authorization: Bearer <token>`; roles `buyer` / `owner` / `admin` / `staff` (staff has `team`/`teams`) |
| Login | OTP-verified mobile (`/auth/login`); internal `/auth/staff-login` — **no passwords** |
| Pagination | `?page=0&size=20` (zero-indexed), wrapper `{content,page,size,totalElements,totalPages,sort}` (wire field is `content`, NOT `items`) |
| Sort | `?sort=field,direction` e.g. `sort=createdAt,desc` |
| Dates | ISO-8601 (`2026-07-03T10:30:00Z`) |
| IDs | String; UUID in prod (mock uses `PR{ts}` etc.) |
| Errors | `{ "error": "code", "message": "...", "status": 400 }` |
| DB | PostgreSQL, `snake_case` columns, Flyway migrations, JSONB for flexible/array fields |
| Caching | Cache-at-write for fixed, expensive facts; key on stable inputs |

## System-design workflow (start here)

The immediate goal is a **strong foundation before coding**. Work through the phases in
`references/system-design.md` in order — do not skip to controllers:

0. **Freeze the contract** — confirm the OpenAPI spec (`…/static/openapi/punenest-api.yaml`) covers the domains you will build; patch gaps first.
1. **Data model** — turn the contract Data Model Reference into an ERD + Flyway `V1` schema
   (`references/data-model.md`).
2. **Cross-cutting foundation** — JWT + role guards, error handling, pagination, CORS, OpenAPI,
   config profiles (dev-mock / prod), and the provider seams.
3. **Vertical slices by priority** — auth+users -> properties+search -> contacts/gate -> deals/offers/
   visits -> finance/rent -> services/tickets -> admin/analytics -> content/CMS.
4. **Wire the frontend** — add the domain to `VITE_API_DOMAINS` and reconcile any shape drift against the spec.

## Working procedure

1. Read the relevant paths in the OpenAPI spec and the auth/identity slice before writing code.
2. Pick one vertical slice; design entity + migration first, then repository/service/controller/DTOs.
3. Keep shapes byte-compatible with the spec (and the mock provider); add tests that assert them.
4. Build & run from `backend/` with JDK 25 pinned:
   `$env:JAVA_HOME='C:\Program Files\Zulu\zulu-25'; cmd /c "mvnw.cmd -o -f pom.xml verify"`. Keep the
   app runnable with mock providers only.
5. Review per the repo Code-Review policy: use `java-reviewer`, then `code-reviewer`, and
   `security-reviewer` for any auth/user-data change.

## References (read when relevant)

- [references/architecture.md](./references/architecture.md) — Spring Boot layering, package-by-feature layout, DTO/record style,
  constructor injection, JWT & role guards, the contact-gate filter, error handling, pagination,
  the provider-seam pattern, caching, config profiles, and the build/run/test commands.
- [references/data-model.md](./references/data-model.md) — the full PostgreSQL schema grouped by domain, Flyway migration
  conventions, PK/FK/index/JSONB/soft-delete rules, and the entity-mapping guidance.
- [references/system-design.md](./references/system-design.md) — the phased roadmap that takes the project from contract to a live,
  frontend-wired API, with the recommended module build order and per-slice checklist.
