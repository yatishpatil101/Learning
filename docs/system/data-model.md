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

## Catalogue query notes (`PropertyRepository`)

Relocated from code comments so the reasoning survives without a multi-paragraph docblock per
query method.

### Why specifications, and why an `EntityGraph`

`PropertyRepository` extends `JpaSpecificationExecutor` so the public search composes its facets as
a `Specification` (`PropertySpecs`) rather than a combinatorial explosion of derived-query methods.
The predicate it builds - forced `archived=false AND status='approved'` plus the equality/range
facets - is exactly what the partial `idx_properties_search` covers.

The detail and owner-scoped finders pull the owner via an `EntityGraph` so the owner summary is
initialised inside the service transaction: the DTO can be mapped at the controller edge without a
lazy-load blowing up, and without an N+1 across a page of listings. `PropertySearchFragment` is a
fragment rather than another derived method because what it needs - a page with no count of its own,
and two aggregates in one statement - is precisely what the generated repository cannot express.

### Existence checks are not `existsById`

`existsByIdAndArchivedFalseAndStatusIn` is the existence-check form of `Property.isDirectlyReachable`
and takes `PropertyStatus.DIRECTLY_REACHABLE`. `existsById` answers "is there a row", which is a
different and more generous question: a public endpoint asking it becomes an existence oracle -
someone holding a UUID from a cached page or an old sitemap gets a 404 from the detail route and a
200 from the check, which tells them a listing moderation rejected, or an owner archived, is still
on file. No `EntityGraph` and no hydration: it is an index probe, so applying the floor costs nothing
over the check it replaces.

### Row locks and lock order

`findForVerificationDecision` holds a `PESSIMISTIC_WRITE` lock because granting the ownership badge
is check-then-act: read the evidence, decide whether the gate is clear, and write
`ownership_verified*` conditionally on what the read saw, including whether the listing was
*already* verified. Two ops users acting at the same moment both read "not yet verified", both grant
and both announce; the referral credit downstream is only saved from paying twice by a second lock of
its own (`ReferralRepository#findPendingForQualification`), which is a guarantee this path should not
be borrowing. No `EntityGraph`: `select ... for update` and an outer join do not mix in PostgreSQL,
and the owner is reachable lazily inside the same transaction.

**Lock order is `properties` then `referrals`, never the reverse.** Granting the badge announces
inside the same transaction and the announcement takes a pessimistic lock on `referrals`. Nothing
today locks a referral and then reaches a listing, so the order is acyclic - but this is a two-lock
protocol visible only by reading three files, and an ops feature that decides a referral and then
touches its property closes the cycle.

### The duplicate probe: two signals, and the one that was removed

`findDuplicateCandidates` ORs two independent signals, because they fail in opposite directions and
neither is available on every listing: the electricity meter number (near-certain when both sides
have one, and most do not) and a normalised address within a locality (the one that fires when the
meter is null, which is the common case).

**There is deliberately no society arm.** `(society_id, floor, bhk)` is the highest-precision signal
available for flats, it was there, and it had to come out: `society_id` is *asserted by the client*
on create and update. There is a foreign key, so the id has to name a society that exists - but that
is a check on the id, not on the claim, and nothing links an owner to the society they name. Every
real society in Pune is an id an attacker may legitimately supply. Feed the probe one with a floor
and a BHK and the flag it raises tells you whether that unit is listed, including listings still
`pending`, which no public route will admit exist. Repeat, and you have a unit-by-unit census of the
building. A signal an attacker can supply in full is not a signal about the world; it is a query.
Bring it back when an owner has to prove they belong to a society before naming it.

**Absent signals match nothing, and no guard is needed to make that true.** The obvious worry is
that a listing with no meter number matches every other listing with no meter number. It does not:
SQL equality against `NULL` is *unknown*, never true, so an arm whose parameter is null drops out of
the OR. An explicit `:param is not null` guard would read as load-bearing while doing nothing, and a
guard that cannot fail is worse than no guard because the next reader trusts it. What this does
depend on is every arm staying a plain `=`; a `coalesce` added later to "handle nulls" would turn
absence into a match. `ListingNoticesTest` holds that line.

