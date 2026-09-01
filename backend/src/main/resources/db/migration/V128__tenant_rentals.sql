-- V128 — the tenant's own record of the home they rent.
--
-- `tenancies` (V12) is written in exactly one place: `TenancyService.openFromClosedDeal`, called
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

    -- Length bounds live here and not only in the DTO, for the reason V119 states about
    -- `lead_notes`: a bound that exists only in a request record holds only for writers that pass
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
-- `archived` for the reason V12 gives for the `transactions` indexes -- every read here is a live
-- read, so archived rows have no business enlarging the index that serves them.
CREATE INDEX idx_tenant_rentals_tenant
    ON tenant_rentals (tenant_id, lease_start DESC)
    WHERE archived = false;

-- V1 convention: every migration ends by (re)wiring trg_set_updated_at onto every table that has an
-- `updated_at` column. It earns its place here -- the row is edited whenever the rent is revised at
-- renewal, which is the ordinary case rather than an exceptional one.
SELECT install_updated_at_triggers();
