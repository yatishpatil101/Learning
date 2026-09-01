-- V10 Tenancy & finance — the money and the lettings record.
--
-- Consolidated final state of: transactions, tenancies, tenant_profiles, tenant_rentals,
-- tenancy_declarations, rent_agreements, managed_properties, managed_property_documents,
-- managed_property_rent_receipts.
--
-- Folds the pre-consolidation migrations V6, V12, V13, V20, V33, V51, V54, V68, V93, V120, V127
-- and V128. Every later ALTER, DROP COLUMN and DROP INDEX from that chain is applied here in
-- place, so what follows is the schema those twelve files ended at, not their starting point.
--
-- =========================================================================================
-- WITHDRAWN: the online rent-collection rail (was V6, dropped by V127)
-- =========================================================================================
--
-- Three tables that once sat in this domain -- `rent_payments`, `rent_mandates` and
-- `payout_accounts` -- are deliberately not created here. V127's reasoning, kept because it is
-- a product decision and not a schema detail:
--
--   Withdraw the online rent-collection rail.
--
--   PuneNest never shipped rent collection: there is no gateway account configured to receive a
--   tenant's rent, no payout mechanism to remit it to the landlord, and no reconciliation. What
--   existed was scaffolding — three tables, four endpoints and a webhook branch — kept alive by
--   fixtures and by nothing else. `/pay-rent` is now a static "coming soon" page with no server
--   behind it, so the scaffolding is removed rather than left as a half-built money path that the
--   next reader has to prove is inert.
--
--   Why a drop and not an archive. These tables hold no production data: no environment has ever
--   taken a rupee of rent through them, so there is nothing to preserve and nothing to migrate.
--   Leaving them empty would be worse than dropping them — an empty `rent_payments` reads to an
--   operator as "no rent was collected this month", which is a claim about trading, when the truth
--   is that the product does not exist.
--
--     rent_payments   — one billed or settled rent instalment, child of `tenancies`
--     rent_mandates   — the tenant's standing instruction to auto-debit, child of `tenancies`
--     payout_accounts — where a landlord's remittance would have gone; nothing ever wrote one
--
--   `tenancies` is the PARENT of the first two and stays: a tenancy is a lettings fact (who lives
--   where, on what term) and it backs My Rental, the tenant profile and the owner's own
--   rent-receipt log, none of which move money. Dropping only the children is what keeps that
--   distinction intact.
--
-- The `rentPayPercent` convenience fee that priced a rent payment went with them, for the same
-- reason: a fee quoted for a product that cannot be bought is a promise the platform cannot keep.
-- It is simply absent from the reference-data seed rather than inserted and then stripped.


-- =========================================================================================
-- transactions
-- =========================================================================================

