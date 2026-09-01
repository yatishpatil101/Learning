# Draazy - Data Model & Persistence (ADR)

> **Status:** accepted. **Supersedes:** the old `domain-model.md` entity dump.
>
> **What this doc is.** The single source of truth for the **PostgreSQL persistence design**:
> entity relationships, ID / timestamp / money conventions, the localStorage-prototype ->
> PostgreSQL migration, and the seed-vs-contract reconciliations a schema author must settle.
>
> **What this doc is NOT.** It does not define API request/response field shapes. Every entity's
> concrete fields, types and enum values now live in the
> [OpenAPI spec](../../backend/src/main/resources/static/openapi/draazy-api.yaml) (served at
> `/openapi/draazy-api.yaml`, Swagger UI at `/docs`) as component **schemas** - that is the SSOT
> for wire shapes. Use the map below to jump from a domain entity to its schema.

## Entity -> OpenAPI schema map

Flow docs link here by entity name; the field-level truth for each is the named OpenAPI schema.

| Domain entity (seed / mock) | OpenAPI schema(s) |
|---|---|
| users | `User`, `UserUpdate`, `Party`, `Role` |
| properties / listings | `Property`, `PropertySummary`, `ListingCreate`, `ListingUpdate`, `PropertyStatus` |
| localities | `Locality`, `LocalityDetail` |
| societies | `Society`, `SocietyDetail`, `SocietyLead` |
| visits | `Visit`, `VisitCreate` |
| offers | `Offer`, `OfferCreate`, `OfferResponse` |
| deals (owner state + analytics) | `DealIntent` (buy/rent), `Deal` (aggregate: status active/reserved/closed), `DealCloseRequest` |
| contact_requests | `ContactRequest`, `ContactRequestCreate`, `ContactStatus` |
| finalization_requests | `FinalizationRequest`, `FinalizationCreate`, `FinalizationAccept` |
| documents | `Document`, `DocumentRequest`, `DocumentRequestCreate` |
| transactions / finance | `Transaction`, `TransactionCreate`, `FinanceSummary`, `CashflowPoint` |
| ownership_basis | `OwnershipBasis` |
| property_review + review_messages | `PropertyReview` |
| entity_reviews (society/locality/owner) | `Review`, `ReviewCreate` |
| rent (agreement / tenancy) | `RentAgreement`, `Tenancy` |
| tenant_rentals (the tenant's own record) | `TenantRental`, `TenantRentalCreate`, `TenantRentalUpdate` |
| tenant_profile | `TenantProfile` |
| aadhaar_verification | `AadhaarVerification`, `AadhaarSubmit`, `OwnerKyc` |
| saved_searches | `SavedSearch`, `SavedSearchCreate` |
| referrals | `Referral`, `ReferralSummary` |
| service_requests / orders | `ServiceRequest`, `ServiceRequestCreate`, `ServiceOrder`, `ServiceOrderCreate`, `ServiceOffering`, `CmsService` |
| tickets / support | `Ticket`, `TicketCreate`, `TicketUpdate`, `SupportTicket`, `SupportTicketCreate` |
| reports | `Report`, `ReportCreate` |
| reels | `Reel` |
| flatmate_seeker_posts | `FlatmateSeekerPost`, `FlatmateSeekerPostCreate` |
| flatmate_rooms (spare room + owner flat-split) | `FlatmateRoom`, `FlatmateRoomCreate`, `FlatSplitRequest`, `FlatSplitResult` |
| flatmate_groups / flatmate_group_members | `FlatmateGroup`, `FlatmateGroupCreate`, `GroupApplication` |
| flatmate_requests (host inbox) / flatmate_reviews | `FlatmateRequest`, `FlatmateReview`, `AgreementDoc`, `HostEligibility` |
| messages / conversations | `Conversation`, `ConversationCreate`, `Message`, `MessageCreate` |
| plans / subscriptions / boosts | `Plan`, `Subscription`, `Boost`, `BoostPack`, `Fees` |
| settings | `AdminSettings` |
| team / staff | `Team`, `StaffCreate` |
| audit_log | `AuditEntry` |
| banners / faqs / announcements | `Banner`, `Faq`, `Announcement` |
| analytics / admin KPIs | `AnalyticsPoint`, `AdminKpis`, `AdminFinance` |
| notifications | `Notification` |

## Status vocabulary — canonical tokens & UI↔wire mapping

Status enums are owned by the OpenAPI spec (SSOT for wire shapes). Canonical, now-synced sets:

- **Property**: `pending, approved, rejected, flagged, archived`
- **Contact request**: `pending, approved, declined` (gate view adds `owner`, `none`)
- **Offer**: `pending, countered, accepted, declined, withdrawn` — counter direction is carried by `from` / history `by: buyer|owner`, not a separate status
- **Finalization**: `pending, accepted, declined, cancelled`
- **Visit**: `scheduled, confirmed, completed, cancelled, no-show`
- **Deal** (aggregate): `active, reserved, closed`; `DealIntent` = `buy | rent`
- **Documents**: `pending, granted, declined` (+ `expired`)
- **Teams**: `rental, legal, loans, interior, packers, valuation`

The React app is currently **mock-only** (localStorage); a few ops/ticket/service tokens use a
simpler internal vocabulary that never reaches the wire yet. When the `http` provider is built it
**must map** these UI↔wire pairs:

| Domain | UI (mock) token | Wire token (OpenAPI) |
|---|---|---|
| service request / ticket | `in_progress` | `in-progress` |
| service request / ticket | `done` | `completed` |
| support ticket (initial) | `new` | `open` (ServiceRequest keeps `new`) |

## ER Overview

Text/ASCII relationship map. `1--*` = one-to-many, `1--1` = one-to-one, `*--*` = many-to-many.

```
users (role=owner) 1--* properties
users (role=buyer) --- act on properties via mobile-keyed records (see note below)

properties 1--* visits           (visits.listingId     -> properties.id)
properties 1--* offers           (offers.propId        -> properties.id)
properties 1--1 deal_state       (deals map key        -> properties.id)  under-offer / closed
properties 1--* contact_requests (contact_req.propId   -> properties.id)
properties 1--* finalization_requests (dealReq.propId  -> properties.id)
properties 1--* documents        (documents key        -> properties.id)
properties 1--* transactions     (finance key          -> properties.id)
properties 1--1 ownership_basis  (basis key            -> properties.id)
properties 1--1 property_review 1--* review_messages
properties 1--* reels            (reels.listingId      -> properties.id)
properties 1--* reports          (reports.targetId     -> properties.id, kind='listing')

localities 1--* properties       (properties.localitySlug -> localities.slug)
societies  1--* properties       (optional, by society; societies are curated, not user data)

users 1--* saved_properties      (*--* users<->properties)
users 1--* saved_searches
users 1--* referrals             (referrals.referrerMobile -> users.mobile)
users 1--* tenancies             (tenant side; created on rent-deal finalize)
users 1--* tenant_rentals        (V128 — the tenant's own note about a home they rent; NOT a listing)
users 1--* tenancy_declarations  (declarant side; V68 — a claimed stay + the owner's answer)
properties 1--* tenancy_declarations  (many per listing, unlike `tenancies`)
users 1--1 tenant_profile
users 1--1 aadhaar_verification
users 1--1 notification_preferences (V73 — channels, matchAlerts, quiet hours, language. No row means
                                    the defaults in NotificationPreferenceService; read by
                                    NotificationPublisher on every server-written notification)
users 1--0..1 staff_invites      (V71 — back-office accounts only. An unredeemed row BLOCKS login,
                                  because the account has no usable password until it is redeemed)
users 1--* service_requests / tickets
tickets 1--0..1 service_requests (V72 — service_requests.ticket_id, unique where present: the
                                  board item a request came off, so ops need not match them by hand)
users 1--* support_tickets 1--* ticket_messages

(society|locality|owner) 1--* entity_reviews
```

**`tenant_rentals` has no `property_id`, deliberately (V128).** `tenancies` is written in exactly
one place — when a **rent deal closes on this platform** and the tenant already holds an account —
so the Rent Wallet had no data at all for anyone who found their flat the way most Indian renters
do: through a broker, a noticeboard, or a relative. `tenant_rentals` is that tenant's own record:
`id`, `tenant_id` (FK `users`), `address`, `landlord_name`, `monthly_rent`, `deposit`, `lease_start`,
`lease_end`, `status` (`active` / `ended`), plus the standard soft-delete (`archived`, `archived_at`,
`archive_reason`) and audit (`created_at`, `updated_at`) columns. The home being described is
usually **not** a Draazy listing, so a nullable foreign key would be populated only in the
minority case while every reader had to handle its absence — the address already identifies the home
to the only person who reads it. It is written **once**: months paid, lifetime total and the
financial-year total are derived server-side from instalments elapsed since `lease_start`, so there
is no month-by-month data entry and no payment rows. `address` and `landlord_name` are personal data
(the second belongs to a third party who did not consent to being named), so the table is wired into
both DSAR export (`DataExportScope`) and account erasure (`ErasureService`). Nothing here is
evidence — every value is typed in by the person it flatters — which is why the Rent Passport does
not read it.

The tables that **did** move money between a tenant and an owner — `rent_payments`, `rent_mandates`
and `payout_accounts` — were dropped in **V127**. Leaving them empty would have been worse than
dropping them: an empty `rent_payments` reads to the next person as a rail that exists and has no
traffic.

**Mobile-keying note (Phase 1 -> Phase 2):** In the current localStorage prototype, owner-scoped
collections (contact requests, deals, offers, finalization requests, documents, finances, rent
ledger, tenancies) are **keyed by the owner's/actor's 10-digit mobile number** (e.g.
`draazyDeals:<ownerDigits>`, `dzOffers:<ownerDigits>`), and the counterparty is stored as a
`buyerMobile` / `tenantMobile` string. In PostgreSQL these become proper foreign keys to
`users.id`. Treat every `*Mobile` field as a natural key that maps to a `users` row.

## Conventions

- **ID prefixes (seed data):** users `U####` (buyers/owners), `S###` (staff), `A###` (admin),
  properties `P5###`, deals `D6###`, visits `V8###`, tickets `T9###`,
  reviews `R3###`, reports `REP5###`, referrals `RF3###`, plans `PL#`, societies `S##`.
  Runtime-created records use time-based ids (`c`/`f`/`of`/`req`/`d`/`t`/`rp` + `Date.now()`).
- **Timestamps:** seed uses either an ISO date string `YYYY-MM-DD` (`at`, `createdAt`, `joinedAt`)
  or an epoch-millisecond number (`at`, `handledAt` on reports/referrals). Runtime records use
  epoch ms (`Date.now()`). The target Postgres columns should be `timestamptz`.
- **Money:** integer INR (rupees, no decimals). Rent = per-month; Buy = absolute price.
- **Soft-delete, never hard-delete:** removals go through `archive`/`restore`; archived rows are
  excluded from public queries and surfaced to admins via `?archived=true`. Platform-wide policy.
- **snake_case columns, Flyway migrations, JSONB** for flexible/array/config fields.

## Schema inconsistencies (seed data vs. the API contract)

Recorded so the Postgres schema author reconciles them deliberately:

1. **ID prefixes differ.** Seed uses `P5###`/`U1###`/`D6###`/`TX`-less ids; the OpenAPI examples use
   `PR1001`/`U2001`/`TX1001`/`DOC1001`/`RP1001`. Pick one scheme (or use opaque UUIDs) for Postgres.
2. **`property.rera` type mismatch.** Seed stores a **boolean**; the contract's `GET /properties/{id}`
   uses a **RERA registration string** (e.g. `P52100012345`). Schema should use a nullable string
   `rera_number` plus a derived boolean.
3. **`property.desc` vs `description`.** Seed field is `desc`; contract uses `description`. Seed also
   lacks `carpetArea`, `address`, `floor`, `totalFloors`, `facing`, `parking`, `ageYears`,
   `societyVerified`, `conveyanceDone` that the contract's detail view returns.
4. **Two `deals` shapes.** Analytics seed (`deals.json`) uses `status` in {`closed`, `in_progress`}
   with `value` + date `at`; the owner deal-state store uses `status` in {`active`, `reserved`,
   `closed`} with epoch `at`, `closedWith`, `parties`. Postgres needs a single `deals` table (status
   enum reconciled) plus a `deal_parties` child table.
5. **`transactions` field names.** Finance module uses `repeat` + `note`; the contract POST body uses
   `recurring` + `notes`. Categories also differ (module `Society maintenance` vs `Maintenance`).
6. **`reviews` are modeled twice.** Structured `entity_reviews` (`entityType` in
   {`society`,`locality`,`owner`} + `entityId`) vs the admin moderation feed (`reviews.json`) that
   only has a free-text `target` string and a `status` in {`pending`,`published`}. Unify on
   `entity_type` + `entity_id` + moderation `status`.
7. **`report.reason` enums differ.** Seed uses codes like `fake`, `inaccurate`; the contract example
   uses `fake_photos`. Fix a canonical reason enum.
8. **`localities` fields differ.** Seed has `ratePerSqft`, `demand`, `avgRent`, `focus`, `listings`,
   `active` keyed by `slug`; an earlier contract sketch listed `id`, `city`, `description`, `stats`.
   Merge into one locality schema (slug as PK, keep market stats).
9. **`users.email`.** The contract lists `email`; seed `users.json` has none. Make it nullable.
10. **Owner-scoped stores are mobile-keyed.** Contact requests, deals, offers, finalization requests,
    documents, finances, rent ledger and tenancies are keyed by mobile number in the prototype; the
    buyer/tenant is a `*Mobile` string. Convert each to a real `user_id` foreign key on migration.

## Migration Strategy

```
Phase 1 (Current):  Component -> services/*Service.js -> providers/mock/ -> localStorage
Phase 2 (Future):   Component -> services/*Service.js -> providers/http/ -> Spring Boot -> PostgreSQL
```

Switch via `VITE_API_MODE`: `mock` -> localStorage (current); `http` -> real REST API (future).
Components never change - only the provider implementation swaps.
