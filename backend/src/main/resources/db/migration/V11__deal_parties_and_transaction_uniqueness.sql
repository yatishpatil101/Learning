-- V11 Slice 4 (deals / offers / visits / finalization) schema completion.
--
-- Three groups of change, each closing a gap between the V4/V5 tables and the contract the
-- transaction core has to serve.

-- ---------------------------------------------------------------------------------------
-- 1. deal_parties
--
-- V5 deferred this with "no multi-party deal in the contract -- add a V* migration if needed".
-- It is needed: the contract ships listParties / addParty / removeParty and the UI (the
-- "Under offer" panel) writes to it. It is deliberately NOT a users FK. An under-offer party
-- is an off-platform person the owner jotted down while showing the flat -- a name, a raw
-- mobile and a private note, with no account to reference. That is a different thing from
-- deals.counterparty_id, which is the party the deal actually closes with.
--
-- It is also deliberately not a jsonb column on deals: DELETE .../parties/{partyId} needs a
-- stable per-row identity (jsonb gives none), and the previous positional {idx} was racy.
CREATE TABLE deal_parties (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id    uuid NOT NULL REFERENCES deals(id),
    name       text NOT NULL,
    mobile     text,
    note       text,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
-- Partial index: the list read only ever wants the live rows, and soft-deleted parties are
-- dead weight in it.
CREATE INDEX idx_deal_parties_deal ON deal_parties (deal_id, created_at)
    WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------------------
-- 2. deals: closing with an off-platform buyer
--
-- DealCloseRequest is { agreedPrice, counterpartyMobile, note? } but deals only had
-- counterparty_id, a users FK. For a Pune owner the buyer is very often found off-platform --
-- a broker's client, a neighbour's cousin -- and has no account. As it stood, closing such a
-- deal was impossible, which would have made the single most important endpoint in this slice
-- unusable for the majority case.
--
-- So the mobile is stored as given, and counterparty_id is populated only when that mobile
-- resolves to a registered user. counterparty_id was already nullable; it now means "the
-- counterparty is on the platform" rather than "unknown".
--
-- Note that finalization_requests.counterparty_id stays NOT NULL and is *not* given the same
-- treatment. That is the opposite case on purpose: finalization is a two-sided maker/checker
-- flow where the counterparty has to sign in and accept, so an off-platform counterparty is
-- genuinely invalid there and should be a 422.
ALTER TABLE deals ADD COLUMN counterparty_mobile text;
ALTER TABLE deals ADD COLUMN note                text;

-- ---------------------------------------------------------------------------------------
-- 3. One live row per (user, property) for offers, visits and finalization requests
--
-- The V9 lesson, applied ahead of the bug rather than after it: a check-then-insert in the
-- service is not a uniqueness guarantee, because two concurrent double-taps interleave
-- between the check and the insert. Duplicate rows here are not cosmetic -- they double the
-- owner's pending counts, and they make "the buyer's live offer on this listing" a query that
-- can return two answers.
--
-- Partial unique indexes rather than plain UNIQUE constraints, because the restriction is only
-- on *live* rows. A buyer whose offer was declined must be able to offer again, and someone
-- who cancelled a visit must be able to rebook -- so the terminal states are excluded and any
-- number of historical rows may accumulate.
CREATE UNIQUE INDEX uq_offers_live_per_user_property
    ON offers (from_user_id, property_id)
    WHERE status IN ('pending', 'countered');

CREATE UNIQUE INDEX uq_visits_live_per_user_property
    ON visits (visitor_id, property_id)
    WHERE status IN ('scheduled', 'confirmed');

CREATE UNIQUE INDEX uq_finalization_live_per_user_property
    ON finalization_requests (initiator_id, property_id)
    WHERE status = 'pending';

-- One deal row per property. V5 created no constraint, but the whole aggregate assumes
-- "the deal on this listing" is singular -- getDeal returns one Deal, reserve/close/reopen all
-- address it positionally by {propId}. Without this, a race in the lazy create-on-first-write
-- would silently fork a listing into two deals.
CREATE UNIQUE INDEX uq_deals_property ON deals (property_id);

SELECT install_updated_at_triggers();
