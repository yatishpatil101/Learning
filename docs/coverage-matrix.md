# PuneNest Documentation Coverage Matrix

This matrix is the traceability map for the docs set: it connects each product
feature to its flow doc, the primary role(s) that use it, the numbered API
domain(s) (defined in the [OpenAPI spec](../backend/src/main/resources/static/openapi/punenest-api.yaml)), the key
entities (field shapes in the OpenAPI schemas; ER map + persistence in [`system/data-model.md`](./system/data-model.md)), and whether
the flow is governed by a maker-checker (propose -> approve) loop as defined in
[`system/cross-cutting.md`](./system/cross-cutting.md). Read it as: feature ->
flow doc -> API domain -> entities.

There is one row per flow doc (28 total): 16 consumer, 10 admin, 2 ops.

## Consumer flows

| Feature | Flow doc | Primary role(s) | API domain(s) | Key entities | Maker-checker? |
|---------|----------|-----------------|----------------------------------|--------------|----------------|
| Authentication (Sign In / Sign Up / Session) | [auth.md](./flows/consumer/auth.md) | buyer, owner | 1 Auth | users, aadhaar_verifications, referrals | No |
| Contact Reveal & Leads (Enquiries) | [contact-gate-leads.md](./flows/consumer/contact-gate-leads.md) | buyer/tenant (maker), owner (checker) | 6 Verification & KYC, 7 Contacts | contact_requests, aadhaar_verifications, enquiries | Yes |
| Owner Dashboard / Account Hub | [dashboard-owner-hub.md](./flows/consumer/dashboard-owner-hub.md) | owner, buyer/tenant | 3 Owner Listings, 7 Contacts, 8 Deals & Under Offer, 16 Documents, 20 Saved Properties & Searches, 21 Plans/Boosts/Service Orders | properties, enquiries, visits, contact_requests, documents, saved_properties | No |
| Offers, Negotiation & Deal Finalization | [deals-offers-finalization.md](./flows/consumer/deals-offers-finalization.md) | buyer (maker), owner (checker) | 8 Deals & Under Offer, 9 Maker-Checker Finalization, 10 Offers & Negotiation, 18 Tenancies | deals, offers, finalization_requests, tenancies | Yes |
| List / Post a Property (Owner Wizard) | [list-property-wizard.md](./flows/consumer/list-property-wizard.md) | owner (maker), admin (checker) | 3 Owner Listings, 4 Properties (Admin), 6 Verification & KYC, 16 Documents, 26 Flatmates | listings/properties, rooms, flatmate_requests, aadhaar_verifications, property_reviews, documents | Yes |
| Plans, Billing & Refer-a-Friend | [plans-billing-refer.md](./flows/consumer/plans-billing-refer.md) | owner, seeker (buyer/tenant) | 21 Plans/Boosts/Service Orders, 22 Referrals | plans, service_orders, referrals, users | Yes (referrals; plans self-serve) |
| Property Detail | [property-detail.md](./flows/consumer/property-detail.md) | buyer/tenant (public; owner/admin preview) | 2 Properties (Public), 7 Contacts | properties, contact_requests, saved_properties | No |
| Rent Agreement Creation | [rent-agreement.md](./flows/consumer/rent-agreement.md) | owner (maker), tenant (co-filler), ops rental team (checker) | 13 Service Requests/Tickets, 16 Documents, 27 Service Workflows, 28 Rent Agreements | service_requests, co_fill_invites, service_tickets, documents, tenancies | Yes |
| Rent Payment & Tenancy Management | [rent-tenancy.md](./flows/consumer/rent-tenancy.md) | tenant, owner | 17 Rent Payments, 18 Tenancies, 19 Tenant Profiles, 33 Platform Fees | rent_payments, rent_ledger, platform_fee_ledger, tenancies, tenant_profile | No |
| Saved Properties & Search Alerts | [saved-alerts.md](./flows/consumer/saved-alerts.md) | buyer/tenant/seeker | 20 Saved Properties & Searches (+ /notifications) | saved_properties, saved_searches, notifications, notification_preferences | No |
| Schedule a Property Visit | [schedule-visit.md](./flows/consumer/schedule-visit.md) | buyer/tenant (maker), owner (checker) | 11 Visits | visits, properties | Yes |
| Search & Listings (Buy / Rent discovery) | [search-listings.md](./flows/consumer/search-listings.md) | buyer/tenant (public) | 2 Properties (Public), 20 Saved Properties & Searches, 24 Localities | properties, localities, societies, saved_searches | No |
| Services Hub & Financial Calculators | [services-calculators.md](./flows/consumer/services-calculators.md) | buyer/tenant/owner | 13 Service Requests/Tickets, 21 Plans/Boosts/Service Orders, 27 Service Workflows, 33 Platform Fees | service_tickets, service_requests, service_orders, fees, services_catalog | Yes |
| Flatmates (Move in now / Team up) | [flatmates.md](./flows/consumer/flatmates.md) | buyer/tenant (seeker + host), admin/ops | 26 Flatmates | flatmate_requests, flatmate_groups, rooms, flatmate_reviews, group_applications | Yes |
| Societies & Localities | [societies.md](./flows/consumer/societies.md) | buyer/tenant, owner, resident, society admin, ops/admin (checker) | 23 Reviews & Ratings, 24 Localities, 32 Society Leads | societies, localities, reviews, society_leads | Yes |
| Consumer Support Tickets | [support-tickets.md](./flows/consumer/support-tickets.md) | buyer/owner/tenant, support staff | 14 Support Tickets | support_tickets, ticket_messages, faqs, users | No |

