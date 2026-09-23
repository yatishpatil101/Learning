# PuneNest backend — data model

The PostgreSQL schema for PuneNest. Source of truth is the OpenAPI spec
(`backend/src/main/resources/static/openapi/punenest-api.yaml`) plus `docs/system/data-model.md`; this
file expands them into concrete migration and mapping guidance. When they disagree, the spec wins —
patch the spec, then update here.

## Table of contents
- Conventions
- Flyway migrations
- Tables by domain (core, transaction, finance, document, service, verification, social, admin)
- Soft-delete / archive
- Indexing
- JSONB usage
- ID strategy
- Entity mapping

## Conventions

- **snake_case** table and column names (`owner_id`, `created_at`).
- **UUID primary keys** in prod (`id uuid primary key default gen_random_uuid()`), exposed as
  `String` in the API. The mock uses prefixed string ids (`PR{ts}`); prod need not reproduce the
  prefix, only the String type.
- **`created_at timestamptz not null default now()`** on every table; add `updated_at` where the row
  is mutated.
- Foreign keys are `<entity>_id uuid references <table>(id)`.
- Money is stored as integer minor units or `numeric` — pick one and be consistent; the contract
  exposes plain numbers. Rupees as `bigint` (whole rupees) is fine for this domain.
- Enum-like columns (`status`, `role`, `deal`, `type`) are stored as `text` with a `check`
  constraint listing allowed values — cheaper to evolve than native PG enums.

## Flyway migrations

- Location: `backend/src/main/resources/db/migration/`.
- Naming: `V1__init.sql`, `V2__add_saved_searches.sql`, ... Never edit a migration once it has run;
  add a new one.
- `V1__init.sql` creates the core + cross-cutting tables, then each feature slice adds its own
  `V{n}` migration (`V2__identity_access`, `V3__catalog_listings`, `V4__leads_contact_visits`,
  `V5__deals_offers_finalization`, `V6__documents_rent_finance`, … already past `V30`). Never edit a
  migration that has run; add the next `V{n}`.
- Enable `pgcrypto` (or `uuid-ossp`) for UUID generation in the first migration.
- Repeatable migrations (`R__seed_reference_data.sql`) for reference/seed data (localities, plans,
  platform fees) so dev/demo has content.

## Tables by domain

Field lists below come straight from the OpenAPI spec and `docs/system/data-model.md`; add the
standard `created_at` (and `archived`/`archived_at` where the domain supports soft-delete) even if
omitted in the summary.

### Core
- `users` (id, name, mobile UNIQUE, email, role, city, verified, created_at) — `role in
  ('buyer','owner','admin','staff')`; `mobile` is the login identity. Staff team/teams: either
  columns here or a `staff_teams` join table.
- `properties` (id, owner_id -> users, title, deal, type, bhk_num, price, area, locality, furnishing,
  status, featured, rera, construction, images, amenities, description, created_at) — `images`,
  `amenities` as JSONB arrays; `status in ('pending','active','under_offer','archived',...)`.
- `localities` (id, slug UNIQUE, name, city, lat, lng, description, stats) — `stats` JSONB.

### Transaction
- `deals` (id, property_id, owner_id, buyer_id, status, deal_type, closed_at)
- `offers` (id, property_id, owner_id, buyer_id, amount, status, message)
- `enquiries` (id, property_id, buyer_id, message, created_at)
- `visits` (id, property_id, visitor_id, scheduled_at, status)
- `contact_requests` (id, property_id, owner_id, requester_id, status) — drives the contact gate.

### Finance
- `transactions` (id, property_id, owner_id, type, category, amount, date, notes, recurring)
- `rent_payments` (id, tenant_id, owner_id, property_id, amount, month, status, platform_fee)
- `ownership_basis` (id, property_id, owner_id, purchase_price, purchase_date, current_value)

### Document
- `documents` (id, property_id, owner_id, category, file_url, file_name, file_size, uploaded_at)
- `document_requests` (id, property_id, requester_id, owner_id, doc_type, status)
- `rent_agreements` (id, property_id, owner_id, tenant_id, start_date, end_date, rent, file_url)