**Only other owners, and only live listings.** `owner.id <> :ownerId` because the same person listing
their own flat twice is a housekeeping mistake, not fraud, and flagging it to ops teaches them to
ignore the flag. Rejected and archived listings are excluded because a duplicate of something already
taken down is not a live conflict. The result is capped by the caller: the answer to "is this a
duplicate" needs one row and the ops note names a couple, and an unbounded `List` is one bad address
key away from loading a locality into memory.

**Deliberately unordered.** Both arms are backed by their own partial index, which Postgres combines
with a bitmap OR - but only while it is free to return rows in whatever order it finds them. Adding
`order by p.created_at` makes an ordered walk of `properties` the cheapest way to produce the first
two rows, so the common case (a create that matches nothing) scans the whole table before answering
"no", and every create and every signal-changing edit pays it. The caller sorts the couple of rows it
gets back, which is where sorting two things belongs.

`findOwnDuplicateCandidates` is the same question turned around, for the wizard's "have I already
listed this?". Every clause is identical except the direction of the owner comparison - same two
arms, same plain `=` on each, same `archived = false`, same caller-supplied status set, same absence
of an `ORDER BY`. Two readings of one rule about what counts as the same doorway; if they ever
disagree, the platform blocks owners on a definition it does not flag strangers on. Because it sits
behind the `owner_id` the caller is authenticated as, it can be answered *to* the person asking:
every row it can return is already on their own dashboard.

### The catch-up sweep, and why ordering differs between the two readers

`findDuplicateCandidates` runs inside the transaction that creates the listing, under
`READ COMMITTED`, so it cannot see a sibling submission that has not committed yet. Two identical
listings posted in the same second each read a world without the other and neither is flagged -
which is the precise shape of the abuse the probe exists to catch, since a broker uploading one flat
twice does it from a script, not by hand a day apart. Hence `findRecentSignalCarrying`.

Its window is deliberately generous relative to the sweep's period, so a listing is re-read a couple
of times rather than exactly once: a sweep tick that dies mid-run, or a deploy landing between two
ticks, would otherwise leave a permanent hole in coverage at a cost of one indexed range scan. The
signal predicate is `ListingDuplicateProbe#flag`'s own early-out hoisted into SQL, because most
listings carry none of the three signals and fetching them only to return immediately would make the
sweep's cost the create rate rather than the rate of listings it can say something about. It reads
`electricity_meter_key` rather than `electricity_meter_no` because the key is what the arm compares -
a meter too short to normalise leaves the raw column set and the key null. The photo clause matters
because a listing whose only signal is its photographs is exactly the pair this sweep exists for.

**The sweep's ordering is load-bearing, unlike the probe's absence of one.** The probe caps at two
rows and order is genuinely irrelevant. The sweep takes a per-tick ceiling, and an unordered page
under a stable plan returns the *same* arbitrary subset every tick - so once the window holds more
listings than the ceiling (a bulk import, a seed backfill, a launch-day spike) the remainder is never
swept and then ages out of the window forever. Oldest-first makes the overflow a backlog the next
tick inherits rather than rows silently dropped, and the only symptom of getting this wrong is a log
line that reads like a queue catching up. There is no index on `created_at`; the plan is a bitmap-OR
over the signal indexes with the window applied as a filter, so cost tracks the total number of
signal-carrying listings rather than the window - fine at this size, and the thing to look at first
if it ever shows up in slow-query logs.

`findSignalCarrying` is the same without the window, for the ops desk's clustering read. The two
exist separately rather than one calling the other with `Instant.EPOCH` because they are asked
different questions - "what has changed lately" versus "what does the whole catalogue currently look
like" - and sharing a method would mean their orderings could never differ, which they must. The
signal predicate is copied verbatim on purpose: if the two disagree, the desk clusters a different
population than the probe flags. It is **newest-first, and the caller must treat a full page as
truncation**: nothing inherits this read's overflow, an operator runs it and acts, and newest-first
is the desk's own reading order. That cut is more dangerous than a truncated list normally is,
because clustering is *pairwise*: if the ceiling falls between two members of a genuine pair, the
survivor is not shown as a partial cluster, it is shown as nothing at all, and a silently-dropped
duplicate looks exactly like a clean catalogue. `ListingDuplicateClusterService` therefore reads one
row past its own ceiling and reports the overflow to the operator.

### The owner badge is stamped on every listing

