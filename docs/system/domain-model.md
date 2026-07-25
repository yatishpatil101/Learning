# PuneNest - Domain Model (canonical entities)

> **This file is the Single Source of Truth (SSOT) for the future PostgreSQL schema.**
> Every entity's real fields, types, relationships and status/enum values are documented here,
> derived from the actual seed data (`src/data/*.json`) and the mock service layer
> (`src/lib/**` behind `src/services/providers/mock/*.js`).
>
> Flow, feature and API docs should **link here** rather than re-defining entities.
> REST endpoints that operate on these entities live in [`api-contract.md`](./api-contract.md).
> Where seed data and the API contract disagree, this file records both and flags the
> mismatch in the "Schema inconsistencies" section at the bottom.

## ER Overview

Text/ASCII relationship map. `1--*` = one-to-many, `1--1` = one-to-one, `*--*` = many-to-many.

```
users (role=owner) 1--* properties
users (role=buyer/tenant) --- act on properties via mobile-keyed records (see note below)

properties 1--* enquiries        (enquiries.listingId  -> properties.id)
properties 1--* visits           (visits.listingId     -> properties.id)
properties 1--* offers           (offers.propId        -> properties.id)
properties 1--1 deal_state       (deals map key        -> properties.id)  under-offer / closed
properties 1--* contact_requests (contact_req.propId   -> properties.id)
properties 1--* finalization_requests (dealReq.propId  -> properties.id)
properties 1--* documents        (documents key        -> properties.id)
properties 1--* transactions     (finance key          -> properties.id)
properties 1--1 ownership_basis  (basis key            -> properties.id)
properties 1--1 property_review 1--* review_messages
properties 1--* rent_payments / rent_ledger
properties 1--* reels            (reels.listingId      -> properties.id)
properties 1--* reports          (reports.targetId     -> properties.id, kind='listing')

localities 1--* properties       (properties.localitySlug -> localities.slug)
societies  1--* properties       (optional, by society; societies are curated, not user data)

users 1--* saved_properties      (*--* users<->properties)
users 1--* saved_searches
users 1--* referrals             (referrals.referrerMobile -> users.mobile)
users 1--* tenancies             (tenant side; created on rent-deal finalize)
users 1--1 tenant_profile
users 1--1 aadhaar_verification
users 1--* service_requests / tickets
users 1--* support_tickets 1--* ticket_messages

(society|locality|owner) 1--* entity_reviews
```

**Mobile-keying note (Phase 1 -> Phase 2):** In the current localStorage prototype, owner-scoped
collections (contact requests, deals, offers, finalization requests, documents, finances, rent
ledger, tenancies) are **keyed by the owner's/actor's 10-digit mobile number** (e.g.
`puneNestDeals:<ownerDigits>`, `pnOffers:<ownerDigits>`), and the counterparty is stored as a
`buyerMobile` / `tenantMobile` string. In PostgreSQL these become proper foreign keys to
`users.id`. Treat every `*Mobile` field below as a natural key that maps to a `users` row.

## Conventions

- **ID prefixes (seed data):** users `U####` (buyers/owners), `S###` (staff), `A###` (admin),
  properties `P5###`, deals `D6###`, enquiries `E7###`, visits `V8###`, tickets `T9###`,
  reviews `R3###`, reports `REP5###`, referrals `RF3###`, plans `PL#`, societies `S##`.
  Runtime-created records use time-based ids (`c`/`f`/`of`/`req`/`d`/`t`/`rp` + `Date.now()`).
- **Timestamps:** seed uses either an ISO date string `YYYY-MM-DD` (`at`, `createdAt`, `joinedAt`)
  or an epoch-millisecond number (`at`, `handledAt` on reports/referrals). Runtime records use
  epoch ms (`Date.now()`). The target Postgres columns should be `timestamptz`.
- **Money:** integer INR (rupees, no decimals). Rent = per-month; Buy = absolute price.
- **Types below** use: `string`, `number`, `boolean`, `T[]` (array), `object`, `epoch_ms`,
  `date (YYYY-MM-DD)`, `datetime`.

