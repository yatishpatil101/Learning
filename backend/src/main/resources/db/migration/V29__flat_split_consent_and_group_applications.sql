-- V29 The last of the flatmates surface: flat splits, owner consent and group applications.
--
-- Two schema changes and one deliberate non-change:
--   1. `otp_codes.purpose` learns 'owner-consent'.
--   2. `flatmate_group_applications` is created.
--   3. Flat splits need NO new table -- they are rows in `flatmate_rooms` with a `property_id`,
--      which V27 already provides. That was the point of putting both room models in one table.

-- ---------------------------------------------------------------------------
-- OTP gains a purpose
-- ---------------------------------------------------------------------------
-- A sitting tenant listing a replacement flatmate pings the flat's OWNER, who confirms by OTP that
-- they know it is happening. That code is not a login: it authenticates nobody, issues no token and
-- is sent to a person who usually has no account at all.
--
-- Scoping it as its own purpose is what keeps the two apart. The send-budget and the attempt cap are
-- both keyed on (mobile, purpose), so a consent request cannot burn a login code's budget, and --
-- much more importantly -- a code obtained through the consent flow can never be presented at
-- /auth/login. Reusing 'login' here would have made "ask for consent" a way to mint login codes for
-- any number you can name.
--
-- V2 wrote this as an inline CHECK, so it has the generated name.
ALTER TABLE otp_codes DROP CONSTRAINT IF EXISTS otp_codes_purpose_check;
ALTER TABLE otp_codes ADD CONSTRAINT otp_codes_purpose_check
    CHECK (purpose IN ('login', 'signup', 'contact', 'owner-consent'));

-- ---------------------------------------------------------------------------
-- Group applications
-- ---------------------------------------------------------------------------
-- A formed flatmate group applies to an owner's whole-flat rent listing: "the four of us will take
-- it". Distinct from `flatmate_requests`, which is one person asking one host for one seat -- here
-- the group is the applicant and a listing is the target, so the direction and both ends differ.
--
-- TWO INDEPENDENT STATUSES, and keeping them apart is the whole reason this is a table rather than a
-- flag on something else:
--   * `status`     -- the OWNER's decision. Theirs alone; admin must never write it.
--   * `mod_status` -- the ADMIN's moderation axis, exactly as on every other flatmate row.
-- An admin removing a spam application must not thereby "decline" it on the owner's behalf, and an
-- owner declining must not make it invisible to moderation.
CREATE TABLE flatmate_group_applications (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The listing applied to. A real FK: unlike flatmate_requests (polymorphic across three target
    -- kinds), this always points at exactly one table, so there is no reason to weaken it.
    listing_id   uuid        NOT NULL REFERENCES properties (id),
    group_id     uuid        NOT NULL REFERENCES flatmate_groups (id) ON DELETE CASCADE,
    -- Denormalised so the admin list does not have to resolve the group's host per row.
    applicant_id uuid        NOT NULL REFERENCES users (id),
    status       text        NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'accepted', 'declined')),
    mod_status   text        NOT NULL DEFAULT 'live'
                     CHECK (mod_status IN ('live', 'approved', 'flagged', 'removed', 'rejected')),
    -- Internal moderation note. Never returned to a consumer; the contract has no field for it.
    note         text,
    decided_at   timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ck_flatmate_group_applications_decided
        CHECK ((status = 'pending' AND decided_at IS NULL)
            OR (status <> 'pending' AND decided_at IS NOT NULL))
);

-- One application per group per listing. A group that applies twice is a group pressing a button
-- twice, not two applications -- and without this the owner's inbox is the thing that suffers.
CREATE UNIQUE INDEX uq_flatmate_group_applications
    ON flatmate_group_applications (listing_id, group_id);

-- The owner's view: applications on my listing, newest first.
CREATE INDEX idx_flatmate_group_applications_listing
    ON flatmate_group_applications (listing_id, created_at DESC);

-- The admin queue, which reads the whole board newest-first and filters by moderation state.
CREATE INDEX idx_flatmate_group_applications_mod
    ON flatmate_group_applications (mod_status, created_at DESC);

COMMENT ON TABLE flatmate_group_applications IS
    'A flatmate group applying to an owner''s listing. `status` is the owner''s decision and '
    '`mod_status` the admin''s -- two independent axes that must never be written by each other.';

SELECT install_updated_at_triggers();