`markOwnerVerified` / `markOwnerUnverified` carry no `status` and no `archived` filter: the badge
belongs to the *owner*, not to any one listing's lifecycle. A pending listing owned by a verified
person has a verified owner, and an archived one must not come back from restore claiming otherwise.
They are bulk updates rather than a read-modify-write loop because the caller wants none of the
forty-odd listing columns and none of the owner graph, and because that is the only form that stays
one statement for a large portfolio.

**`clearAutomatically` is not optional here.** A bulk update runs as SQL and the persistence context
never hears about it, so any `Property` already managed in the same transaction keeps serving the
pre-update value from the first-level cache. That is invisible in production, where the webhook
transaction has no listing attached - and fatal in the tests, which are `@Transactional` and hold
the very rows they are about to assert on; without it a read straight after a successful write sees
`false`. `flushAutomatically` pairs with it so pending changes are not lost to the clear. The two
methods are exact mirrors, and diverging them would leave one direction correct and the other subtly
not.

### Counts are computed, never stored

`localities.listing_count` (and its siblings on `societies` and `cities`) exists in the schema and
has no writer. The disagreement with reality is not drift: the stored number counts *every*
property, while every surface that displays it means approved and unarchived ones. A stale counter
can be refreshed; a counter that measures the wrong thing cannot. The same trap applies to
`users.listings_count`, which counts every row a person has ever posted including the rejected and
the archived.

One grouped aggregate per list endpoint, never one count per row - on a catalogue of tens of
localities that is cheaper than the join it replaces and cannot be wrong. The single-row counts
(`countByLocalitySlugAndStatusAndArchivedFalse` and its society sibling) exist because the grouped
queries are right for a list endpoint and wrong for a detail one: a detail read needs one number, and
aggregating the whole catalogue to find it does work proportional to the catalogue rather than to the
answer.

`countOccupyingListingSlots` is separate from `countByOwnerIdAndStatusAndArchivedFalse` because the
two answer different questions and must be allowed to differ: one counts what a visitor can open,
which is the number an owner profile shows; the other counts what the quota charges for, which
includes a listing still in the moderation queue.

### The merged-society finder

`findBySocietyIdInAndStatusAndArchivedFalseOrderByCreatedAtDesc` exists because a merge moves
nothing: a listing filed under the duplicate keeps pointing at the duplicate, so the survivor's hub
finds it only by asking for the whole family. Without it the merge would take those listings off both
pages - the duplicate's, because it is no longer reachable, and the survivor's, because it never
referenced them - which is worse than the duplicate the operator merged to fix. The single-society
method is kept alongside it because its callers pass one id and mean one id, and widening them all
to a singleton list to save a declaration would make every call site read as though it might be doing
something it is not.

### The locality curation queue

`findAwaitingLocality` is the exact complement of `countLiveByLocalitySlug`, which filters these out.
That is the point: every read on the platform that groups, facets or routes by locality skips a null
slug, so these listings are invisible to locality search, `/locality/{slug}`, saved-search alerts and
the society join, and nothing else in the codebase selects them. `archived = false` because a
soft-deleted listing needs no locality. Statuses are the caller's to choose so the two cases stay
distinguishable: `pending` is a listing a moderator is about to be stopped from approving, `approved`
is one that already went live invisible and is the more urgent repair. Oldest first and capped,
because the queue is unbounded by nature - a geocoding outage puts a day's listings in it at once -
and a console that renders every row of an unbounded set stops loading on exactly the day it is
needed. `countAwaitingLocality` exists so the truncation can be honest.

### The trust tally

One query rather than three counts. Unlike the admin scorecard, where seven independent figures are
deliberately left unbatched so each line can be read on its own, these three are read together and
are only meaningful together: a visitor is being told what share of what they are looking at is
verified. Three round trips could straddle a moderation write and produce a "verified" count larger
than the total it is a share of, which is the one arithmetic a trust counter must never show.

The ownership clause spells out the badge rather than reading the column. `isOwnershipVerified()` is
derived - an ops verdict that lapses when its evidence expires, with no write to the row - so
`ownership_verified = true` alone counts listings whose proof has run out and whose badge is already
gone from the page. Adding `ownership_verified_until > now` is the same rule in the same words, and a
null expiry means "does not lapse", not "lapsed".