---

## Data Model Reference (PostgreSQL)

### Core Tables

#### `users`  (seed: `src/data/users.json`)

| Field | Type | Notes |
|-------|------|-------|
| id | string | PK. `U1000` buyer/owner, `S200` staff, `A001` admin |
| name | string | |
| mobile | string | 10 digits; natural key used across mobile-keyed stores; UNIQUE |
| role | string | enum: `owner`, `buyer`, `staff`, `admin` |
| team | string | staff only, nullable; enum: `rental`, `legal`, `interior`, `packers`, `valuation` |
| status | string | enum: `active`, `suspended` (Phase 2 adds `archived`) |
| verified | boolean | owner/identity verified badge |
| city | string | default `Pune` |
| joinedAt | date | |
| lastActive | date | |
| listings | number | denormalized count of active listings (owner) |

Relationships: `users.id` owns `properties.ownerId`; referenced by nearly every other table via mobile.
Not in seed but in API/runtime: `email` (contract lists it; seed omits it), `archived`, `archivedAt`, `archiveReason`.

#### `properties`  (seed: `src/data/properties.json`)

| Field | Type | Notes |
|-------|------|-------|
| id | string | PK (`P5000`) |
| title | string | e.g. "4 BHK Villa in Magarpatta" |
| type | string | e.g. `Villa`, `Plot`, `Flat`, `Studio`, `Penthouse`, `Row House`. Canonical search taxonomy in `src/data/propertyTypes.js` (flat, house, villa, pg, flatmates, commercial, plot, farmland + commercial subtypes) |
| bhk | string | display, e.g. `4 BHK`, `1 RK` |
| bhkNum | number | numeric BHK for filtering |
| locality | string | display name |
| localitySlug | string | FK -> `localities.slug` |
| area | number | sq ft |
| price | number | INR; per-month for `rent`, absolute for `buy` |
| deal | string | enum: `rent`, `buy` |
| owner | string | owner display name (denormalized) |
| ownerId | string | FK -> `users.id` |
| ownerMobile | string | FK -> `users.mobile` |
| status | string | enum: `approved`, `pending` (seed). Full lifecycle adds `rejected`, `archived`; runtime listing statuses also use `verified`/`live`, `deleted` |
| featured | boolean | paid/admin promotion |
| views | number | denormalized counter |
| enquiries | number | denormalized counter |
| ownerVerified | boolean | owner KYC done |
| ownershipVerified | boolean | ownership docs verified |
| furnishing | string | enum: `furnished`, `semi`, `unfurnished` |
| construction | string | enum: `ready`, `new` (under-construction) |
| rera | boolean | seed stores a boolean; API contract stores a RERA registration string (see inconsistencies) |
| amenities | string[] | e.g. `parking`, `security`, `power`, `garden`, `play`, `gym`, `pool`, `lift`, `ev` |
| image | string | primary image URL |
| gallery | string[] | image URLs |
| lat | number | |
| lng | number | |
| desc | string | description (API contract calls this `description`) |
| createdAt | date | |
| docsCount | number | number of uploaded documents |
| flagReason | string | admin moderation flag; empty when unflagged |

Extended fields present in API `GET /properties/:id` and admin/runtime flows (not in seed):
`carpetArea`, `address`, `societyVerified`, `conveyanceDone`, `ageYears`/`age`, `floor`,
`totalFloors`, `facing`, `parking`, nested `owner{ id,name,mobile,verified }`, `archived`,
`archivedAt`, `archiveReason`, and admin post-on-behalf pipeline fields (`postedByAdmin`,
`postedByStaff`, `pipelineStage` [`listed`,`docs_submitted`,...], `claimLinkSent`,
`photosUploaded`, `aadhaarVerified`, `reminderCount`).

**Foundation fields** (`src/lib/store/listings.js`): `deal, title, locality, localitySlug, bhk,
bhkNum, area, type, facing, floor, age, construction`. Editing any of these on an approved
listing reverts `status` to `pending` (anti bait-and-switch).

