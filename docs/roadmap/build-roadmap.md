# Draazy - Backend Build Roadmap

> A phased, dependency-ordered build order for the Draazy backend (Spring Boot 4.1.0 / Java 21 + PostgreSQL)
> that replaces the current localStorage mock. Each phase is executable by a small team and ends
> with concrete exit criteria.
>
> Read alongside:
> - [`OpenAPI spec`](../../backend/src/main/resources/static/openapi/draazy-api.yaml) - the REST API
>   contract this plan sequences (single source of truth).
> - [`../system/data-model.md`](../system/data-model.md) - ER map + PostgreSQL persistence design.
> - [`../system/cross-cutting.md`](../system/cross-cutting.md) - auth, maker-checker, contact/Aadhaar
>   gate, soft-delete/audit, pagination, provider seam, notifications.
>
> **Note on inputs:** the local backend skill at
> `C:\Users\E159518\.copilot\skills\draazy-backend\SKILL.md` (and its `references/*.md`) could not
> be read in this environment (permission denied), so it was not incorporated. If that skill becomes
> available it may add framework-specific conventions on top of this plan; nothing here should
> conflict with it.

---

## 1. Guiding principles

1. **Build in dependency order, not feature order.** Every write path ultimately hangs off two
   roots: `users` (identity) and `properties` (the listing). Nothing that references a user or a
   listing can be trusted before those tables and their auth exist. The phases below always deliver
   a producer before its consumers (users before listings, listings before leads, leads before
   deals, deals before rent/finance).

2. **Move business logic across the trust boundary.** Today the mock layer *is* the business logic
   and runs in editable browser `localStorage`; guards, roles, the Aadhaar/contact gate, and every
   maker-checker approval are UX-only (see cross-cutting sections 1-4). The backend must own each
   rule server-side: authenticate via Bearer JWT, authorize every request by role/team, verify the
   maker's identity and the checker's authority, apply approval side-effects transactionally, and
   write audit rows the client cannot forge. Treat the client role/team as a hint, never a grant.

3. **Keep the provider seam intact (`mock -> http`).** The frontend already talks to
   `services/*Service.js -> createProvider(domain) -> mock | http` and swaps backends with one env
   var (`VITE_API_MODE`). The backend's job is to make the `http` provider a drop-in replacement:
   honor the exact endpoint shapes, the paginated wrapper
   (`{ content, page, size, totalElements, totalPages }`), and the canonical error shape
   (`{ error, message, status }`). Ship a phase's endpoints for the `http` provider without
   requiring any component change; the `mock` provider stays runnable in parallel for every domain
   not yet cut over.

4. **Bake cross-cutting concerns in from Phase 0.** Auth enforcement, soft-delete
   (`archived`/`archived_at`/`archive_reason`), `created_at`/`updated_at`, the `audit_log`, and
   pagination/sort/filter are not a later "hardening" phase - they are columns and middleware every
   later phase reuses. Establish them once (Phase 0-1) and apply them everywhere.

5. **Natural keys become foreign keys.** The prototype keys owner-scoped collections by 10-digit
   mobile (`draazyDeals:<ownerDigits>`, `dzOffers:<ownerDigits>`, `buyerMobile`, ...). During
   migration every `*Mobile` field resolves to a `users.id` foreign key (see the mobile-keying note
   in the domain model). Do this at the boundary of the phase that first owns the entity.

---

## 2. Phased plan

### Phase 0 - Foundation (infra, config, DB, migrations)

- **Goal:** a deployable, empty backend with the database, migration tooling, shared conventions,
  and read-only config in place. No user-facing domain logic yet.
- **API domains covered:** #33 Platform Fees (read-only `/fees`); the settings/config slice of
  #29 (`/admin/settings` schema, not the analytics endpoints).
- **Entities / tables:** migration baseline; `settings`; `platform_fees` (or a config table backing
  `/fees`); the `audit_log` table skeleton; shared column conventions applied to every future table
  (`created_at`, `updated_at`, `archived`, `archived_at`, `archive_reason`, `timestamptz`, integer
  INR money).
