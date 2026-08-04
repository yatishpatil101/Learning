# PuneNest — Database Schema (Flyway Baseline)

**Status:** V1–V8 + repeatable seed authored and **verified** — all 9 migrations apply cleanly
forward on a fresh PostgreSQL (verified on PostgreSQL 13.3 via Flyway 11.8.1;
62 tables, 77 foreign keys, 133 indexes, 47 `updated_at` triggers).

This document is the map from the **OpenAPI contract** (`static/openapi/punenest-api.yaml`, the SSOT
for field shapes) to the physical schema, plus the log of how the **10 documented seed-vs-contract
reconciliations** in `data-model.md` were resolved.

Migrations live in `backend/src/main/resources/db/migration/` and are grouped by bounded context in
dependency order so contexts can later split into schema-per-context cleanly.

---

## 1. Foundation conventions (applied to every business table)

| Concern | Decision | Rationale |
|---|---|---|
| Primary key | `uuid` via `gen_random_uuid()` (opaque) | Reconciliation #1. Non-guessable, mergeable across future context-schemas, no sequence contention. Reference/config tables use natural slugs (`localities.slug`, `cities.slug`, `settings.key`, `platform_fees.deal`). |
| Timestamps | `created_at` / `updated_at timestamptz` | `updated_at` auto-maintained by a single `set_updated_at()` trigger wired by `install_updated_at_triggers()` at the end of every migration — zero per-table boilerplate, correct even for raw SQL. |
| Soft delete | `archived` / `archived_at` / `archive_reason` triplet on business/content entities | Platform policy: never hard-delete. Public queries filter `archived = false`. |
| Money | `bigint`, whole INR (no floats, no paise) | Avoids rounding drift; server computes fees/GST, never trusts the client. |
| Enums | `text` + `CHECK (… IN (…))` | Easiest to evolve — add a value with one `ALTER … DROP/ADD CONSTRAINT` in a new `V*`, no `ALTER TYPE` locks, no lookup-table joins on every read. |
| Mobile | `text CHECK (mobile ~ '^[6-9][0-9]{9}$')` | Indian 10-digit invariant enforced at the schema level. |
| Flexible/array data | `JSONB` (`amenities`, `images`, `connectivity`, `filters`, `features`, …) | Variable-shape/array fields only. First-class filterable attributes stay as real columns + indexes. |
| Append-only tables | no `updated_at`, no trigger | `audit_log`, `*_history`, `messages`, `*_notes`, `*_timeline`, `notifications` are immutable. |

**Multi-tenancy:** intentionally **out of scope**. The OpenAPI spec has zero tenant markers — this is a
single-tenant consumer marketplace. The only isolation that applies is **schema-per-bounded-context**
(a future split), so no tenant column / row-level tenancy is introduced.

**Cross-cutting Phase-0 tables** (V1): `settings` (key→JSONB config SSOT), `platform_fees` (backs
read-only `GET /fees`), `audit_log` (append-only maker-checker/money trail).

---

## 2. The 10 reconciliation decisions

| # | Contract/seed conflict | Decision | Why |
|---|---|---|---|
| 1 | ID scheme (numeric vs prefixed `PR…` vs opaque) | **Opaque `uuid`** PKs on all entities; natural slugs on reference tables | Prefixed IDs are a mock-provider artifact; UUIDs are collision-free across future context-schemas and don't leak counts. |
| 2 | `rera` boolean ↔ string | **Nullable `text`** (`societies.rera`, `properties.rera_id`) | RERA is an identifier (MahaRERA reg no.), not a flag; nullable because not every listing/society has one. |
| 3 | `desc` ↔ `description` | **`description`** | `desc` is a SQL reserved word; the contract's long field is descriptive prose. |
| 4 | Two `deals` shapes (marketplace vs analytics) | **Single `deals` table** — `status {active,reserved,closed}`, one `counterparty_id` FK, `agreed_price` | The analytics "closed/in-progress + value" view is derivable; a `deal_parties` child is deferred (no multi-party deal in the contract — add a `V*` if it appears). |
| 5 | `transactions` field names (`repeat` vs …) | **`note` + `recurring {none,monthly,quarterly,yearly}`** | Matches the `Transaction` schema; `recurring` as an enum is more expressive than a boolean `repeat`. |
| 6 | Duplicate reviews models | **Unified polymorphic `reviews`** — `target_type {property,locality,society,owner}` + `target_id` + moderation `status` | One table serves every review surface; `target_id` is polymorphic (no FK) by design; `status` carries the admin-moderation state. |
| 7 | Report-reason enum | **Free-text `reason`** (with a `status` enum) | The reason vocabulary isn't frozen in the contract; a `CHECK` is deferred to a later `V*` once T&S finalizes it — cheaper than guessing now. |
| 8 | Locality fields split across `Locality` / `LocalityDetail` | **Merged into one `localities` table**, `slug` PK; variable detail (connectivity, highlights, price trends) in JSONB | Avoids a 1:1 join on every read; market stats are hot columns, prose/arrays are JSONB. |
| 9 | Nullable `email` | **`users.email` nullable** | Login is passwordless mobile-OTP; email is optional profile data. |
| 10 | `*Mobile` natural keys → real FKs | **Every party embed resolves to a `user_id` FK.** Genuine non-user leads stay `text` mobile: `city_waitlist.mobile`, `society_leads.mobile`, `rent_agreements.tenant_mobile`, `referrals.referred_mobile`, and denormalized `referrals.referrer_mobile`/`tickets.mobile` | Registered actors get referential integrity; not-yet-registered leads can't have an FK, so they keep a validated mobile string that resolves to a user on activation. |