#### `localities`  (seed: `src/data/localities.json`)

| Field | Type | Notes |
|-------|------|-------|
| slug | string | PK (`baner`) |
| name | string | |
| ratePerSqft | number | INR/sq ft |
| demand | number | 0-100 index |
| avgRent | number | INR/month |
| focus | string | enum: `Buy`, `Rent`, `Both` |
| lat | number | |
| lng | number | |
| listings | number | denormalized count |
| active | boolean | shown on site |

Relationships: `localities.slug` <- `properties.localitySlug`. (API contract also references
`id`, `city`, `description`, `stats` - not present in seed; see inconsistencies.)

#### `societies`  (curated: `src/data/societies.js`, `societies-rera.js`)

Curated, deterministic (not user data). Fields: `id` (PK `S01`), `slug`, `name`, `builder`,
`localitySlug` (FK -> localities), `lat`, `lng`, `year`, `towers`, `units`, `occupancy`,
`maintenancePerSqft`, `water`, `power`, `parkingRatio`, `lifts`, `security`, `petPolicy`,
`vegPolicy`, `rera` (registration string, may be empty), `registration` (bool), `conveyance`
(bool), `amenities` (string[]). Reserved Phase 2/3 fields: `claimStatus`, `adminId`, `members`.

### Transaction Tables

#### `deals`  (two representations - see inconsistencies)

**(a) Analytics/admin deals feed** (seed: `src/data/deals.json`) - closed/in-progress deals:

| Field | Type | Notes |
|-------|------|-------|
| id | string | PK (`D6000`) |
| listingId | string | FK -> `properties.id` |
| listing | string | property title (denormalized) |
| deal | string | enum: `rent`, `buy` |
| value | number | INR deal value |
| status | string | enum: `closed`, `in_progress` |
| at | date | close/progress date |

**(b) Owner deal-state store** (runtime: `src/lib/store/deals.js`, key `puneNestDeals:<ownerMobile>`) -
one record per property capturing under-offer/closed lifecycle:

| Field | Type | Notes |
|-------|------|-------|
| (map key) | string | property id |
| status | string | enum: `active` (no entry), `reserved` (under offer), `closed` |
| deal | string | `rent` or `buy` |
| at | epoch_ms | |
| closedWith | object | `{ name, mobile, rent?, title?, address? }`, nullable |
| parties | object[] | under-offer parties `{ name, note, mobile, at }` |

#### `offers`  (runtime: `src/lib/store/deals.js`, key `pnOffers:<ownerMobile>`)

| Field | Type | Notes |
|-------|------|-------|
| id | string | PK (`of<ts>`) |
| propId | string | FK -> `properties.id` |
| ownerMobile | string | FK -> `users.mobile` (store key) |
| buyerName | string | |
| buyerMobile | string | FK -> `users.mobile` |
| amount | number | INR offered |
| message | string | optional |
| from | string | enum: `buyer`, `owner` (who owns the current ball) |
| status | string | enum: `pending`, `accepted`, `declined`, `countered`, `countered_by_buyer` |
| history | object[] | `{ amount, by, at }` negotiation trail |
| at | epoch_ms | created |
| updatedAt | epoch_ms | |

#### `finalization_requests`  (maker-checker; runtime: `src/lib/store/deals.js`, key `puneNestDealReq:<ownerMobile>`)

| Field | Type | Notes |
|-------|------|-------|
| id | string | PK (`f<ts>`) |
| propId | string | FK -> `properties.id` |
| deal | string | `rent`/`buy` |
| buyerName | string | |
| buyerMobile | string | FK -> `users.mobile` |
| status | string | enum: `pending`, `accepted`, `declined` |
| at | epoch_ms | |

Accepting one request auto-declines other pending requests on the same property, calls
`closeDeal`, and (for `rent`) creates a `tenancies` row.