- **Dependencies:** none (this is the root).
- **Exit criteria:** app boots against PostgreSQL; migrations run clean forward and back; `/fees`
  and `/admin/settings` return seeded config; pagination/sort/filter helpers, the error-shape
  serializer, and the audit-write helper exist and are unit-tested; `http` provider can reach the
  server for these two read paths.

### Phase 1 - Identity and access (auth, users, roles/guards)

- **Goal:** server-enforced authentication and authorization - the trust boundary that every later
  phase relies on.
- **API domains covered:** #1 Auth; #5 Users (Admin).
- **Entities / tables:** `users` (with `role`, `team`, `teams[]`, `moduleAccess[]`, `status`),
  session/JWT issuance and revocation, staff creation.
- **Dependencies:** Phase 0.
- **Cross-cutting:** implement cross-cutting section 1 (auth and roles) server-side - Bearer JWT,
  `ProtectedRoute`/`RoleRoute`/`ModuleRoute` equivalents enforced on the server; every
  admin mutation writes `audit_log` (section 4); user archive/restore uses soft-delete (section 4).
  **Team scoping: met.** `ServiceDeskAuthority.deskFilterFor` derives a staff caller's desk from
  their principal and ignores a `team` they do not own (D44), which is why the client-side
  `TeamRoute` guard could be deleted outright rather than mirrored.
- **Exit criteria:** login/staff-login issue JWTs; `/auth/me` and role/team/module authorization are
  enforced server-side and covered by tests (including negative/forbidden cases); admin user
  list/detail/update/archive/restore work with pagination and `archived` filtering; the `http`
  provider serves `auth` and `users` end to end.

### Phase 2 - Listings, search, and localities

- **Goal:** the property catalog - create, moderate, publish, and search listings.
- **API domains covered:** #2 Properties (Public, search/filters), #3 Owner Listings, #4 Properties
  Admin (status/feature/flag/archive/restore), #24 Localities.
- **Entities / tables:** `properties`, `localities`, `societies` (curated reference).
- **Dependencies:** Phase 1 (owner identity; admin authorization for moderation).
- **Cross-cutting:** listing lifecycle is the canonical maker-checker example (section 2): owner
  creates `status: pending`, admin/manager approves to go live. Search honors pagination/sort/filter
  (section 5); archive is soft-delete (section 4); every admin action audits (section 4). Full
  verification-review thread and decision are wired in Phases 3-4/6, but the `pending -> approved`
  status transition lands here.
- **Exit criteria:** public `/properties` search returns correct, paginated, filtered results;
  owners can create/update their listings (foundation-field edits revert to `pending`); admin can
  approve/reject/feature/flag/archive/restore with audit; archived and unapproved listings are
  excluded from public reads; `http` provider serves `property`.

### Phase 3 - Leads, contact/Aadhaar gate, and visits

- **Goal:** connect seekers to listings behind the identity and approval gates - the first
  server-owned trust gate on user data.
- **API domains covered:** #6 Verification and KYC (Aadhaar identity gate + review-thread
  initiation), #7 Contacts, #11 Visits, #12 Enquiries and Messages.
- **Entities / tables:** `aadhaar_verifications`, `contact_requests`, `visits`, `enquiries`,
  `messages`, `property_reviews` + `review_messages` (thread created here; decision in Phase 4/6).
- **Dependencies:** Phase 1 (buyer identity), Phase 2 (listing to enquire on).
- **Cross-cutting:** implement the contact/Aadhaar gate (section 3) fully server-side - refuse
  `POST /contacts/request` with `403 { "error": "aadhaar_required" }` until KYC is verified, keep the
  owner number masked until an approved request (respecting `hideNumber`), and never ship the raw
  number to an unapproved client. Contact reveal and visit confirmation are maker-checker flows
  (section 2). Approvals emit notifications (section 7).
- **Exit criteria:** a buyer cannot obtain an owner number without verified Aadhaar and an approved
  request, proven by tests; visits and enquiries create/list correctly with authorization; the mask
  is applied server-side; `http` provider serves `contact`.

### Phase 4 - Deals, offers, finalization, and property verification

