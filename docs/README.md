# Draazy — Documentation

Written documentation for Draazy (Pune-first real-estate marketplace).

These docs were originally the **API-build reference**: the React app held the business logic in a
mock service layer, and the docs captured it so it could be re-implemented server-side. **That
purpose is now largely discharged** — the backend exists. So the rule changed:

> **If a machine already enforces a fact, the docs do not restate it.** They carry the *reasoning*,
> which no test can hold.

## Who owns which fact

| Fact | Source of truth | What keeps it honest |
|---|---|---|
| Endpoint paths, params, status codes, schemas | [OpenAPI spec](../backend/src/main/resources/static/openapi/draazy-api.yaml) (Swagger UI at `/docs`) | `SpecCoverageTest` — fails the build on served-but-undeclared **and** declared-but-unhandled |
| Physical database schema | `backend/src/main/resources/db/migration/**` | Flyway `validate` on every boot |
| What the mock layer does | `frontend/src/lib/mockApi/**` | the parity harnesses (`npm run parity:*`) |
| Which domains are live | `VITE_API_DOMAINS` in `e2e/playwright.config.js` | the live e2e run |
| Test coverage | [`../e2e/COVERAGE.md`](../e2e/COVERAGE.md) | `check-coverage-citations.mjs` |
| **Business rules, and why** | **`flows/` §1–§8** | nothing — this is why it is written down |

## Reading order

1. [`system/platform-architecture.md`](./system/platform-architecture.md) — components, ADRs, vendor decisions, deployment shape, SLOs (living doc).
2. [`system/package-structure.md`](./system/package-structure.md) — the 11 bounded contexts → packages → Flyway groups, enforced by `ArchitectureBoundaryTest`.
3. [`system/data-model.md`](./system/data-model.md) — ER map and persistence design. Field shapes live in the OpenAPI schemas; the migrations are the physical schema.
4. [`system/cross-cutting.md`](./system/cross-cutting.md) — auth/roles, contact + Aadhaar gate, **maker-checker**, soft-delete/audit, pagination, provider seams, error shape.
5. [`system/api-standards.md`](./system/api-standards.md) — the conventions the spec is written to.
6. [`flows/`](./flows/) — per-feature deep dives: business logic, state machines, edge cases.
7. [`system/frontend-data-seam.md`](./system/frontend-data-seam.md) — the `services/*` seam, per-domain `mock→http` switching, and the rule that pages never import `lib/mockApi.js`.
8. [`system/design-system.md`](./system/design-system.md) — control sizing scale, the mobile-first system, the design-validation checklist.
9. [`system/trust-and-verification-model.md`](./system/trust-and-verification-model.md) — badge-not-gate, and why freshness beats identity.
10. [`roadmap/build-roadmap.md`](./roadmap/build-roadmap.md) — phased backend build order.
11. [`system/tech-debt.md`](./system/tech-debt.md) — the debt register: everything knowingly deferred, with the trigger that unblocks it. Finished items are **deleted**, not archived.
12. [`system/open-questions.md`](./system/open-questions.md) — decisions the build is waiting on. Separate from the register so the register stays 100% actionable.
13. [`system/legal-entity-and-compliance.md`](./system/legal-entity-and-compliance.md) — entity choice, registration roadmap, MahaRERA/DPDP (launch-gate advisory).

## Map

```
docs/
  system/     platform-architecture, package-structure, data-model, cross-cutting, api-standards,
              design-system, frontend-data-seam, trust-and-verification-model,
              legal-entity-and-compliance, tech-debt, open-questions
  flows/      consumer/ (16) admin/ (10) ops/ (2) — per-feature behavioural specs
  roadmap/    build-roadmap, mobile-app-plan, ai-ml-libraries
  misc/       packing-plan
```

## Conventions

- **Maker-checker** is defined once in [`system/cross-cutting.md`](./system/cross-cutting.md); flow docs reference it.
- Entity **field shapes** are defined once in the OpenAPI component schemas. [`system/data-model.md`](./system/data-model.md) owns the ER map and persistence design. Flow docs link, they do not re-define.
- Every flow doc follows the same 8-section shape: purpose, entry points, actors, entities, **business rules**, maker-checker, state machine, edge cases.
- Flow docs deliberately do **not** carry "target API endpoints", "backend responsibilities" or "current mock implementation" sections. Those were removed on 2026-08-08 — 1,151 lines that restated the spec, the Java tree and the mock source, none of which they could keep in sync. Read the enforced source instead.
- A dated audit or review is **not** a doc. Its findings belong in the register (if actionable), in open-questions (if a decision), or in a standing ruling (if settled). Four such reviews were deleted on 2026-08-08 after every finding was traced to one of those homes.