#### `enquiries`  (seed: `src/data/enquiries.json`)

| Field | Type | Notes |
|-------|------|-------|
| id | string | PK (`E7000`) |
| listingId | string | FK -> `properties.id` |
| listing | string | property title (denormalized) |
| customer | string | enquirer name |
| mobile | string | enquirer mobile |
| kind | string | enum: `visit`, `contact` |
| status | string | enum: `new`, `responded`, `closed` |
| at | date | |

#### `visits`  (seed: `src/data/visits.json`)

| Field | Type | Notes |
|-------|------|-------|
| id | string | PK (`V8000`) |
| listingId | string | FK -> `properties.id` |
| listing | string | property title (denormalized) |
| customer | string | visitor name |
| mobile | string | visitor mobile |
| when | date | scheduled date |
| status | string | enum: `scheduled`, `completed`, `cancelled` |

#### `contact_requests`  (runtime: `src/lib/contact.js`, key `puneNestContactReq:<ownerMobile>`)

| Field | Type | Notes |
|-------|------|-------|
| id | string | PK (`c<ts>`) |
| propId | string | FK -> `properties.id` (may be empty for owner-level request) |
| buyerName | string | |
| buyerMobile | string | FK -> `users.mobile` |
| status | string | stored enum: `pending`, `approved`, `declined`. `contactStatus()` also returns computed `owner` (viewer is owner) and `none` |
| requestedAt | epoch_ms | |

Gate: a buyer must be signed in AND Aadhaar-verified, else `requestContact` returns `login` /
`aadhaar_required`. Owner privacy pref `hideNumber` (key `pnOwnerPrefs:<mobile>`) keeps the number
masked even after approval (routes to in-app chat).

### Finance Tables

#### `transactions`  (runtime: `src/lib/data/finances.js`, key `puneNestFin:<mobile>:<propId>`)

| Field | Type | Notes |
|-------|------|-------|
| id | string | PK (`t<ts>`) |
| type | string | enum: `income`, `expense` |
| category | string | income: `Rent received`, `Deposit received`, `Other income`; expense: `Society maintenance`, `Property tax`, `Home loan EMI`, `Repairs`, `Insurance`, `Utilities`, `Commission / fees`, `Other expense` |
| amount | number | INR |
| date | date | |
| repeat | string | enum: `none`, `monthly`, `quarterly`, `yearly` (API contract calls this `recurring`) |
| note | string | (API contract calls this `notes`) |
| createdAt | epoch_ms | |
| updatedAt | epoch_ms | on edit |

Scoped by owner mobile + property (or `all`). Related finance sub-entities in the same module:
`loan` (`amount, rate, tenure, startDate`), finance `tenant`/lease
(`name, rent, deposit, leaseStart, leaseEnd, escalation`), and per-category `budgets` map.

#### `ownership_basis`  (runtime: `src/lib/data/finances.js`, key `puneNestFinBasis:<mobile>:<propId>`)

| Field | Type | Notes |
|-------|------|-------|
| type | string | enum: `owned` (default), also used for rented basis |
| purchasePrice | number | INR |
| purchaseDate | date | nullable |
| currentValue | number | INR |
| updatedAt | epoch_ms | |

Relationship: one per (owner mobile, property).

#### `rent_payments`  (runtime: `src/lib/store/rent.js`, key `pnRentPayments:<mobile>`)

| Field | Type | Notes |
|-------|------|-------|
| id | string | PK (`rp<ts>`) |
| propId | string | FK -> `properties.id` |
| ownerMobile | string | FK -> `users.mobile` |
| amount | number | INR rent |
| month | string | `YYYY-MM` |
| status | string | enum: `paid` (default) |
| platformFee / fee | number | computed = `rentPayPercent`% of amount |
| gst | number | computed = `gstPercent`% of fee |
| at | epoch_ms | |