- **Goal:** the transaction core - negotiate, finalize deals under maker-checker, and complete
  listing verification decisions.
- **API domains covered:** #8 Deals and Under Offer, #9 Maker-Checker Finalization, #10 Offers and
  Negotiation; the checker/decision side of #6 (property verification decision).
- **Entities / tables:** `deals`/`deal_state`, `offers`, `finalization_requests`; completion of
  `property_reviews` decision + per-document checklist.
- **Dependencies:** Phase 2 (listing), Phase 3 (an interested, contact-gated buyer and the review
  thread).
- **Cross-cutting:** this phase is dense with maker-checker (section 2) - offer accept/counter,
  buyer-requests-finalize / owner-accepts (accept closes the deal and auto-declines other pending
  requests for that property), and admin approve/reject of a listing review. All side-effects must be
  transactional and audited (section 4); finalizing a rent deal creates a tenancy (consumed in
  Phase 5). Notifications fire on every outcome (section 7).
- **Exit criteria:** offers and finalization enforce authority (only the listing owner can accept;
  only the requesting buyer can cancel), side-effects apply atomically, audit rows are written, and
  a rent-deal finalization produces a `tenancies` row; `http` provider serves `deal`.

### Phase 5 - Documents, rent agreements, finance, and the tenant's rental record

- **Goal:** post-deal money and paperwork - the owner/tenant lifecycle after a deal closes.
- **API domains covered:** #15 Finance (Owner), #16 Documents, #17 Tenant Rentals, #18 Tenancies,
  #19 Tenant Profiles, #28 Rent Agreements.
- **Entities / tables:** `transactions`, `ownership_basis`, `documents`, `document_requests`,
  `tenant_rentals`, `tenancies`, `tenant_profiles`,
  `rent_agreements`, `owner_kyc`.
- **Dependencies:** Phase 4 (tenancy created on finalization), Phase 3 (document access reuses the
  request-and-approve gate).
- **Cross-cutting:** document access is maker-checker (section 2 - buyer requests a category, owner
  grants, matching docs are shared by token); finance summaries
  and dues are server-computed; all reads are owner/tenant-scoped and audited (section 4).
- **Exit criteria:** documents upload/share only through the gate; finance summary/cashflow/dues are
  correct and scoped; a tenant's self-declared rental derives its own totals server-side;
  `http` provider serves `finance`.

**What #17 used to be, and why it is not that now.** This phase originally shipped a tenant-to-owner
**rent payment** rail - `rent_payments`, `rent_mandates` and `payout_accounts`, with a platform
fee and GST computed server-side from Phase 0 config and posted to the owner's ledger. The money
rule behind it still stands and still applies to every other charge: a fee the client computes is a
fee the client can change, so it is computed once, on the server, from configuration the client
never supplies. The rail itself was withdrawn in **V127** because Draazy is not a payments
business and a dormant money path costs more to keep honest than it earns. **V128** replaced it with
`tenant_rentals`: one self-declared record per tenant, from which the server derives months paid,
lifetime total and the financial-year total. Nothing on it moves money, and nothing on it is
evidence - which is why the Rent Passport does not read it.

### Phase 6 - Back-office ops, services marketplace, and referrals

- **Goal:** the internal operations surface - team-scoped work queues, moderation, analytics, the
  service (interior/legal/valuation/packers) marketplace, referrals, and growth capture.
- **API domains covered:** #13 Service Requests / Tickets, #27 Service Workflows (rent agreement,
  valuation, etc.), #22 Referrals, #23 Reviews and Ratings, #25 Reports (listing moderation),
  #26 Flatmates, #29 Admin Analytics and Settings (analytics/audit-log/finance dashboards),
  #32 Society Leads.
- **Entities / tables:** `tickets`, `service_requests`, `referrals`, `entity_reviews`, `reports`,
  `flatmate_requests` + `rooms`, `society_leads`, analytics read models, and the full `audit_log`
  read API.
- **Dependencies:** Phases 1-5 (queues and analytics aggregate users, listings, leads, deals, and
  finance).
