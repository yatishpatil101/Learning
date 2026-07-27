# PuneNest — Documentation

Authoritative documentation set for PuneNest (Pune-first real-estate marketplace). This is the
**API-build reference**: the React app currently holds most business logic in a mock service layer;
these docs capture that logic in detail so it can be re-implemented server-side.

## Reading order
1. [`system/app-architecture.md`](./system/app-architecture.md) — context, tech stack, mock→http seam, deployment shape.
2. [`system/data-model.md`](./system/data-model.md) — data model & persistence design (ER map, DB conventions, migration; entity field shapes → OpenAPI schemas).
3. [`system/cross-cutting.md`](./system/cross-cutting.md) — auth/roles, contact + Aadhaar gate, **maker-checker**, soft-delete/audit, pagination, provider seams, error shape.
4. [`OpenAPI spec`](../backend/src/main/resources/static/openapi/punenest-api.yaml) — the REST API contract (single source of truth; Swagger UI at `/docs`).
5. [`system/platform-architecture.md`](./system/platform-architecture.md) — platform/solution architecture: components, diagrams, ADRs, scoring (living doc).
   - [`system/legal-entity-and-compliance.md`](./system/legal-entity-and-compliance.md) — India entity choice (Pvt Ltd), SPICe+ registration roadmap, compliance checklist, tax/funding, IP, MahaRERA/DPDP (launch-gate advisory).
6. [`flows/`](./flows/) — per-feature deep dives (business logic, state machines, edge cases). Start from [`flows/_TEMPLATE.md`](./flows/_TEMPLATE.md).
6. [`roadmap/build-roadmap.md`](./roadmap/build-roadmap.md) — phased backend build order.

## Map
```
docs/
  system/     architecture, platform-architecture, legal-entity-and-compliance, data-model, cross-cutting, design-system
  flows/      _TEMPLATE.md + consumer/ admin/ ops/ per-feature docs
  roadmap/    build-roadmap, mobile-app-plan, ai-ml-libraries
  misc/       packing-plan
```

## Conventions
- **Maker-checker** is defined once in [`system/cross-cutting.md`](./system/cross-cutting.md); flow docs reference it.
- Entity **field shapes** are defined once in the [`OpenAPI spec`](../backend/src/main/resources/static/openapi/punenest-api.yaml) (component schemas); [`system/data-model.md`](./system/data-model.md) owns the ER map + persistence design. Flow docs link, not re-define.
- Every flow doc follows [`flows/_TEMPLATE.md`](./flows/_TEMPLATE.md) so each reads as a drop-in API spec.

## Traceability
- [`coverage-matrix.md`](./coverage-matrix.md) - one row per flow doc mapping feature -> flow doc -> API domain -> entities, with the primary role(s) and whether a maker-checker loop applies.

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
- [`flows/consumer/rent-tenancy.md`](./flows/consumer/rent-tenancy.md) - Rent payments, ledgers, and tenancy management.
- [`flows/consumer/saved-alerts.md`](./flows/consumer/saved-alerts.md) - Saved properties, saved searches, and match notifications.
- [`flows/consumer/schedule-visit.md`](./flows/consumer/schedule-visit.md) - Book a property visit; owner confirms/completes it.
- [`flows/consumer/search-listings.md`](./flows/consumer/search-listings.md) - Public buy/rent discovery: filters, map, and save-search.
- [`flows/consumer/services-calculators.md`](./flows/consumer/services-calculators.md) - Services hub plus EMI/affordability calculators.
- [`flows/consumer/share-a-flat.md`](./flows/consumer/share-a-flat.md) - Flatmate posts, rooms, and share groups.
- [`flows/consumer/societies.md`](./flows/consumer/societies.md) - Society and locality pages, claims, and reviews.
- [`flows/consumer/support-tickets.md`](./flows/consumer/support-tickets.md) - Customer support tickets and FAQ.

### Admin flows (9)
- [`flows/admin/analytics.md`](./flows/admin/analytics.md) - Platform KPIs and funnel analytics.
- [`flows/admin/content-localities-societies.md`](./flows/admin/content-localities-societies.md) - CMS content, localities, and society moderation.
- [`flows/admin/enquiries-funnel.md`](./flows/admin/enquiries-funnel.md) - Enquiries and deals funnel tracking.
- [`flows/admin/finance.md`](./flows/admin/finance.md) - Revenue, fees, and transaction ledger views.
- [`flows/admin/property-verification.md`](./flows/admin/property-verification.md) - Listing verification queue (canonical maker-checker).
- [`flows/admin/services-moderation.md`](./flows/admin/services-moderation.md) - Service-request desk, assignment, and moderation.
- [`flows/admin/settings-team-staff.md`](./flows/admin/settings-team-staff.md) - Platform settings, team, and staff accounts.
- [`flows/admin/trust-safety-reports.md`](./flows/admin/trust-safety-reports.md) - Reports triage and moderation actions.
- [`flows/admin/users-kyc.md`](./flows/admin/users-kyc.md) - User management and KYC/verification decisions.

### Ops flows (2)
- [`flows/ops/service-queues.md`](./flows/ops/service-queues.md) - Shared back-office work queues for service fulfilment.
- [`flows/ops/referrals-fraud.md`](./flows/ops/referrals-fraud.md) - Referral verification and fraud-review queue.