Related: `rent_ledger` (owner-side received, key `pnRentLedger:<ownerMobile>`, adds
`settlement: settled`), platform fee ledger (`pnRentFeeLedger`), `rent_mandate`
(autopay, key `pnRentMandate:<mobile>`), owner `payout_account`
(key `pnPayout:<mobile>`: `vpa` | `accountNumber`, `verified`).

#### `tenancies`  (runtime: `src/lib/store/rent.js`, key `pnTenancies:<tenantMobile>`)

| Field | Type | Notes |
|-------|------|-------|
| id | string | PK (`tn<ts>`) |
| propId | string | FK -> `properties.id` |
| ownerMobile | string | FK -> `users.mobile` |
| ownerName | string | |
| title | string | property title |
| address | string | |
| rent | number | INR/month |
| deal | string | `rent` |
| status | string | enum: `active` |
| at | epoch_ms | |

Created cross-actor when an owner accepts a rent finalization request.

### Document Tables

#### `documents`  (runtime: `src/lib/data/documents.js`, key `puneNestDocs:<mobile>` -> per-property map)

| Field | Type | Notes |
|-------|------|-------|
| id | string | PK (`d<ts>`) |
| propId | string | map key -> `properties.id` |
| category | string | slot name from `DOC_CATEGORIES` (Title & Ownership, Society, Approvals & Plans, Purchase & Payments, Tax & Utilities) or `Other` |
| name | string | file name |
| size | number | bytes |
| mime | string | e.g. `application/pdf`, `image/*` |
| dataUrl | string | base64 data URL (Phase 2: object storage `file_url`) |
| uploadedAt | epoch_ms | |

#### `document_requests`  (runtime: `src/lib/data/documents.js`, key `puneNestDocReq:<ownerMobile>`)

| Field | Type | Notes |
|-------|------|-------|
| id | string | PK (`req<ts>`) |
| propId | string | FK -> `properties.id` |
| buyerName | string | |
| buyerMobile | string | FK -> `users.mobile` |
| docType | string | requested category (matches a `documents.category`) |
| status | string | enum: `pending`, `granted`, `declined` |
| acknowledgedDisclaimer | boolean | |
| ackAt | epoch_ms | nullable |
| requestedAt | epoch_ms | |
| respondedAt | epoch_ms | nullable |
| sharedDocIds | string[] | on grant, ids of owner docs matching `docType` |

#### `rent_agreements`  (runtime: `src/lib/store/rent.js`, key `puneNestRentAgreement:<mobile>`)

Per-user list of agreements created via PuneNest's Rent Agreement service. Shape is
service-flow driven (see `src/lib/serviceFlow.js`); ties an owner, tenant and property with
start/end dates, rent and a generated document. See also `service_requests` below.

### Service Tables

#### `service_requests` / `tickets`  (seed: `src/data/tickets.json`; catalog: `src/data/services.json`)

| Field | Type | Notes |
|-------|------|-------|
| id | string | PK (`T9000`) |
| team | string | FK -> service `team`; enum: `rental`, `legal`, `interior`, `packers`, `valuation` |
| service | string | display name (from services catalog) |
| customer | string | requester name |
| mobile | string | requester mobile |
| status | string | enum: `new`, `in_progress`, `done` |
| priority | string | enum: `low`, `medium`, `high` |
| assignedTo | string | staff name, nullable |
| value | number | INR order value |
| createdAt | date | |
| notes | object[] | internal notes `{ at, by, text }` |
| detail | string | free-text request detail |

**Services catalog** (`services.json`): `key` (PK: `rental`,`legal`,`interior`,`packers`,
`valuation`,`homeloan`), `name`, `team`, `price` (INR, 0 = quote-based), `active`, `desc`, `icon`.

#### `support_tickets` + `ticket_messages`  (API `#14`; runtime chat-style)

Customer support tickets: `id` (`SUP-##`), `user_id`, `category` (e.g. `listing`), `priority`
(`low`/`medium`/`high`), `status` (`open`/... ), `subject`, `createdAt`. Each has many
`ticket_messages`: `{ id, ticket_id, sender_role, text, images[], createdAt }`, with read tracking.