- **Cross-cutting:** team scoping is **met** for service requests (`ServiceDeskAuthority`, D44) and
  still owed for the ticket board; admin RBAC server-side
  (section 1); service workflows are staff-driven maker-checker with draft-share and
  approve/reject (section 2); moderation and every ops mutation append immutable internal notes and
  `audit_log` rows (section 4); analytics endpoints are read-only and admin-scoped.
- **Exit criteria:** ops staff see only their team's tickets; service-workflow draft/decision/final
  transitions are authorized and audited; reports/reviews moderation and society-lead capture work;
  admin analytics/audit-log/finance dashboards return correct aggregates.

### Phase 7 - Notifications, saved/alerts, plans/billing, support, and content

- **Goal:** engagement, monetization, and self-serve support - the consumer-facing layer that sits
  on top of everything.
- **API domains covered:** #14 Support Tickets (Customer), #20 Saved Properties and Searches (+
  alerts), #21 Plans, Boosts and Service Orders, #30 Content / CMS (including `/notifications`),
  #31 Cities and Waitlist.
- **Entities / tables:** `support_tickets` + `ticket_messages`, `saved_properties`,
  `saved_searches`, `plans`, `service_orders`, boosts, `announcements`, `faqs`, `banners`,
  `notifications`, `cities`, waitlist.
- **Dependencies:** Phases 1-6 (notifications are emitted by earlier phases' approvals; saved
  searches query the Phase 2 catalog; plans/boosts gate listing limits from Phase 2; service orders
  relate to the Phase 6 marketplace).
- **Cross-cutting:** notification generation MUST be a server side-effect of approvals and state
  changes, not client-seeded (section 7); plan/boost entitlements (listing limits, featured slots)
  are enforced server-side; support tickets are per-user scoped with an admin view; content
  archive/restore uses soft-delete (section 4).
- **Exit criteria:** notifications are generated server-side and delivered per user; saved-search
  alerts match against live listings; plan/boost limits are enforced on the server; support and CMS
  content endpoints are complete; all providers cut over to `http` and the `mock` seam is retired
  from production (still runnable for local dev/tests).

---

## 3. Domain-to-phase mapping

Every one of the 33 API domains maps to a primary phase. A few domains are split because
the contract groups a user-facing capability with an admin/checker capability; the "Notes" column
records the secondary phase.

| # | API domain | Primary phase | Notes |
|---|-----------|---------------|-------|
| 1 | Auth | Phase 1 | Root of the trust boundary. |
| 2 | Properties (Public) | Phase 2 | Search/filter/pagination. |
| 3 | Owner Listings (My Properties) | Phase 2 | Maker side of listing verification. |
| 4 | Properties - Admin | Phase 2 | Status/feature/flag/archive; moderation depth in Phase 6. |
| 5 | Users (Admin) | Phase 1 | Needs role/team auth. |
| 6 | Verification and KYC | Phase 3 | Aadhaar gate + review thread here; property-verification decision in Phase 4. |
| 7 | Contacts | Phase 3 | Contact reveal (contact/Aadhaar gate). |
| 8 | Deals and Under Offer | Phase 4 | Transaction core. |
| 9 | Maker-Checker Finalization | Phase 4 | Creates tenancy for rent deals (Phase 5). |
| 10 | Offers and Negotiation | Phase 4 | Feeds finalization. |
| 11 | Visits | Phase 3 | Maker-checker slot confirmation. |
| 12 | Enquiries and Messages | Phase 3 | Lead capture. |
| 13 | Service Requests / Tickets | Phase 6 | Ops queues (team-scoped). |
| 14 | Support Tickets (Customer) | Phase 7 | Consumer support. |
| 15 | Finance (Owner) | Phase 5 | Server-computed summaries/dues. |
| 16 | Documents | Phase 5 | Document-access maker-checker gate. |
| 17 | Tenant Rentals | Phase 5 | Self-declared; totals derived server-side. Replaced the withdrawn rent-payment rail (V127/V128). |
| 18 | Tenancies | Phase 5 | Created on Phase 4 finalization. |
| 19 | Tenant Profiles | Phase 5 | Input to rent finalization. |
| 20 | Saved Properties and Searches | Phase 7 | Alerts. |
| 21 | Plans, Boosts and Service Orders | Phase 7 | Service-orders relate to Phase 6 marketplace. |
| 22 | Referrals | Phase 6 | Includes fraud-review queue. |
| 23 | Reviews and Ratings | Phase 6 | Moderation. |
| 24 | Localities | Phase 2 | Geographic reference for listings. |
| 25 | Reports (Listing Moderation) | Phase 6 | Trust and Safety. |
| 26 | Flatmates | Phase 6 | Secondary marketplace + admin moderation. |
| 27 | Service Workflows | Phase 6 | Staff-driven draft/decision maker-checker. |
| 28 | Rent Agreements | Phase 5 | Owner KYC + agreement records. |
| 29 | Admin - Analytics and Settings | Phase 6 | Settings/config slice bootstrapped in Phase 0. |
| 30 | Content / CMS | Phase 7 | Includes `/notifications`. |
| 31 | Cities and Waitlist | Phase 7 | Growth/marketing. |
| 32 | Society Leads | Phase 6 | Admin lead capture. |
| 33 | Platform Fees (Read-only) | Phase 0 | Config backing finance math. |