### Service
- `service_requests` (id, requester_id, team, service_type, status, priority, detail, assigned_to)
- `support_tickets` (id, user_id, category, priority, status, subject)
- `ticket_messages` (id, ticket_id -> support_tickets, sender_role, text, images JSONB, created_at)

### Verification
- `aadhaar_verifications` (id, user_id, aadhaar_mobile, verified_at) — presence gates contact reveal.
- `property_reviews` (id, property_id, status, decision, decided_at)
- `review_messages` (id, review_id, sender, text, created_at)
- `tenant_profiles` (id, user_id UNIQUE, id_verified, employment, income, score)

### Social
- `entity_reviews` (id, entity_type, entity_id, user_id, rating, text, created_at) — polymorphic by
  (`entity_type`, `entity_id`); index that pair.
- `saved_properties` (user_id, property_id) — composite PK, pure join table.
- `saved_searches` (id, user_id, label, filters_json JSONB, alerts_enabled)
- `referrals` (id, referrer_id, referred_mobile, status)
- `share_flat_requests` (id, user_id, locality, gender, budget, description)

### Admin
- `settings` (key PK, value_json JSONB) — key/value config store.
- `audit_log` (id, user_id, action, detail, created_at) — append-only; write on every state change.
- `reports` (id, listing_id -> properties, reporter_id, reason, details, status)
- `announcements` (id, title, body, type, active, created_at)

## Soft-delete / archive

Entities that users "delete" instead carry:

```sql
archived     boolean     not null default false,
archived_at  timestamptz
```

Applies to `properties`, `users`, and CMS `content` collections (announcements, etc.). Public/list
repository queries filter `where archived = false`; admin queries opt in with `?archived=true`.
Never issue SQL `DELETE` for these — set the flag. This preserves audit history and referential
integrity.

## Indexing

Index every FK and every column used in a filter or sort:

- `properties`: `owner_id`, `status`, `locality`, `deal`, `type`, `price`, `bhk_num`,
  and a partial index `where archived = false` for the hot public-search path.
- `contact_requests`: `(property_id)`, `(requester_id)`, `(owner_id, status)`.
- `rent_payments`: `(owner_id, month)`, `(tenant_id, month)`.
- `entity_reviews`: `(entity_type, entity_id)`.
- Any `user_id` / `property_id` FK across the schema.

Add composite indexes matching the actual query predicates rather than one-column indexes on
everything; measure with `EXPLAIN` on the real search query.

## JSONB usage

Use `jsonb` for variable-shape or array data the API returns as arrays/objects:
`properties.images`, `properties.amenities`, `localities.stats`, `saved_searches.filters_json`,
`ticket_messages.images`, `settings.value_json`. GIN-index a JSONB column only if you query inside it
(e.g. filtering saved searches); otherwise a plain column is enough.

## ID strategy

- DB: `uuid` PK with `gen_random_uuid()`.
- API: expose as `String`; the frontend treats ids opaquely, so UUIDs satisfy the mock string-id
  contract without change.
- Do not leak sequential integer ids — they enable enumeration of listings/users.

## Entity mapping

- One JPA `@Entity` per table, `@Table(name = "snake_case")`, `@Column(name = "snake_case")`.
- Map JSONB with a JSON type (Hibernate 6 `@JdbcTypeCode(SqlTypes.JSON)` on a `List<String>` /
  `Map<String,Object>` field) — do not hand-roll string concatenation.
- Keep entities inside the service layer; map to DTO records before returning (see
  `architecture.md`). Never annotate entities with jackson and serialize them directly — that couples
  the wire format to the schema and risks lazy-loading serialization bugs.
- Model relationships by FK id fields plus explicit repository lookups where possible; reserve JPA
  `@ManyToOne`/`@OneToMany` for cases where you genuinely need the object graph, to avoid N+1 traps.