#### `service_orders`  (runtime: `src/lib/store/billing.js`, key `pnServiceOrders:<mobile>`)

Move-in pack / marketplace orders: `id` (`so<ts>`), `status` (enum: `placed`), `at`, plus
order payload (items, amount). Distinct from `tickets` (staff-worked service requests).

### Verification Tables

#### `aadhaar_verifications`  (runtime: `src/lib/store/listings.js`, key `puneNestAadhaar:<mobile>`)

| Field | Type | Notes |
|-------|------|-------|
| (key) | string | user mobile |
| verified | boolean | |
| aadhaarMobile | string | mobile used for Aadhaar OTP |
| at | epoch_ms | |

One-time identity gate required before requesting owner contact, posting a property, or
contributing to society content.

#### `property_reviews` + `review_messages`  (runtime: `src/lib/store/reviews.js`, key `puneNestPropReview:<ownerMobile>`)

| Field | Type | Notes |
|-------|------|-------|
| propId | string | PK / FK -> `properties.id` |
| title | string | |
| locality | string | |
| price | string/number | |
| status | string | enum: `in_review`, `clarification`, plus terminal decisions via `decision` |
| docs | object[] | verification checklist `{ id, name, status: pending/submitted/verified/rejected, note }` |
| messages | object[] | two-way thread `{ id, from: admin/owner, text, at, read }` (= `review_messages`) |
| decision | string | nullable terminal decision (approve/reject) |
| createdAt / updatedAt | epoch_ms | |

Checklist docs differ by `deal`: rent uses Index II + Electricity bill + Aadhaar; buy uses
ownership proof, tax receipt, owner ID, society NOC, encumbrance cert, photo match.

#### `tenant_profiles`  (runtime: `src/lib/store/rent.js`, key `pnTenantProfile:<mobile>`)

| Field | Type | Notes |
|-------|------|-------|
| (key) | string | user mobile |
| idVerified | boolean | +30 to score |
| employment | string | +20 |
| income | string | e.g. `10-15 LPA`; +15 |
| priorLandlord | string | +15 |
| about | string | +10 |
| occupants | number | +10 |
| score | number | computed 0-100 (`tenantScore`) |
| updatedAt | epoch_ms | |

### Social Tables

#### `entity_reviews`  (runtime: `src/lib/store/reviews.js`, key `pnEntityReviews` -> `type:id` map)

| Field | Type | Notes |
|-------|------|-------|
| id | string | PK (`er<ts>`) |
| entity_type | string | enum: `society`, `locality`, `owner` |
| entity_id | string | FK -> that entity (composite map key `type:id`) |
| user | string | reviewer name |
| rating | number | 1-5 |
| text | string | |
| at | epoch_ms | |

**Note:** the admin moderation feed (`src/data/reviews.json`) is a flatter representation with
`id` (`R3000`), `user`, `target` (free-text, e.g. "Service: Packers & Movers", "Owner",
"Locality: Wakad"), `rating`, `text`, `status` (enum: `pending`, `published`), `at` (date).
See inconsistencies.

#### `saved_properties`  (runtime: `src/lib/store/notifications.js`, key `pnSavedProps:<mobile>`)

Array of `property.id` strings per user (`user_id` * -- * `property_id`).

#### `saved_searches`  (runtime: `src/lib/store/search.js`, key `pnSavedSearches:<mobile>`)

| Field | Type | Notes |
|-------|------|-------|
| id | string | PK (`ss<ts>`) |
| label | string | human label |
| filters | object | saved filter/query params |
| alerts | boolean | alerts enabled (default true) |
| channel | string | enum: `whatsapp` (default) |
| newCount | number | new-match counter |
| at | epoch_ms | |

#### `referrals`  (seed: `src/data/referrals.json`; runtime stats in `src/lib/store/referrals.js`)