**Split domains at a glance:** #6 spans Phase 3 (Aadhaar gate + review thread) and Phase 4 (property
verification decision); #4 spans Phase 2 (listing lifecycle) and Phase 6 (deep moderation); #29 spans
Phase 0 (settings schema) and Phase 6 (analytics/audit-log/finance dashboards); #21 is primarily
Phase 7 (plans/boosts) with a service-orders tie to Phase 6.

---

## 4. Cross-cutting requirements per phase

Each phase must satisfy the relevant sections of
[`../system/cross-cutting.md`](../system/cross-cutting.md). This table makes the obligations explicit
so no phase silently skips a trust boundary.

| Phase | Auth enforcement (section 1) | Maker-checker (section 2) | Contact/Aadhaar gate (section 3) | Soft-delete + audit (section 4) | Other |
|-------|------------------------------|---------------------------|----------------------------------|---------------------------------|-------|
| 0 | JWT middleware and error shape (section 6) scaffolded | - | - | `audit_log` table + write helper; soft-delete columns as a convention | Pagination/sort/filter helpers (section 5); `/fees` + settings config. |
| 1 | Full role/team/module authorization enforced server-side; two login doors | - | - | User archive/restore soft-delete; every admin mutation audits | Provider seam: `auth`, `users` on `http`. |
| 2 | Owner-only writes; admin-only moderation | Listing verification (canonical example) | - | Listing archive/restore; audit on approve/reject/feature/flag | Search honors pagination/sort/filter; archived/unapproved hidden from public reads. |
| 3 | Buyer identity required; owner-scoped reads | Contact reveal, visit confirmation | Aadhaar 403 gate + number mask enforced server-side | Requests/threads audited | Notifications on approval (section 7). |
| 4 | Only listing owner may accept; only requester may cancel | Offers, finalization, property-verification decision - transactional side-effects | Contact gate remains a precondition | Every decision writes audit; internal notes never deleted | Rent finalization creates tenancy; notifications on outcome. |
| 5 | Owner/tenant-scoped access to money and docs | Document-access grant/decline | Document sharing sits behind the request gate | Finance/doc mutations audited; soft-delete where applicable | Platform fee/GST computed server-side from Phase 0 config. |
| 6 | Team scoping + admin RBAC on all ops queues | Service-workflow draft-share and decision; society claims; report/review moderation | - | Immutable internal notes + `audit_log` on every ops action | Analytics read-only, admin-scoped. |
| 7 | Per-user scoping (support, saved, plans); admin views | - | - | Content archive/restore soft-delete | Notifications generated server-side (section 7); plan/boost entitlements enforced server-side. |

> **Non-negotiable across all phases:** the client is never trusted to flip a `status` to
> `approved`, to compute a fee, to unmask a number, or to author an audit `who`. Each phase ships its
> endpoints into the `http` provider without breaking the `mock -> http` seam, so the frontend cuts
> over one domain at a time by changing configuration, not components.