**Bonus (ADR-019) — Aadhaar is a badge, not a gate.** The old hard `403 aadhaar_required` contact
gate is retired. `users.mobile_verified` (L1) is the floor; `verified`/`aadhaar_verified` (L2) is an
opt-in trust badge, modeled by `identity_verifications` (`badge`, `status`, `masked_aadhaar`,
`identity_hash UNIQUE` for "one Aadhaar = one account", `mobile_match` soft signal). Raw Aadhaar is
never stored — last-4 masked only.

---

## 3. Schema → table map (by migration / bounded context)

### V1 — Foundation (Phase 0)
| OpenAPI schema | Table | Notable columns / FKs / indexes |
|---|---|---|
| AdminSettings | `settings` | `key` PK, `value jsonb` |
| Fees | `platform_fees` | `deal` PK `{buy,rent}`, `brokerage/platform_fee/stamp_duty/registration/gst bigint` |
| AuditEntry | `audit_log` | append-only; idx `(entity,entity_id)`, `(at desc)` |

### V2 — Identity & Access (Phase 1)
| OpenAPI schema | Table | Notable columns / FKs / indexes |
|---|---|---|
| User, UserUpdate, StaffCreate, AuthResponse | `users` | `mobile` UNIQUE+CHECK, `email` nullable, `role/team/status` enums, trust ladder (`mobile_verified/verified/aadhaar_verified`), soft-delete; idx role/team/status |
| (OTP login, ADR-008) | `otp_codes` | `code_hash`, `purpose`, `expires_at`; idx `(mobile,purpose)` |
| (refresh rotation, ADR-008) | `refresh_tokens` | `token_hash` UNIQUE, `rotated_from` self-FK, `revoked` |
| AadhaarVerification, KycStart, DigilockerWebhook | `identity_verifications` | `user_id` UNIQUE FK, `identity_hash` UNIQUE, `masked_aadhaar`, `mobile_match` |

### V3 — Catalog, Listings & Localities (Phase 2)
| OpenAPI schema | Table | Notable columns / FKs / indexes |
|---|---|---|
| Locality, LocalityDetail | `localities` | `slug` PK; market stats columns + JSONB detail; idx city (active) |
| Society, SocietyDetail | `societies` | `slug` UNIQUE, `locality_slug` FK, `rera text`, `claim_status` |
| (follow) | `society_follows` | PK `(user_id, society_id)` |
| Property, PropertySummary, ListingCreate/Update | `properties` | `owner_id` FK, `deal/status/furnishing` enums, `price bigint`, `rera_id text`, `description`, JSONB `amenities/images/admin_pipeline`, soft-delete; **partial idx** `(deal,property_type,city,price,bhk) WHERE approved & !archived`, owner/locality/society/pipeline idx |
| Reel | `reels` | `listing_id` FK |
| City, CityWaitlistRequest | `cities`, `city_waitlist` | `cities.slug` PK; waitlist `mobile` CHECK |

### V4 — Leads, Contact, Visits & Messaging (Phase 3)
| OpenAPI schema | Table | Notable columns / FKs / indexes |
|---|---|---|
| ContactRequest(Create), ContactStatus | `contact_requests` | `property_id`+`requester_id` FKs, `status {pending,approved,declined}`; idx both |
| Enquiry | `enquiries` | `property_id`+`from_user_id` FKs |
| Visit, VisitCreate | `visits` | `slot`, `mode`, `status`; idx property/visitor |
| Conversation, ConversationCreate | `conversations` | `user_a_id`/`user_b_id` FKs + CHECK a≠b, optional `property_id` |
| Message, MessageCreate | `messages` | append-only; `conversation_id` FK; idx `(conversation_id,created_at)` |

