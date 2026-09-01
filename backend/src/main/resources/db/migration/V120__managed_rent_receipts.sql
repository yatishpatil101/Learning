-- Manual rent receipts: the months an owner recorded rent for, outside PuneNest's payment rail.
--
-- `lib/data/rentReminders.js` has held these in `localStorage` under `puneNestRentLog:<mobile>`
-- since the prototype, and its own header admitted it ("Prototype only (localStorage)"). The defect
-- is the same one V119 closed for lead notes and V117 closed for photo requests, and it is total: an
-- owner who marks August received on their phone opens the laptop to an unpaid August, the ledger is
-- one Clear-site-data away from gone, and the HRA receipt the tenant was handed is backed by nothing
-- the landlord can produce again. A rent receipt is a tax document. It cannot live in a browser.
--
-- Deliberately NOT `rent_payments` (V44), despite both rows meaning "rent, for a month, paid".
-- `rent_payments` is the *tenant's* gateway record: the tenant initiates it, a payment provider
-- moves the money, and the paid state is set by a webhook, never by a human. Nothing about that is
-- true here -- the owner collected cash or a bank transfer we never saw, and the owner asserting it
-- is the only evidence there will ever be. Sharing a table would mean a `paid_at` that is sometimes
-- webhook-authoritative and sometimes self-reported, with no column able to say which, and it would
-- put a "mark received" write within one bug of the gateway's own state. Two tables, and the wall
-- between them is the feature.
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
-- `updated_at` column. Nothing updates a receipt today -- the row is immutable by design and the
-- entity maps every column `updatable = false` -- so this is here for the writer that is not
-- Hibernate and not yet written, rather than for any path that exists.
SELECT install_updated_at_triggers();