-- transactions: owner finance ledger (reconciliation #5: note + recurring, not repeat).
--
-- Soft-delete triplet (archived / archived_at / archive_reason)
--
-- DELETE /me/finances/{propId}/transactions/{txnId} answers 204, but a bare table would have no way
-- to record a deletion other than losing the row -- and "no hard delete" is a platform guardrail
-- (SoftDeleteEntity), not a preference.
--
-- It matters more here than anywhere else in the schema. This is the owner's financial ledger:
-- the same rows feed /summary, /cashflow and /dues, and an owner reconciles those numbers
-- against a bank statement and, at year end, against a tax return. A ledger whose rows can
-- vanish cannot be reconciled with its own totals -- last month's net silently changes and
-- there is nothing left to explain why. Soft-delete keeps the deleted row available to answer
-- "where did that Rs 40,000 go", which is the question an owner actually asks.
--
-- Same triplet as properties so the rows map onto the shared SoftDeleteEntity base rather
-- than earning a bespoke lifecycle.
CREATE TABLE transactions (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id    uuid NOT NULL REFERENCES properties(id),
    owner_id       uuid NOT NULL REFERENCES users(id),
    type           text NOT NULL CHECK (type IN ('income','expense')),
    category       text,
    amount         bigint NOT NULL,
    date           date NOT NULL,
    note           text,
    recurring      text NOT NULL DEFAULT 'none' CHECK (recurring IN ('none','monthly','quarterly','yearly')),
    archived       boolean NOT NULL DEFAULT false,
    archived_at    timestamptz,
    archive_reason text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Every read on this table is a live read: the ledger list, the summary aggregate, the cashflow
-- series and the dues projection all filter archived = false. Partial indexes keep deleted rows out
-- of the scans that never want them, and keep the index small as the archive grows.
--
-- A COVERING INDEX FOR THE TWO OWNER FINANCE AGGREGATES (tech debt D132).
--
-- What D132 was really about. The register row says `/me/finances/{propId}/summary` and
-- `/cashflow` "aggregate per call with no rollup table" and proposes building one. Reading the
-- code first: the arithmetic already happens in Postgres -- `sumByTypeSince` returns one row and
-- `monthlyTotalsBetween` returns one row per month, neither pulls the ledger into the JVM. So the
-- expensive half of the item was already gone and a rollup table would have been a second copy of
-- numbers an owner reconciles against a bank statement, kept in step by a trigger or a job, to
-- save a cost nobody has measured. That trade is bad at this size: a stale rollup is a wrong
-- ledger, and a wrong ledger is worse than a slow one.
--
-- What was actually left is the *heap*. Both aggregates read `type` and `amount`, and a plain
-- `(property_id, date)` index carries neither, so it could find the rows but Postgres still
-- had to visit the table once per row to add them up. A year of monthly rent, maintenance, tax and
-- utility rows is a few hundred random heap fetches to return three integers, and it grows one row
-- at a time forever -- which is exactly the shape D132 was worried about, just in the layer below
-- the one the register named.
--
-- Carrying the two columns in the index removes the heap visit entirely: the aggregate can be
-- answered from the index alone. The response bytes do not change -- this is a plan change, not a
-- contract change.
--
-- The predicate this serves, exactly as the two queries write it:
--
--   /summary   property_id = ?  AND archived = false  [AND date >= ?]
--   /cashflow  property_id = ?  AND archived = false   AND date >= ?  AND date < ?
--
-- `property_id` leads because it is the equality; `date` follows because it is the range and both
-- windows are expressed on it; `archived = false` is the partial predicate rather than a key
-- column because no read on this table ever wants an archived row (every query in
-- TransactionRepository filters it). `period=all` passes no lower bound and
-- degenerates to the leading-column prefix, which the same index serves.
--
-- `type` and `amount` ride in INCLUDE rather than in the key. They are never filtered or ordered
-- on -- they are only summed -- and adding them to the key would enlarge every internal page for
-- no navigational benefit.
--
-- There is deliberately no second, narrower `(property_id, date)` index beside this one. The keys
-- would be byte-identical; the covering index differs only by a payload the planner ignores when
-- navigating. Any plan that could choose the narrow one can choose this one at the same cost, so
-- keeping both would buy nothing and charge for it twice on every insert, update and soft-delete.
--
-- The trade being accepted: entries are wider (a text `type` plus an 8-byte `amount` on top of a
-- uuid and a date), so a range scan reads roughly twice the index pages. That is paid by the
-- paged ledger list, which reads twenty rows and therefore a handful of pages either way, and it
-- buys the aggregates their whole heap-visit cost back. The scan that got wider is the one bounded
-- by a page size; the scan that got cheaper is the one bounded by how long the owner has held the
-- flat.
--
-- Honest caveat, recorded here so the next person measuring does not conclude the index failed:
-- an index-only scan still visits the heap for rows whose page is not marked all-visible, so a
-- ledger written to seconds ago will show some fetches until autovacuum catches up. The steady
-- state is what this is for.
CREATE INDEX idx_transactions_property_agg
    ON transactions (property_id, date) INCLUDE (type, amount)
    WHERE archived = false;

-- /dues reads only the recurring rows, which are a small minority of a busy ledger. Without this
-- the dues projection scans the whole property history to find them.
CREATE INDEX idx_transactions_recurring ON transactions (property_id, recurring)
    WHERE archived = false AND recurring <> 'none';

-- =========================================================================================
-- THERE IS NO INDEX ON `transactions.owner_id`, AND THAT IS DELIBERATE (debt D176).
-- =========================================================================================
--
-- An `idx_transactions_owner (owner_id, date)` existed for a long stretch of the old chain, on the
-- assumption that an owner's ledger would be read by owner. It never was. The finance surface is
-- mounted at `/me/finances/{propId}/...`: `FinanceService` resolves ownership once, through
-- `properties` (`findByIdAndOwner_Id`), and every read after that is scoped to the property alone.
-- The index was dead. Not "unused on this box" -- unusable.
--
-- THE ARGUMENT THAT SETTLES IT: no query shape exists that could choose it.
--
-- `TransactionRepository` is the only door to this table -- there is no native SQL against
-- `transactions` anywhere in the application (`AdminMetricsRepository`, which holds every hand-
-- written query on the platform, does not mention it), and no seed writes it. Its five statements
-- are, in full:
--
--   findLiveByPropertyId          property_id = ? and archived = false, order by date desc
--   (its countQuery)              property_id = ? and archived = false
--   findLiveByIdAndPropertyId     id = ? and property_id = ? and archived = false
--   findLiveRecurringByPropertyId property_id = ? and archived = false and recurring <> 'none'
--   sumByTypeSince                property_id = ? and archived = false [and date >= ?]
--   monthlyTotalsBetween          property_id = ? and archived = false and date >= ? and date < ?
--
-- Every one of them leads on `property_id`. `owner_id` would be the leading column of such an
-- index, so it can only be reached by a predicate on `owner_id` -- a scan of a b-tree whose first
-- key is not constrained is a full index scan, which is never cheaper than the property index it
-- would be competing with here. There is no such predicate, and there cannot accidentally become
-- one: the controller has already proved ownership before any of these run, so re-filtering on
-- `owner_id` would be a second, weaker check, and `TransactionRepository`'s own contract note says
-- reads are scoped by property deliberately, so that a listing whose basis was recorded under a
-- different owner id still returns a complete ledger.
--
-- The column is not dead and is NOT dropped. `Transaction.ownerId` is the ledger row's *author* --
-- who recorded it, which is not the same fact as who owns the listing today, and is what stops a
-- new owner inheriting the previous owner's private expense history when a flat changes hands. It
-- is written on insert and read back only as part of a whole row. `Transaction.getOwnerId()` has no
-- caller anywhere in the codebase; that is the direct proof that nothing filters, sorts or groups on
-- it, which is the only thing an index on it could serve.
--
-- SUPPORTING, NOT LOAD-BEARING: `pg_stat_user_indexes` on the local test database, which has run
-- the finance suite, reported 163 scans on `idx_transactions_property_agg`, 40 on
-- `transactions_pkey` and 0 on `idx_transactions_owner`. A zero on a developer box proves nothing on
-- its own -- an unexercised index and an unusable one look identical. It is worth recording only
-- because the *other* indexes on the same table are non-zero, so this is a zero next to a control
-- rather than a quiet database. The argument above is what decides it.
--
-- WHAT ITS ABSENCE BUYS: every insert into this table maintains one fewer b-tree, as does every
-- update and every soft-delete (which flips `archived` and therefore moves the row out of the
-- partial index, a delete from the index's point of view). A ledger is append-heavy and never
-- culled -- rent, maintenance and recurring expenses arrive on a schedule for as long as the owner
-- holds the flat -- so it would be a cost paid forever for a plan that is never chosen.
--
-- REVERSING IT is one line, if a by-owner read is ever genuinely wanted:
--   CREATE INDEX idx_transactions_owner ON transactions (owner_id, date) WHERE archived = false;
-- Adding it back beside a query that needs it is cheaper than keeping it against one that might.


-- =========================================================================================
-- tenancies
-- =========================================================================================

-- tenancies: created on rent-deal finalization. It was the parent of the rent-payment rail; that
-- rail is withdrawn (see the header), and this table stays because a tenancy is a lettings fact --
-- who lives where, on what term -- that backs My Rental, the tenant profile and the owner's
-- rent-receipt log, none of which move money.
CREATE TABLE tenancies (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id uuid NOT NULL REFERENCES properties(id),
    tenant_id   uuid NOT NULL REFERENCES users(id),
    owner_id    uuid NOT NULL REFERENCES users(id),
    rent        bigint,
    deposit     bigint,
    start_date  date,
    end_date    date,
    status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended','terminated')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- One active tenancy per property.
--
-- Without this nothing would prevent two rows with status 'active' on the same flat. That is not a
-- duplicate record, it is a double-let: two tenants each believing they hold the property, two rent
-- schedules, and rent rows that cannot be attributed. It also makes "the current
-- tenancy" -- which the owner dashboard, the tenant's My Rental panel and the rent ledger all
-- assume is singular -- a query with two answers.
--
-- Partial, so a property can accumulate any number of ended/terminated tenancies over the years
-- while only ever having one live at a time. This is the V9/V11 lesson applied ahead of the bug:
-- a service-level check cannot survive two concurrent closes interleaving.
CREATE UNIQUE INDEX uq_tenancies_active_per_property
    ON tenancies (property_id)
    WHERE status = 'active';

-- The owner's tenancy list and the tenant's own list are both live-first reads.
--
-- There are deliberately no single-column `(owner_id)` / `(tenant_id)` indexes beside these. They
-- would be strict prefixes of the composites, so Postgres can serve every query they served from
-- these two. Keeping both costs a write amplification on every tenancy insert and update for no
-- read benefit.
CREATE INDEX idx_tenancies_owner_status  ON tenancies (owner_id, status);
CREATE INDEX idx_tenancies_tenant_status ON tenancies (tenant_id, status);


-- =========================================================================================
-- tenant_profiles
-- =========================================================================================

-- tenant_profiles: 1:1 per user (schema: TenantProfile).
--
-- SHAPED TO THE PROFILE THE PRODUCT ACTUALLY COLLECTS (spec fix S21).
--
-- The original TenantProfile schema read: name, occupation, employer, family_size,
-- preferred_localities, budget. The tenant profile the frontend actually
-- ships (pages/consumer/TenantProfile.jsx) asks for name, occupation, monthly income, WHO will
-- live in the home, an earliest move-in date, a prior-landlord reference, and a short
-- introduction. Only `name` and `occupation` were ever in both.
--
-- This is not a naming mismatch that a mapper could paper over. The trust score owners screen on
-- is built from idVerified(30) + occupation(20) + income(15) + priorLandlord(15) + about(10) +
-- occupants(10). Four of those six inputs had no column in the original shape, so a server
-- honouring it could compute at most 50 out of 100 -- every tenant's score would have halved the
-- moment the UI stopped reading its mock. The columns are the score.
--
-- family_size -> occupants is the load-bearing change. An integer cannot say "Bachelor (Male)",
-- and in Pune that is the attribute owners and societies decide on -- many refuse bachelors
-- outright, and a company lease is a different counterparty again. Storing 3 where the tenant
-- said "Bachelor (Male)" does not lose precision, it loses the fact.
--
-- employer / preferred_localities / budget are absent rather than nullable-forever: no screen
-- has ever written them, and a column nothing fills is a column the next author has to
-- investigate. income replaces budget -- what a tenant earns is what an owner screens on, and it
-- is what the form asks for.
--
-- (They were safe to drop destructively when they were removed: tenant_profiles had no production
-- data -- the backend had never served these endpoints -- and no table references it.)
CREATE TABLE tenant_profiles (
    user_id        uuid PRIMARY KEY REFERENCES users(id),
    name           text,
    occupation     text,

    -- Monthly income in whole INR, matching the contract's Money and the rest of the schema's
    -- bigint money convention. Nullable: the score rewards supplying it, nothing requires it.
    income         bigint,

    -- The occupant type. CHECK-constrained rather than left free text: this is a screening facet,
    -- so an unrecognised value would silently drop the profile out of an owner's filter instead of
    -- failing loudly. Values match the contract enum exactly.
    occupants      text CHECK (occupants IN ('family', 'bachelor_male', 'bachelor_female', 'company_lease')),

    -- Earliest date the tenant can move in. Owners match this against a listing's availability.
    move_in        date,

    -- Free text on both: a prior-landlord reference is a name and a number as the tenant wrote
    -- them, and the introduction is prose. Neither is ever parsed.
    prior_landlord text,
    about          text,

    score          integer CHECK (score BETWEEN 0 AND 100),
    verified       boolean NOT NULL DEFAULT false,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Verified tenants first, then by score -- the order an owner reviewing applicants wants, and the
-- only ordering these rows are ever read in. tenant_profiles is keyed by user_id, so single-row
-- reads already ride the primary key and need nothing here.
CREATE INDEX idx_tenant_profiles_screening ON tenant_profiles (verified DESC, score DESC);


-- =========================================================================================
-- tenant_rentals
-- =========================================================================================

-- tenant_rentals — the tenant's own record of the home they rent.
--
-- `tenancies` is written in exactly one place: `TenancyService.openFromClosedDeal`, called
-- when a rent deal closes on this platform AND the tenant already holds an account. A
-- `tenancy_declaration` ("I lived here", owner confirms) deliberately does not create one and
-- carries no rent -- it exists to establish residence for reviews, not to describe a lease.
--
-- So the Rent Wallet -- deposit position, the HRA exemption estimate, rent paid this financial year
-- -- had no data for anyone who found their flat the way almost every Indian renter does: through a
-- broker, a noticeboard, or a relative. Those tenants saw the empty state, permanently, on a tab
-- built for them. The rent-pay rail would not have fixed it either; it only ever described money
-- that moved through the platform.
--
-- This table is the tenant's side of the ledger `transactions` gives an owner. It is a SEPARATE
-- table rather than a relaxation of that one: every read of `transactions` is scoped
-- `(property_id, owner_id)` and answers 404 rather than 403, because the existence of a ledger is
-- itself a fact about someone else's assets. A tenant holds neither key, and widening the most
-- carefully scoped endpoint family on the platform to admit a second kind of caller is a far larger
-- change than adding a table.
--
-- NOT LINKED TO A LISTING. There is no `property_id`. The whole point is the home that is not on
-- PuneNest, and a nullable FK that only the minority case would populate would have to be read
-- defensively everywhere while earning nothing -- the address below already identifies the home to
-- the only person who reads it. If linking a self-declared rental to a live listing ever becomes a
-- feature, it can be added then, with whatever the feature actually needs.
--
-- NOT EVIDENCE. Every value here is typed in by the person it flatters, and nothing checks any of
-- it. It may drive the tenant's own dashboard and their own HRA arithmetic -- both of which are
-- already self-reported to their employer -- and it must never reach the Rent Passport, which is a
-- credential handed to a prospective landlord under the words "verified rent-payment record".
CREATE TABLE tenant_rentals (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The caller, always. Every read and write is scoped to it; there is no path by which one
    -- tenant reaches another's rental, and no owner-side view of this table at all. An owner who
    -- wants to know what their tenant believes the rent to be has to ask them.
    tenant_id    uuid NOT NULL REFERENCES users(id),

    -- Where they live, as they describe it. Personal data: it is a home address tied to a named
    -- user, which is the most directly identifying string on this table. Classified in
    -- `ErasureRetention` and exported by `DataExportScope` -- `ErasureCoverageTest` fails the build
    -- if either is forgotten, which is the mechanism that made this comment necessary rather than
    -- optional.
    address      text NOT NULL,

    -- Also personal data, and someone else's: the landlord did not consent to being named here.
    -- Nullable because the tenant may not want to give it, and the wallet works without it.
    landlord_name text,

    -- Whole rupees, `bigint`, matching `transactions.amount` and the contract's `Money` (int64).
    -- Never numeric-with-scale and never a float: this number is multiplied by a month count and
    -- compared against a salary, and a ledger that sums floating-point rupees stops agreeing with
    -- the bank.
    --
    -- The upper bound is not paranoia about storage -- it is that `monthly_rent * months_elapsed`
    -- is rendered as a headline figure, so an absurd value produces an absurd dashboard rather than
    -- an error anyone would notice. Rs 1 crore a month is far above any residential rent in Pune
    -- and far below anything that would misbehave arithmetically.
    monthly_rent bigint NOT NULL,
    CONSTRAINT tenant_rentals_rent_range CHECK (monthly_rent > 0 AND monthly_rent <= 10000000),

    -- Nullable: plenty of tenants paid no deposit, or genuinely do not remember. Zero and "unknown"
    -- are different answers and the deposit panel says so, which is why this is not `DEFAULT 0`.
    deposit      bigint,
    CONSTRAINT tenant_rentals_deposit_range CHECK (deposit IS NULL OR (deposit >= 0 AND deposit <= 100000000)),

    -- When the lease began. Required, because it is the only thing that makes "rent paid so far"
    -- computable -- months elapsed since this date times the rent -- and a rental with no start is
    -- a rent figure with nothing to multiply it by.
    lease_start  date NOT NULL,

    -- Null while the tenancy is open. The same reasoning as `tenancies`: guessing eleven months
    -- would put a date in front of the tenant that neither party agreed to.
    lease_end    date,
    CONSTRAINT tenant_rentals_dates_ordered
        CHECK (lease_end IS NULL OR lease_end >= lease_start),

    -- The lease itself is bounded so that a typo in `lease_start` cannot silently inflate every
    -- total on the page. 1970 is comfortably before any plausible tenancy a user would record.
    CONSTRAINT tenant_rentals_start_sane CHECK (lease_start >= DATE '1970-01-01'),

    -- Length bounds live here and not only in the DTO, for the reason `lead_notes` states: a bound
    -- that exists only in a request record holds only for writers that pass
    -- through that controller. The address is rendered whole on a card and printed into a rent
    -- receipt PDF, so an unbounded value is felt on every read, not just its own.
    CONSTRAINT tenant_rentals_address_length CHECK (length(address) BETWEEN 1 AND 300),
    CONSTRAINT tenant_rentals_landlord_length
        CHECK (landlord_name IS NULL OR length(landlord_name) BETWEEN 1 AND 120),

    -- 'active' or 'ended'. A moved-out tenant keeps the row: last year's rent is what the HRA claim
    -- for last year is made of, and deleting it on move-out would destroy the record in the same
    -- month it becomes most useful.
    status       text NOT NULL DEFAULT 'active',
    CONSTRAINT tenant_rentals_status_chk CHECK (status IN ('active', 'ended')),

    -- Soft delete, matching `SoftDeleteEntity`. Distinct from 'ended': 'ended' means the tenant
    -- moved out and the record still counts, archived means they say it should never have existed.
    archived     boolean NOT NULL DEFAULT false,
    archived_at  timestamptz,
    archive_reason text,

    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- The only read pattern: one tenant's rentals, most recent lease first, live rows only. Partial on
-- `archived` for the same reason as the `transactions` indexes -- every read here is a live
-- read, so archived rows have no business enlarging the index that serves them.
CREATE INDEX idx_tenant_rentals_tenant
    ON tenant_rentals (tenant_id, lease_start DESC)
    WHERE archived = false;


-- =========================================================================================
-- tenancy_declarations
-- =========================================================================================

-- D194: the second half of "did this person live here" — an owner-confirmed self-declaration.
--
-- Review eligibility is meant to be "visited OR lived here". Only the visit half was ever real: the
-- tenancy half was decided client-side from a localStorage bucket nothing on the live path writes,
-- so against the API it was unconditionally false and a genuine ex-tenant who never booked a visit
-- could not review the flat they lived in. The brokered half is fixed by simply asking
-- `/me/tenancies`, which has existed all along. This table is the other half.
--
-- WHY NOT A `tenancies` ROW. Two reasons, and either alone is decisive.
--
-- (1) It would not fit. `uq_tenancies_active_per_property` permits at most one active tenancy
--     per property, because two would not be a duplicate record but a double-let. Every declaration
--     is about a *past* stay, and several different people may have lived in the same flat over the
--     years, so the shape this evidence naturally takes is many-rows-per-property — the opposite of
--     what that index exists to forbid.
--
-- (2) It would launder weak evidence into strong. A `tenancies` row was the parent of rent payments
--     and mandates; it exists only because a rent deal closed, with the money, the dates and both
--     parties already authorised. A declaration is a claim someone typed, which an owner later
--     agreed with. Both are good enough to say "this person lived here" — that is the whole ruling —
--     but writing the second into the first would make a typed claim indistinguishable from a signed
--     agreement at every later read, including the ones about money.
--
-- Hence: its own table, its own status, its own revocation path.
--
-- WHO MAY CONFIRM. `owner_id` is copied from the listing at declaration time and the confirm path
-- checks the caller against it. Being an OTP-verified user is not the same fact as being *this*
-- listing's owner, and only the second one makes the confirmation mean anything — otherwise any
-- signed-in stranger could vouch for a claim about somebody else's flat. It is denormalised rather
-- than joined on every check so that a later transfer of the listing cannot silently move the power
-- to confirm a stay that happened under the previous owner.
--
-- REVOCATION IS A STATUS, NOT A DELETE. An owner who confirms by mistake, or who later learns the
-- claim was false, needs the review eligibility to stop — but the fact that a claim was made, agreed
-- to and then withdrawn is exactly the trail an abuse investigation needs. A deleted row says
-- nothing at all. `revoked` is terminal for eligibility while staying re-confirmable, because the
-- common real case is an owner who mis-taps on a list of names.
CREATE TABLE tenancy_declarations (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id  uuid        NOT NULL REFERENCES properties (id) ON DELETE CASCADE,
    declarant_id uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    owner_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    status       text        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'confirmed', 'revoked')),
    lived_from   date,
    lived_to     date,
    decided_at   timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),

    -- One standing claim per person per listing. A second declaration on the same flat is not new
    -- evidence, it is the same person asking again — and without this, an owner who revoked a false
    -- claim would face it again the next minute, which turns revocation into a formality.
    CONSTRAINT uq_tenancy_declaration_per_declarant UNIQUE (property_id, declarant_id),

    -- A stay that ended before it began is a typo, and it is the only field pair here a reviewer
    -- could get wrong in a way the owner is unlikely to notice while skimming a name.
    CONSTRAINT tenancy_declarations_dates_check
        CHECK (lived_from IS NULL OR lived_to IS NULL OR lived_to >= lived_from)
);

-- The owner's inbox for one listing, and the eligibility probe, are the only two reads. The unique
-- constraint above already indexes (property_id, declarant_id), which serves the probe; this covers
-- the inbox, which asks for a whole listing at once.
CREATE INDEX idx_tenancy_declarations_property ON tenancy_declarations (property_id, status);


-- =========================================================================================
-- rent_agreements
-- =========================================================================================

-- rent_agreements: owner-KYC-gated agreement records (schema: RentAgreement). tenant may be an
-- unregistered mobile at draft time, so tenant_mobile is text (resolves to a user on activation).
CREATE TABLE rent_agreements (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id     uuid NOT NULL REFERENCES properties(id),
    owner_id        uuid NOT NULL REFERENCES users(id),
    tenant_mobile   text CHECK (tenant_mobile ~ '^[6-9][0-9]{9}$'),
    rent            bigint,
    deposit         bigint,
    start_date      date,
    duration_months integer,
    status          text NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','e-sign-pending','registered','active','expired')),
    document_url    text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rent_agreements_property ON rent_agreements (property_id);

-- GET /me/rent-agreements is owner-scoped and newest-first, which the property index cannot serve.
CREATE INDEX idx_rent_agreements_owner ON rent_agreements (owner_id, created_at DESC);


-- =========================================================================================
-- managed_properties
-- =========================================================================================

-- managed_properties — the owner's private "single-player" property record (slice B).
--
-- WHAT THIS IS
-- ------------
-- A managed property is one an owner registers for their OWN benefit — valuation, a document
-- passport, rent tracking — BEFORE, or entirely WITHOUT, advertising it publicly. It is private by
-- default and never appears in buyer search. The front end has always kept these in a per-user
-- localStorage store (`puneNestManagedProps:<mobile>`); slice B gives that store a server so the
-- Owner Hub, Property Passport and rent tracker can run against real data.
--
-- WHY A SEPARATE TABLE, NOT A ROW IN `properties`
-- ----------------------------------------------
-- A marketplace listing (`properties`) is a heavily-governed aggregate: it is moderated
-- (pending -> approved), it is searched, its foundation fields revert it to re-moderation when
-- edited, and it is soft-deleted so an approved row is never truly gone. A managed property is the
-- opposite on every axis — private by default, never moderated, never searched, freely edited, hard
-- deleted. Forcing it into `properties` would either loosen those invariants for everyone or need a
-- pile of "but not for managed rows" exceptions in the search/moderation paths. Keeping it in its
-- own table mirrors the front end's separate store and leaves the catalogue's invariants untouched.
--
-- "RECONCILE WITH LISTINGS" = LINK, NOT MERGE
-- -------------------------------------------
-- Publishing a managed property does not move it into `properties`; it CREATES a normal pending
-- listing (through the ordinary owner-create path, so every trust invariant still applies) and
-- records that listing's id here in `published_listing_id`. The private record and its public
-- listing then coexist, linked, exactly as the front end models it. Deleting the managed record
-- never touches the listing it spawned.
CREATE TABLE managed_properties (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id              uuid NOT NULL REFERENCES users(id),  -- the person who registered it
    -- Core property facts. `deal` follows the `properties` convention (buy|rent), NOT the front
    -- end's managed-only "sale" label, so publish is a straight pass-through; the seam translates.
    title                 text   NOT NULL,
    deal                  text   NOT NULL,                     -- buy|rent (validated in the service)
    property_type         text   NOT NULL,
    bhk                   numeric,
    price                 bigint NOT NULL,                     -- whole INR (contract Money)
    locality              text   NOT NULL,
    locality_slug         text,
    society               text,
    area                  numeric,
    area_unit             text   NOT NULL DEFAULT 'sqft',
    furnishing            text,
    -- Lifecycle. Server-controlled, never client-supplied: a managed row is born private/managed and
    -- only publish moves it to public/published.
    visibility            text   NOT NULL DEFAULT 'private',   -- private|public
    status                text   NOT NULL DEFAULT 'managed',   -- managed|published
    -- Owner-only rent tracker state (the Rent Panel), meaningful only to the owner.
    rented                boolean NOT NULL DEFAULT false,
    tenant_name           text,
    monthly_rent          bigint,
    due_day               integer,
    -- The Rent-o-meter valuation snapshot: an opaque owner-only blob, never shown to buyers.
    valuation             jsonb,
    -- The listing this record was published into, if any. Nullable: an unpublished record has none.
    published_listing_id  uuid REFERENCES properties(id),
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);

-- The only read is "this owner's records, newest first"; there is no cross-user query, by design.
CREATE INDEX idx_managed_properties_owner_created ON managed_properties (owner_id, created_at DESC);

COMMENT ON TABLE managed_properties IS
    'An owner''s private property record (valuation, document passport, rent tracking) kept apart '
    'from the moderated `properties` catalogue. Private by default; publishing spawns a normal '
    'pending listing and links to it via published_listing_id rather than merging into it.';

-- A PARTIAL UNIQUE INDEX ON THE LISTING BRIDGE
-- -----------------------------------------------
-- `ensureManagedForListing` gives every listing you own a companion managed record, so the Owner
-- Hub tools (passport, vault, rent tracking) have something to hang off. In the browser that was
-- safe by accident: the dedup was a scan of a local array, and there was only ever one array.
--
-- Over HTTP the same dedup is a read followed by a write, and two tabs -- or one tab and a slow
-- retry -- can both read "no bridge row" before either writes. With no constraint on
-- `published_listing_id` the second write would have succeeded and the owner would quietly own two
-- managed records for one flat: two passports, two vaults, two rent schedules, and no way to tell
-- which is the real one.
--
-- The index makes the loser of that race fail loudly instead. It is PARTIAL because the column is
-- null for every unpublished record -- the common case, and the one where duplicates are meaningful
-- (you may well own two flats in the same society that you have not listed). Only the *bridge* is
-- unique, and only once a bridge exists.
--
-- The client still dedups against the list it already loads; this is the backstop for the race that
-- dedup cannot see, not a replacement for it.
CREATE UNIQUE INDEX idx_managed_properties_published_listing
    ON managed_properties (published_listing_id)
    WHERE published_listing_id IS NOT NULL;

COMMENT ON INDEX idx_managed_properties_published_listing IS
    'One managed record per published listing. Partial: unpublished records have a null bridge and '
    'an owner may legitimately hold many. Backstop for the read-then-write race in the client-side '
    'bridge dedup (D32).';


-- =========================================================================================
-- managed_property_documents
-- =========================================================================================

-- A THIRD DOCUMENT TABLE, FOR THE SAME REASON V32 CREATED THE SECOND
-- ---------------------------------------------------------------------
-- The Property Passport shows a DocVault keyed on the *managed* record's id, and it is the one part
-- of the document flip that never shipped. The reason is on the record at
-- docs/system/frontend-data-seam.md: DocVault and PropertyPassport stayed on `lib/` because
-- "passport ids are mock-only". D32 makes those ids real, which retires the excuse and leaves the
-- question the excuse was standing in for: where does a document about a flat you own but have not
-- listed actually live?
--
-- Not in `documents`. `documents.property_id` was once nullable for exactly this kind of idea and
-- V20 tightened it to NOT NULL, reasoning that a row with no property is unreachable -- a leak of
-- storage, not a feature. V32 met that same question for KYC papers and answered it by adding a
-- table rather than reversing V20, precisely so the property vault's sharing and grant logic can go
-- on assuming every row it holds has a listing. That answer has not aged; this is the third sibling
-- under the same rule.
--
-- WHY NOT JUST WAIT FOR THE LISTING
-- ---------------------------------
-- A managed record is what an owner keeps *before* they are ready to advertise -- often long before.
-- The sale deed, the index-II, the society NOC are the papers you gather while deciding, and
-- gathering them is most of what the Passport is for. Telling the owner "publish first, then you may
-- upload" inverts the workflow the feature exists to serve. And when they do publish, the property
-- vault at /me/documents/{propId} is a different bucket with a different audience: those files are
-- shareable with buyers through the request/grant flow. These are not.
--
-- SHAPE MIRRORS personal_documents, WHICH MIRRORS documents
-- ---------------------------------------------------------
-- Same storage model: bytes in the object store under a server-minted `storage_key`, URL signed and
-- short-lived at read time, so no `url` column (a persisted URL is a permanent bearer credential to
-- someone's title deed). No `service_request_id` and no share token: a managed-record document is
-- never handed to a buyer or a lawyer through this table -- if the owner wants that, they publish,
-- and upload to the listing's vault. `uploaded_at` is a distinct column from `created_at`,
-- following the `documents` convention.
--
-- ON DELETE CASCADE, unlike its two siblings, which reference `users` and `properties` -- rows that
-- are archived rather than deleted. A managed record has a real DELETE endpoint (slice 9), and
-- an owner who removes a flat from their hub means it; leaving its papers behind as unreachable
-- rows would recreate the exact "leak of storage" V20 objected to.
CREATE TABLE managed_property_documents (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    managed_property_id uuid NOT NULL REFERENCES managed_properties(id) ON DELETE CASCADE,
    category            text,                         -- "Sale Deed", "Index II", ... (UI's vocabulary)
    file_name           text,                         -- uploader's filename, sanitised; never the key
    storage_key         text NOT NULL,                -- object-store key; signed URL derived at read time
    size_bytes          bigint,
    mime_type           text,                         -- the type the bytes prove, not the one declared
    uploaded_at         timestamptz NOT NULL DEFAULT now(),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

-- The only read is "this record's papers, newest first". Ownership is resolved through
-- managed_properties.owner_id before this table is touched at all, so there is no owner column here
-- to index -- and no query that would use one.
CREATE INDEX idx_managed_property_documents_prop_uploaded
    ON managed_property_documents (managed_property_id, uploaded_at DESC);

COMMENT ON TABLE managed_property_documents IS
    'Papers attached to a property an owner tracks privately in the Owner Hub, which may never have '
    'been listed. Kept apart from `documents` so the property vault''s sharing and request logic can '
    'assume every row it holds belongs to a listing (V20, V32). Never shared with a buyer.';


-- =========================================================================================
-- managed_property_rent_receipts
-- =========================================================================================

-- Manual rent receipts: the months an owner recorded rent for, outside PuneNest's payment rail.
--
-- `lib/data/rentReminders.js` has held these in `localStorage` under `puneNestRentLog:<mobile>`
-- since the prototype, and its own header admitted it ("Prototype only (localStorage)"). The defect
-- is the same one V119 closed for lead notes and V117 closed for photo requests, and it is total: an
-- owner who marks August received on their phone opens the laptop to an unpaid August, the ledger is
-- one Clear-site-data away from gone, and the HRA receipt the tenant was handed is backed by nothing
-- the landlord can produce again. A rent receipt is a tax document. It cannot live in a browser.
--
-- Deliberately NOT `rent_payments`, despite both rows meaning "rent, for a month, paid".
-- `rent_payments` was the *tenant's* gateway record: the tenant initiates it, a payment provider
-- moves the money, and the paid state is set by a webhook, never by a human. Nothing about that is
-- true here -- the owner collected cash or a bank transfer we never saw, and the owner asserting it
-- is the only evidence there will ever be. Sharing a table would mean a `paid_at` that is sometimes
-- webhook-authoritative and sometimes self-reported, with no column able to say which, and it would
-- put a "mark received" write within one bug of the gateway's own state. Two tables, and the wall
-- between them is the feature. (That gateway rail has since been withdrawn entirely -- see the
-- header of this file -- which is why only this side of the wall still exists.)
--
-- Every column except `rent_month` is a SNAPSHOT the server derived from the owned managed property
-- at the moment of recording, and none of them are accepted from the browser. That is what makes the
-- row a receipt rather than a join: a receipt handed over in August must keep saying what it said in
-- August, even after the owner raises the rent, renames the tenant or edits the address. The
-- alternative -- read `managed_properties` at render time -- silently rewrites documents already in
-- a tenant's hands.
CREATE TABLE managed_property_rent_receipts (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- ON DELETE CASCADE, unlike V119's deliberately unparented `lead_key`: a receipt has no meaning
    -- apart from the property it is for, there is no read that does not start from that property,
    -- and an owner who deletes their private record has asked for exactly this. That record is
    -- hard-deleted (ManagedPropertyService.delete), so without the cascade the FK would refuse the
    -- delete and the Owner Hub's remove button would start answering 500.
    managed_property_id uuid NOT NULL REFERENCES managed_properties(id) ON DELETE CASCADE,

    -- 'YYYY-MM'. Text rather than a date because a receipt is *for a month*, not for a day, and a
    -- date column would force an arbitrary day-of-month that every reader would then have to agree
    -- to ignore. The CHECK is what keeps it sortable: lexical order over a fixed-width zero-padded
    -- 'YYYY-MM' is chronological order, which is why the read below needs no expression index.
    -- Written as an explicit character class rather than `\d`, which means a literal backslash-d
    -- unless `standard_conforming_strings` is off.
    rent_month          varchar(7) NOT NULL
        CONSTRAINT ck_managed_rent_receipt_month CHECK (rent_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),

    -- Snapshots. `> 0` because a receipt for zero rupees is not a receipt; the service refuses a
    -- property with no monthly rent set for the same reason, and this is the backstop for any writer
    -- that is not the service.
    amount              bigint NOT NULL CHECK (amount > 0),
    tenant_name         varchar(200) NOT NULL,
    landlord_name       varchar(200) NOT NULL,
    property_address    varchar(500) NOT NULL,

    -- `created_at` is also the receipt date -- the moment the owner asserted the rent arrived. A
    -- separate `received_at` was drafted and dropped: the endpoint takes no date, so the two columns
    -- could only ever hold the same instant, and a second column that is always a copy is a second
    -- column that can one day disagree.
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

-- One receipt per property per month, and this is what makes the second "Mark received" a
-- deterministic 409 rather than a duplicate tax document. The service checks first so the ordinary
-- answer reads as a sentence; this is what holds when two taps genuinely race -- the same shape and
-- the same reasoning as `uq_photo_requests_requester_property` (V117).
--
-- It is also the read path. The ledger fetches `WHERE managed_property_id = ? ORDER BY rent_month
-- DESC LIMIT n`, so this index leads with the right column and already delivers the ordering; a
-- second index over the same pair would be dead weight.
CREATE UNIQUE INDEX uq_managed_rent_receipt_month
    ON managed_property_rent_receipts (managed_property_id, rent_month);


-- V1 convention: every migration ends by (re)wiring trg_set_updated_at onto every table that has an
-- `updated_at` column. For `managed_property_rent_receipts` nothing updates a receipt today -- the
-- row is immutable by design and the entity maps every column `updatable = false` -- so for that
-- table this is here for the writer that is not Hibernate and not yet written, rather than for any
-- path that exists. For `tenant_rentals` it earns its place outright: the row is edited whenever the
-- rent is revised at renewal, which is the ordinary case rather than an exceptional one.
SELECT install_updated_at_triggers();