| Field | Type | Notes |
|-------|------|-------|
| id | string | PK (`RF3000`) |
| referrer | string | referrer name |
| referrerMobile | string | FK -> `users.mobile` |
| referred | string | referred name |
| referredMobile | string | invitee mobile |
| reward | string | e.g. `+15 owner contacts` |
| channel | string | enum: `seeker`, (owner) |
| risk | string | enum: `low`, ... (fraud risk) |
| status | string | enum: `qualified`, `rewarded` (also pending states) |
| aadhaarVerified | boolean | anti-fraud signal |
| aadhaarUnique | boolean | |
| sameDevice | boolean | |
| sameIp | boolean | |
| velocityHigh | boolean | |
| activated | boolean | |
| at | epoch_ms | |
| handledBy | string | admin, empty when unhandled |
| handledAt | epoch_ms | 0 when unhandled |

Per-user runtime stats (`pnReferralStats:<mobile>`): `{ invited, joined, listed }`; plus
`referralCode`, `referredBy` link capture.

#### `share_flat_requests` + `rooms`  (runtime: `src/lib/store/listings.js`, key `puneNestRoomListings`)

Flatmate/room listings and seeker requests. A room record normalizes into a listing
(`roomToListing`): `id`, `title`, `locality`/`localities[]`, `price`/`budget`/`rentShare`,
`deal: rent`, `status` (default `pending`), `image`/`photos[]`, `views`, `ownerMobile`,
`flatmate: true`, `type: Flatmate`, `flatType`, `society`, `seatsOpen`, `createdAt`.
Seeker-side requests carry `gender`, `budget`, `locality`, `description`.

### Admin Tables

#### `settings`  (seed: `src/data/settings.json`)

Single JSON document (key/value store in Postgres) with sections: `site`, `fees`
(`ownerPlanYearly`, `ownerProYearly`, `rentAgreementPlatform`, `seekerPlusTopup`,
`featuredListing`, `gstPercent` 18, `rentPayPercent` 2), `movePack`, `flags` (feature toggles),
`adminFlags`, `permissions` (per team), `customRoles`. **SSOT for platform fees** - read via
`getFees()` in `src/lib/store/billing.js`.

#### `reports`  (seed: `src/data/reports.json`)

| Field | Type | Notes |
|-------|------|-------|
| id | string | PK (`REP5000`) |
| kind | string | enum: `listing` (Phase 2: `user`) |
| targetId | string | FK -> `properties.id` (when kind=listing) |
| targetTitle | string | denormalized |
| targetOwner | string | owner name |
| ownerMobile | string | FK -> `users.mobile` |
| deal | string | `rent`/`buy` |
| reason | string | enum: `fake`, `inaccurate`, ... (seed) |
| reasonLabel | string | human label |
| details | string | reporter's note |
| reportedBy | string | reporter name |
| reporterMobile | string | FK -> `users.mobile` |
| url | string | deep link to target |
| at | epoch_ms | |
| status | string | enum: `open`, `resolved` |
| actionTaken | string | |
| resolution | string | |
| handledBy | string | admin, empty when unhandled |
| handledAt | epoch_ms | 0 when unhandled |

#### `announcements`  (seed: `src/data/announcements.json`)

`id` (`AN1`), `title`, `body`, `audience` (enum: `All`, `Tenants`, `Owners`, ...), `at` (date),
`active` (bool).

#### `audit_log`  (API `#29`)

`id`, `user_id`, `action`, `detail`, `created_at`. Written on admin actions.

### Content / CMS Tables

- `plans` (seed `plans.json`): `id` (`PL1`), `name`, `audience` (enum: `owner`, `seeker`),
  `price`, `period` (enum: `forever`, `year`, `one-time`), `features` (string[]), `popular` (bool).
  Runtime user plan (`pnPlan:<mobile>`) uses plan ids `free`/`owner-free`/`owner2`/`owner5` with
  listing limits {free:1, owner2:2, owner5:5}; boosts stored per-listing (`pnBoosts:<mobile>`).