## Flow index

### Consumer flows (16)
- [`flows/consumer/auth.md`](./flows/consumer/auth.md) - Sign in / sign up and session handling for buyers and owners.
- [`flows/consumer/contact-gate-leads.md`](./flows/consumer/contact-gate-leads.md) - Contact-reveal request/approval and the owner enquiries inbox.
- [`flows/consumer/dashboard-owner-hub.md`](./flows/consumer/dashboard-owner-hub.md) - Owner control panel and buyer/tenant account hub.
- [`flows/consumer/deals-offers-finalization.md`](./flows/consumer/deals-offers-finalization.md) - Offers, negotiation, and maker-checker deal finalization.
- [`flows/consumer/list-property-wizard.md`](./flows/consumer/list-property-wizard.md) - Owner wizard to submit a listing for admin approval.
- [`flows/consumer/plans-billing-refer.md`](./flows/consumer/plans-billing-refer.md) - Plans, billing, and refer-a-friend rewards.
- [`flows/consumer/property-detail.md`](./flows/consumer/property-detail.md) - Single listing view and the contact-reveal gate entry point.
- [`flows/consumer/rent-agreement.md`](./flows/consumer/rent-agreement.md) - Guided rent-agreement drafting with ops fulfilment.
- [`flows/consumer/rent-tenancy.md`](./flows/consumer/rent-tenancy.md) - Tenancies, the tenant's self-declared rental record, and the owner's rent ledger.
- [`flows/consumer/saved-alerts.md`](./flows/consumer/saved-alerts.md) - Saved properties, saved searches, and match notifications.
- [`flows/consumer/schedule-visit.md`](./flows/consumer/schedule-visit.md) - Book a property visit; owner confirms/completes it.
- [`flows/consumer/search-listings.md`](./flows/consumer/search-listings.md) - Public buy/rent discovery: filters, map, and save-search.
- [`flows/consumer/services-calculators.md`](./flows/consumer/services-calculators.md) - Services hub plus EMI/affordability calculators.
- [`flows/consumer/flatmates.md`](./flows/consumer/flatmates.md) - Flatmate discovery (Move in now / Team up), rooms, groups and the owner flat-split.
- [`flows/consumer/societies.md`](./flows/consumer/societies.md) - Society and locality pages, claims, and reviews.
- [`flows/consumer/support-tickets.md`](./flows/consumer/support-tickets.md) - Customer support tickets and FAQ.

### Admin flows (10)
- [`flows/admin/analytics.md`](./flows/admin/analytics.md) - Platform KPIs and funnel analytics.
- [`flows/admin/content-localities-societies.md`](./flows/admin/content-localities-societies.md) - CMS content, localities, and society moderation.
- [`flows/admin/enquiries-funnel.md`](./flows/admin/enquiries-funnel.md) - Enquiries and deals funnel tracking.
- [`flows/admin/finance.md`](./flows/admin/finance.md) - Revenue, fees, and transaction ledger views.
- [`flows/admin/flatmates-moderation.md`](./flows/admin/flatmates-moderation.md) - Flatmate seekers, groups and group applications moderation.
- [`flows/admin/property-verification.md`](./flows/admin/property-verification.md) - Listing verification queue (canonical maker-checker).
- [`flows/admin/services-moderation.md`](./flows/admin/services-moderation.md) - Service-request desk, assignment, and moderation.
- [`flows/admin/settings-team-staff.md`](./flows/admin/settings-team-staff.md) - Platform settings, team, and staff accounts.
- [`flows/admin/trust-safety-reports.md`](./flows/admin/trust-safety-reports.md) - Reports triage and moderation actions.
- [`flows/admin/users-kyc.md`](./flows/admin/users-kyc.md) - User management and KYC/verification decisions.

### Ops flows (2)
- [`flows/ops/service-queues.md`](./flows/ops/service-queues.md) - Shared back-office work queues for service fulfilment and flatmate host verification.
- [`flows/ops/referrals-fraud.md`](./flows/ops/referrals-fraud.md) - Referral verification and fraud-review queue.