### V5 — Deals, Offers, Finalization & Verification (Phase 4)
| OpenAPI schema | Table | Notable columns / FKs / indexes |
|---|---|---|
| Offer, OfferCreate/Response | `offers` | `property_id`+`from_user_id` FKs, `amount bigint`, `status` |
| (negotiation trail) | `offer_history` | append-only; `offer_id` FK, `by {buyer,owner}` |
| Deal, DealCloseRequest | `deals` | single-aggregate (recon #4); `counterparty_id` FK, `status {active,reserved,closed}` |
| FinalizationRequest(Create/Accept) | `finalization_requests` | initiator/counterparty FKs, `agreed_price` |
| PropertyReview | `property_reviews` | `property_id` UNIQUE FK; `checklist[]`→`property_review_checklist`; thread→`review_messages` |

### V6 — Documents, Rent, Finance & Tenancies (Phase 5)
| OpenAPI schema | Table | Notable columns / FKs / indexes |
|---|---|---|
| Document | `documents` | `property_id` FK, `storage_key` (signed URL at read); +`service_request_id` FK added in V7 |
| DocumentRequest(Create) | `document_requests` | `categories jsonb`, `share_token`, `acknowledged_disclaimer` |
| Transaction(Create) | `transactions` | `type {income,expense}`, `note`, `recurring` (recon #5); idx owner/property by date |
| OwnershipBasis | `ownership_basis` | `property_id` PK (1:1) |
| Tenancy | `tenancies` | property/tenant/owner FKs, `status` |
| RentPayment(Create) | `rent_payments` | `platform_fee/gst` server-computed; `tenancy_id` FK |
| RentMandate | `rent_mandates` | `day_of_month` CHECK 1–28 |
| PayoutAccount | `payout_accounts` | `masked_account` only |
| TenantProfile | `tenant_profiles` | `user_id` PK (1:1), `preferred_localities jsonb` |
| RentAgreement | `rent_agreements` | `tenant_mobile text` (recon #10 lead), `status` |
| OwnerKyc | `owner_kyc` | `user_id` PK (1:1), masked PAN/Aadhaar |

### V7 — Ops, Services, Growth & Moderation (Phase 6)
| OpenAPI schema | Table | Notable columns / FKs / indexes |
|---|---|---|
| Ticket(Create/Update) | `tickets` | `team/priority/status` enums, requester/assignee FKs; idx `(team,status)`, assignee |
| (notes) | `ticket_notes` | append-only; `ticket_id` FK |
| ServiceRequest(Create) | `service_requests` (+`service_request_timeline`) | `status` workflow enum; documents link via ALTER |
| Referral | `referrals` | `referrer_id` FK + `referred_mobile text` (recon #10), fraud-signal flags |
| Review, ReviewCreate | `reviews` | polymorphic `target_type/target_id` (recon #6), moderation `status` |
| Report, ReportCreate | `reports` | polymorphic target, free-text `reason` (recon #7), `status` |
| ~~ShareFlatPost(Create)~~ | ~~`share_flat_posts`~~ | **Dropped in V28** — carried into `flatmate_seeker_posts`; see V27/V28 |
| SocietyLead(Create) | `society_leads` | **Created by V24, not here.** V7 also declared it, which made the chain un-replayable on a fresh DB; the earlier sketch was removed |

### V8 — Engagement, Billing, CMS & Support (Phase 7)
| OpenAPI schema | Table | Notable columns / FKs / indexes |
|---|---|---|
| (saved) | `saved_properties` | PK `(user_id, property_id)` |
| SavedSearch(Create) | `saved_searches` | `filters jsonb`, `alert_frequency/channel` enums |
| Plan | `plans` | `audience/billing_cycle` enums, `features jsonb` |
| Subscription, SubscribeRequest | `subscriptions` | user/plan FKs, `status` |
| BoostPack, Boost | `boost_packs`, `boosts` | `placement` enum; `boosts` property/pack FKs |
| ServiceOffering, ServiceOrder(Create) | `service_offerings`, `service_orders` | offering/user/property FKs, `status` |
| SupportTicket(Create) | `support_tickets` (+`support_ticket_messages`) | per-user; distinct from ops `tickets` |
| Notification | `notifications` | append-only; idx `(user_id, read, created_at desc)` |
| Announcement, CmsService, Faq, Banner | `announcements`, `cms_services`, `faqs`, `banners` | soft-deletable CMS content |

---

## 4. How to run / verify

```powershell
# 1. A Postgres reachable at localhost:5432 (local service or container).
# 2. Create a throwaway DB, then apply all migrations with the Flyway CLI:
$env:PGPASSWORD="postgres"
& "C:\Program Files\PostgreSQL\13\bin\psql.exe" -U postgres -h localhost -c "CREATE DATABASE punenest_verify;"
$loc="filesystem:backend\src\main\resources\db\migration"
& flyway "-url=jdbc:postgresql://localhost:5432/punenest_verify" "-user=postgres" "-password=postgres" "-locations=$loc" migrate info
```

In the app itself, Flyway runs automatically on boot (`spring.flyway.enabled=true`,
`baseline-on-migrate=true`); Hibernate is `ddl-auto=validate` so the schema is Flyway-owned. The
datasource is env-driven (`DB_URL` / `DB_USER` / `DB_PASSWORD`) with local-dev defaults.

**Evolving the schema:** never edit a shipped `V*` file. Add a new `V9__…`, `V10__…` — change columns,
add enum values (drop/add the `CHECK`), or split a context into its own schema. Reference/config data
changes go in the repeatable `R__seed_reference_data.sql` (idempotent upserts; re-runs on checksum
change).