`verifiedOwners` counts people, not listings, hence `count(distinct)` over the owner id: one owner
with nine verified flats is one verified owner, and counting rows would inflate the number precisely
for the prolific poster a visitor has least reason to trust on volume alone. `now` is passed in as
one reading of the clock so the badge and the total cannot straddle an expiry, and an aggregate with
no `group by` always returns exactly one row, so an unknown locality answers zeroes rather than
nothing.

### One query for "how many new" and "how many match"

`countVisibleWithFilters` serves two questions on purpose. The alert sweep asks "how many are *new*?"
by passing the alert row's last update; the saved-search list asks "how many match *now*?" by passing
`unbounded`. They are the same search read at two moments, and a user told "3 new" on one screen and
"14 match" on another is owed the guarantee that the 3 are among the 14. Two queries would drift the
moment either facet set grew a field - and the facets are read out of a free-form jsonb blob, so
nothing would fail loudly when they did.

`unbounded` is a boolean flag rather than a null `baseline` because Postgres cannot infer the type of
a bare `? is null` and refuses to prepare the statement; the query already uses the same idiom for
the two list facets. Callers must still pass a non-null `baseline`; it is simply not read when
unbounded. A row with a null `createdAt` is excluded from the bounded reading (it cannot be shown to
be newer) and counted by the unbounded one (it is still a live listing). Both count rather than load:
neither caller wants the rows, and the sweep touches every alert on the platform every thirty
minutes.

## Identity root notes (`users`)

*Home of the reasoning behind the `User` entity.*

### Enum-like columns are text

`role`, `team` and `status` map as `String` to mirror the schema's "text + CHECK" policy — the cheapest
thing to evolve (add a value with one `ALTER`, no Java enum change). Allowed values are validated by the
CHECK constraint and the DTO layer, not by the entity.

### `@DynamicUpdate` is load-bearing, not a micro-optimisation

Without it Hibernate writes every mapped column on any dirty flush, from the snapshot taken when the row
was loaded — so a transaction that touches one field also writes back its stale copy of `status`,
`role`, `aadhaar_verified` and `flagged`. That became reachable when `ListingService` started calling
`recordListingPosted()`: posting a listing dirties the poster's row for the length of that request, and
an admin suspending the same account inside that window would have the suspension silently written back
to `active` — no error, no conflict, and a *widening*, since the reverted state is the permissive one.
It is the whole entity's guarantee; do not move it to a field or drop it because the counter that
motivated it changes.

### `listings_count` is monotonic, and the lost update is accepted

The counter answers "has this account ever been an owner" — a persona question, for exactly three
readers: the referral desk's channel column, the admin directory's listing count, and which plan card
`Plans.jsx` opens on. Nothing gates on it; in particular the owner plan entitlement does not
(`ListingQuota.standingFor` uses a live count deliberately). "How many listings can a visitor open right
now" is a *different* question, counted at the point of use rather than stored, because a stored live
count drifts silently — keeping this one increment-only is what stops the two being confused, since
there is no decrement path to forget. It is an increment rather than a setter so the only expressible
change is the true one; a `setListingsCount(int)` is something a future caller can hand a recomputed
live count to, invisibly. It is maintained by its writer because `catalog` may import `identity` and not
the reverse (package-structure.md layer 0). The read-modify-write under READ COMMITTED with no
`@Version` means two concurrent posts by the same owner can both write `n + 1`; accepted, because every
reader is either a `> 0` predicate or one cosmetic admin column, and `@Version` on `User` would put
optimistic locking on every profile edit, verification webhook and `lastActive` stamp on the platform.
Revisit only if the number becomes an exact input to billing or quota.

### `flagged` is a note between colleagues, not a status

Flagging changes nothing the platform does: the person still signs in, their listings still show, their
enquiries still route. It records that somebody noticed something and could not yet act on it, so the
next moderator inherits the suspicion rather than rediscovering it. The moment a flag gates behaviour it
has become a status and belongs in `status`, where the states are enumerated and CHECKed. Re-flagging
overwrites rather than appends, and clearing forgets the reason — the column answers "what should the
next person look at", and a reason left behind on an unflagged account reads as an accusation never
withdrawn. The history is in `audit_log` with every raise, clear, actor and timestamp. The four columns
move only through `flag`/`clearFlag`, hence no `@Setter`.

### `erasePersonalData` is one method because the fields must stop being true together