- `banners` (seed `banners.json`): `id`, `title`, `cta`, `href`, `active`, `theme`.
- `faqs` (seed `faqs.json`): `id`, `q`, `a`, `cat`.
- `reels` (seed `reels.json`): `id` (`RL1`), `listingId` (FK -> properties.id), `title`,
  `locality`, `price`, `deal`, `poster`, `likes`, `views`, `tag`.
- `notifications` (seed `notifications.json`, runtime per-user): `id`, `kind`
  (enum: `visit`, `enquiry`, `price`, `system`, `document`), `title`, `body`/`desc`, `at`, `read`,
  optional `link`. Cross-actor writes via `pushNotificationFor(mobile, ...)`.
- `messages` (seed `messages.json`): in-app threads: `id`, `threadId`, `withName`, `withRole`,
  `listing`, `last`, `unread`, `at`, `thread[]` (`{ from: me/them, text, at }`).

---

## Schema inconsistencies (seed data vs. api-contract.md)

Recorded so the Postgres schema author reconciles them deliberately:

1. **ID prefixes differ.** Seed uses `P5###`/`U1###`/`D6###`/`TX`-less ids; the API contract
   examples use `PR1001`/`U2001`/`TX1001`/`DOC1001`/`RP1001`. Pick one scheme (or use opaque
   UUIDs) for Postgres.
2. **`property.rera` type mismatch.** Seed stores a **boolean**; the API contract's
   `GET /properties/:id` stores a **RERA registration string** (e.g. `P52100012345`). Schema
   should use a nullable string `rera_number` plus a derived boolean.
3. **`property.desc` vs `description`.** Seed field is `desc`; contract uses `description`.
   Seed also lacks `carpetArea`, `address`, `floor`, `totalFloors`, `facing`, `parking`,
   `ageYears`, `societyVerified`, `conveyanceDone` that the contract's detail view returns.
4. **Two `deals` shapes.** Analytics seed (`deals.json`) uses `status` in {`closed`,
   `in_progress`} with `value` + date `at`; the owner deal-state store uses `status` in
   {`active`, `reserved`, `closed`} with epoch `at`, `closedWith`, `parties`. Postgres needs a
   single `deals` table (status enum reconciled) plus a `deal_parties` child table.
5. **`transactions` field names.** Finance module uses `repeat` + `note`; the API contract POST
   body uses `recurring` + `notes`. Categories also differ (module `Society maintenance` vs
   contract `Maintenance`).
6. **`reviews` are modeled twice.** Structured `entity_reviews` (`entityType` in
   {`society`,`locality`,`owner`} + `entityId`) vs the admin moderation feed
   (`reviews.json`) that only has a free-text `target` string and a `status` in
   {`pending`,`published`}. Unify on `entity_type` + `entity_id` + moderation `status`.
7. **`report.reason` enums differ.** Seed uses codes like `fake`, `inaccurate`; the API contract
   example uses `fake_photos`. Fix a canonical reason enum.
8. **`localities` fields differ.** Seed has `ratePerSqft`, `demand`, `avgRent`, `focus`,
   `listings`, `active` keyed by `slug`; the earlier contract sketch listed `id`, `city`,
   `description`, `stats`. Merge into one locality schema (slug as PK, keep market stats).
9. **`users.email`.** The contract/earlier schema lists `email`; seed `users.json` has no email
   field. Make it nullable.
10. **Owner-scoped stores are mobile-keyed.** Contact requests, deals, offers, finalization
    requests, documents, finances, rent ledger and tenancies are keyed by mobile number in the
    prototype; the buyer/tenant is a `*Mobile` string. Convert each to a real `user_id`
    foreign key on migration.

---

## Migration Strategy

```
Phase 1 (Current):  Component -> services/*Service.js -> providers/mock/ -> localStorage
Phase 2 (Future):   Component -> services/*Service.js -> providers/http/ -> Spring Boot -> PostgreSQL
```

Switch via `VITE_API_MODE` environment variable:
- `mock` -> uses localStorage (current)
- `http` -> uses real REST API (future)

Components never change. Only the provider implementation swaps.