## Admin flows

| Feature | Flow doc | Primary role(s) | API domain(s) | Key entities | Maker-checker? |
|---------|----------|-----------------|----------------------------------|--------------|----------------|
| Admin Analytics | [analytics.md](./flows/admin/analytics.md) | admin, manager | 29 Admin Analytics & Settings, 24 Localities, 25 Reports | listings, enquiries, visits, deals, tickets, users, localities | No |
| Admin Content, Localities & Societies | [content-localities-societies.md](./flows/admin/content-localities-societies.md) | admin, manager | 30 Content/CMS, 24 Localities, 32 Society Leads, 23 Reviews & Ratings | banners, faqs, announcements, reviews, localities, societies | Yes |
| Enquiries & Deals Funnel | [enquiries-funnel.md](./flows/admin/enquiries-funnel.md) | admin, manager, staff | 12 Enquiries & Messages, 11 Visits, 8 Deals & Under Offer | enquiries, visits, deals, audit_log | No |
| Admin Finance | [finance.md](./flows/admin/finance.md) | admin, manager | 29 Admin Analytics & Settings, 33 Platform Fees, 8 Deals & Under Offer, 13 Service Requests/Tickets, 17 Rent Payments | settings.fees, analytics.revenue, deals, tickets, listings, users | No |
| Admin Flatmates Moderation (Seekers, Groups & Applications) | [flatmates-moderation.md](./flows/admin/flatmates-moderation.md) | admin, manager | 26 Flatmates, 25 Reports | flatmate_requests, flatmate_groups, group_applications, internalNotes, audit_log | No |
| Property Verification Queue (Maker-Checker) | [property-verification.md](./flows/admin/property-verification.md) | admin, manager, staff | 4 Properties (Admin), 6 Verification & KYC, 29 Admin Analytics & Settings | properties/listings, property_reviews, review_messages, internalNotes, audit_log | Yes |
| Admin Services Moderation (Service Requests desk) | [services-moderation.md](./flows/admin/services-moderation.md) | admin, manager, staff | 13 Service Requests/Tickets, 27 Service Workflows, 28 Rent Agreements, 30 Content/CMS, 33 Platform Fees | tickets, users, services, settings.fees, audit_log | No |
| Admin Settings, Team & Staff | [settings-team-staff.md](./flows/admin/settings-team-staff.md) | admin (super-admin) | 29 Admin Analytics & Settings, 33 Platform Fees, 5 Users (Admin) | settings, team, audit_log, customRoles | No |
| Trust & Safety - Reports & Moderation | [trust-safety-reports.md](./flows/admin/trust-safety-reports.md) | admin, manager, staff | 25 Reports, 4 Properties (Admin), 5 Users (Admin) | reports, properties, users, internalNotes, audit_log | Yes |
| Users Management & KYC / Verification | [users-kyc.md](./flows/admin/users-kyc.md) | admin, manager, staff | 5 Users (Admin), 6 Verification & KYC, 29 Admin Analytics & Settings | users, internalNotes, audit_log | Yes |

## Ops flows

| Feature | Flow doc | Primary role(s) | API domain(s) | Key entities | Maker-checker? |
|---------|----------|-----------------|----------------------------------|--------------|----------------|
| Ops Service Queues (shared back-office work queues, incl. flatmate verification) | [service-queues.md](./flows/ops/service-queues.md) | staff, admin, manager | 13 Service Requests/Tickets, 27 Service Workflows, 28 Rent Agreements, 21 Plans/Boosts/Service Orders, 26 Flatmates | tickets, serviceFlow, serviceRequest, flatmate_reviews, audit_log, notifications | Yes |
| Ops Referral Verification (fraud-review queue) | [referrals-fraud.md](./flows/ops/referrals-fraud.md) | staff, admin | 22 Referrals, 29 Admin Analytics & Settings | referrals, audit_log | Yes |