An erasure that cleared the name and left the email is not a partial erasure, it is a failed one, and
the failure would be invisible: the account looks erased on every screen that renders a name. The row
survives — fifty-five tables carry a foreign key into it and are retained for the reasons in
[legal-entity-and-compliance.md](./legal-entity-and-compliance.md) §11, so deleting it would either
cascade through all of them or violate every one of those constraints. What is removed is the ability to
identify a person from it. `password_hash` goes as a credential, not merely as personal data: both
sign-in paths key off `mobile` (replaced) and that hash. `role` and `listings_count` are left alone —
neither identifies anybody, and blanking the role would move an erased owner's retained listings into a
state the platform has no notion of. The status becomes `archived` (the strongest CHECKed state, already
excluded by every read path) rather than a new `erased` value, which would need a CHECK change every
deployed database had to take before this code could run at all. `mobile` had `updatable = false` to
stop a profile edit moving somebody's identity out from under every `user_id`; it was relaxed for this
one write, so that guarantee is now carried by the absence of a setter — a weaker fence in the same
place.

## Flatmate board notes (`flatmate_groups`, `FlatmateVocabulary`)

### The address is nullable because "we have a flat" is a state, not a kind

A group holding an address sorts into the `move-in` tab, one still hunting into `team-up` — the same
row moves between tabs as its search progresses, and a parent listing is the only way a group
expresses an address (naming a society it has no listing for is a claim, and claims do not move a
post into the "real places" tab). Two tables would have meant deleting a group and recreating it the
day it signed a lease, losing its members and its history at exactly the moment they became real.

`seatsOpen` is stored rather than derived as `seatsTotal - members.size()`: a sitting tenant
backfilling one seat of a full four-person flat has one seat open and four members, so deriving it
would advertise three seats that do not exist. Legacy rows predating the column fall back to the
subtraction, which is the best answer available for them. `perHead` is the opposite — a generated
column (`round(rent / seats_total)`, V15), read-only in the entity, because it is the number the
board quotes *and* the number budget filters compare against, so a second writer would be a second
answer to the only price a member ever sees. `ownerConsent` is never client-asserted: the entire
value of the record is that the owner themselves acted. `lat`/`lng` null means *unknown*, never
`(0,0)` — open ocean would place every address-less group 5,000km from anywhere and answer a
distance question we cannot answer; radius search excludes null instead (see
[`../flows/consumer/flatmates.md`](../flows/consumer/flatmates.md) §5, centroid fallback). Members
are cascaded and orphan-removing because a member has no meaning outside its group: genuine
composition, not association.

### The vocabularies are duplicated as `CHECK` constraints, deliberately

Every set in `FlatmateVocabulary` also exists as a V27 `CHECK`, and the direction matters: the
constraint is the guarantee (nothing writes a bad value, whatever the write path) and the Java class
is the *message*. Without it a typo in a request body surfaces as a constraint violation — a 500 any
caller can trigger, naming a database object rather than the field they got wrong. Values are
lower-case strings rather than Java enums because they cross the wire in both directions and appear
verbatim in the contract; an enum would add a mapping layer whose only job is to reproduce the string
it was given.

Two choices in that class are load-bearing:

- **`MOD_PUBLIC` is a whitelist, not a blacklist.** Its inverse (`flagged, removed, rejected`) would
  leave a newly added sixth state public until a human remembered to add it — precisely how `pending`
  would leak. Stated as a whitelist an unknown state is invisible, and the mistake is a post nobody
  can see rather than a post nobody vetted. `pending` is where every newly written post, room and
  group starts; it is not a failure state and carries no accusation. The board is free-text `title`,
  `note` and `locality`, which is exactly where a broker puts a phone number to route around the
  contact rules, so "visible the instant it is written" would make the moderation queue a cleanup
  crew rather than a gate. `live` sits alongside `approved` because the rows carrying it were
  published under a rule that had no queue.
- **`DECISION` is `REQUEST_STATUS` minus `pending`, and the omission is the point.** Pending is where
  a row starts, not a decision anyone can take; accepting it as input would let a decided application
  be quietly un-decided, and `decided_at` would then contradict the status it travels with.

`VERIFICATION_TIER` is never accepted from a client — `FlatmateGuardrails` derives it from the host's
role and the proof they actually supplied, because a client that could name its own tier could award
itself the badge the entire trust model rests on.

