# PuneNest backend — system design roadmap

How to go from "React frontend + API contract" to a live, frontend-wired Spring Boot + PostgreSQL
backend, without boiling the ocean. The organizing idea: **freeze the contract, build the data model
and cross-cutting foundation once, then ship vertical slices in priority order, then flip the
frontend to `http`.** Do the phases in order; each assumes the previous is stable.

## System context (the big picture)

```
React SPA ──> src/services/*Service.js ──> providers/http/ ──HTTP(/api)──> Spring Boot ──> PostgreSQL
                                    │
                                    └─ providers/mock/ (localStorage)   [today]

Spring Boot ──> provider seams ──> OTP/SMS | KYC/Aadhaar | Payments | File storage
                                   (mock impls in dev; real @Primary in prod)
```

- One deployable Spring Boot service (a modular monolith), not microservices — the domain is
  cohesive and a monolith is the laziest-that-works choice at this stage (`ponytail`). Keep features
  in separate packages so they *could* be split later if load demands it.
- Stateless (JWT) so it scales horizontally behind a load balancer; all state in PostgreSQL.
- External integrations are always behind seams so dev/demo needs zero paid keys.

## Phase 0 — Freeze the contract

Goal: no surprises later. Before modeling anything:

- Read the target domains in the OpenAPI spec (`backend/src/main/resources/static/openapi/punenest-api.yaml`)
  end to end; confirm every endpoint you plan to build has request params, auth level, and response shape defined.
- Diff against the frontend `providers/mock/` output for those domains — the mock is the concrete
  reference for exact field names/casing. Note any drift and reconcile it in the contract.
- Output: a short list of contract gaps to patch (if any), patched before coding.

## Phase 1 — Data model & V1 schema

Goal: a PostgreSQL schema the whole app stands on. See `references/data-model.md`.

- Draw the ERD from the contract Data Model Reference (users -> properties -> deals/offers/visits/
  contacts, plus finance/document/service/verification/social/admin clusters).
- Write `V1__init.sql`: extensions (pgcrypto), core tables (users, properties, localities) and the
  minimum verification/auth tables needed to log in and gate contacts. Include `archived`/`archived_at`
  on soft-deletable tables and the core indexes.
- Add repeatable seeds (`R__seed_*.sql`) for localities / plans / platform fees so dev has content.
- Verify: `mvn -q verify` runs migrations against a local/dev Postgres cleanly.

## Phase 2 — Cross-cutting foundation

Goal: build the plumbing once so every slice reuses it. In `com.punenest.api.common` /
`com.punenest.api.security`:

- **Security**: `JwtService` (issue/verify), `JwtFilter`, `SecurityConfig` (role rules), a way to
  read the current principal. Wire the OTP provider seam for `/auth/login`.
- **Error handling**: `ApiError` record + `GlobalExceptionHandler` mapping domain exceptions to the
  contract error codes (`not_found`, `aadhaar_required`, `unauthorized`, `forbidden`, validation).
- **Pagination**: `PageResponse<T>` wrapper + a convention for reading `page/size/sort`.
- **CORS + OpenAPI**: allow the Vite dev origin; expose springdoc UI for manual testing.
- **Config profiles**: `dev` (mock providers, local DB) and `prod` (real providers, env secrets).
- **Provider seams**: define the interfaces (`OtpSender`, `KycProvider`, `PaymentGateway`,
  `FileStorage`) in `com.punenest.api.provider` with deterministic mock impls; the real impl is
  `@Primary` only when its profile/keys are present (see the `cashfree/` payment impl).

Exit criteria: the app boots on `/api` (`:8080`, or `:8081` if 8080 is occupied), `/api/auth/login`
issues a JWT via the mock OTP seam, and a protected ping endpoint enforces roles.

## Phase 3 — Vertical slices (priority order)

Build one domain at a time, full stack (entity -> repo -> service -> controller -> DTOs -> tests),
each keeping shapes byte-compatible with the contract. Recommended order (value-first, dependency-aware):

1. **Auth & users** — login/OTP, `/auth/me`, user admin, Aadhaar verification.
   Everything else needs identity + the Aadhaar flag.
2. **Properties & search** — public search/detail, owner listings CRUD, admin status/
   archive/restore. Enforce the **foundation-field -> status `pending`** rule and soft-delete here.
   This is the product's core; get pagination/filtering/sorting exactly right.
3. **Contacts & the gate** — contact requests + the Aadhaar gate + owner-mobile masking. Depends
   on 1 and 2.
4. **Deals, offers, visits, enquiries, finalization** — the transaction lifecycle,
   incl. maker-checker finalization.
5. **Finance & rent** — transactions, documents, rent payments (platform fee),
   tenancies, tenant profiles.
6. **Services & tickets** — service requests, support tickets + messages, service
   workflows, rent agreements. Assign to staff teams.
7. **Admin & analytics** — KPIs, moderation reports, platform fees, settings, audit log.
8. **Content/CMS & the long tail** — announcements, saved
   properties/searches, plans/boosts, referrals, reviews, localities, share-a-flat, cities/waitlist,
   society leads.

### Per-slice checklist

For each slice:
- [ ] Re-read that domain in the OpenAPI spec and the matching `providers/mock/` / `providers/http/`.
- [ ] Migration `V{n}` for any new tables/columns (if not already in V1).
- [ ] Entity + repository (public queries exclude archived).
- [ ] Service with the business rules (gating, status transitions, masking, audit-log writes).
- [ ] Controller under `/api/...`, thin, role-guarded, `@Valid` on inputs.
- [ ] DTO records matching contract field names; mapper hides sensitive fields.
- [ ] Tests asserting the JSON shape + the key rules (e.g. `aadhaar_required` 403, masked mobile).
- [ ] `mvn -q verify` green; app still runs with mock providers only.
- [ ] Review: `java-reviewer` -> `code-reviewer` -> `security-reviewer` (for auth/user-data slices).

## Phase 4 — Wire the frontend

Goal: prove the swap. Component code must not change.

- Point the frontend `http` provider base URL at the running API (`http://localhost:8081/api` if 8080
  is occupied) and add the domain to `VITE_API_DOMAINS` in `src/services/config.js` (`VITE_API_MODE=http`
  is a legacy alias for "all domains").
- Walk the key flows (search, listing detail + contact gate, owner dashboard, admin moderation) and
  reconcile any shape drift against the contract — fix the backend to match, not the frontend.
- Add a thin set of Playwright checks (reuse the repo `tests/*.spec.js` harness) against the live API
  for the critical journeys.
- Keep `mock` mode working as the offline/demo fallback.

## Guardrails throughout

- **Contract compatibility over cleverness** — the frontend is done; the backend conforms to it.
- **Runnable with zero keys** — mock seams stay the default in dev.
- **Soft-delete + audit** — no hard deletes; log state changes to `audit_log`.
- **Enforce trust rules server-side** — Aadhaar gate, mobile masking, foundation-field status
  reversion are domain rules, not UI decoration.
- **Ship slices, not layers** — a working `/properties` beats a half-wired everything.
