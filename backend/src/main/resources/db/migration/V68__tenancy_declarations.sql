-- V68 D194: the second half of "did this person live here" — an owner-confirmed self-declaration.
--
-- Review eligibility is meant to be "visited OR lived here". Only the visit half was ever real: the
-- tenancy half was decided client-side from a localStorage bucket nothing on the live path writes,
-- so against the API it was unconditionally false and a genuine ex-tenant who never booked a visit
-- could not review the flat they lived in. The brokered half is fixed by simply asking
-- `/me/tenancies`, which has existed all along. This table is the other half.
--
-- WHY NOT A `tenancies` ROW. Two reasons, and either alone is decisive.
--
-- (1) It would not fit. `uq_tenancies_active_per_property` (V12) permits at most one active tenancy
--     per property, because two would not be a duplicate record but a double-let. Every declaration
--     is about a *past* stay, and several different people may have lived in the same flat over the
--     years, so the shape this evidence naturally takes is many-rows-per-property — the opposite of
--     what that index exists to forbid.
--
-- (2) It would launder weak evidence into strong. A `tenancies` row is the parent of rent payments
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

SELECT install_updated_at_triggers();
