-- V27 Flatmates — the re-modelled flat-sharing market.
--
-- This migration replaces the V7/V25 share-flat tables. The product decision it encodes: what used
-- to be ONE list ("share_flat_posts": a title, a locality, a rent) is really THREE different things
-- a person can be, and conflating them is why the old board could not be filtered usefully.
--
--   * a PERSON with no address, looking for others to team up with   -> flatmate_seeker_posts
--   * a ROOM inside a real flat, offered by whoever holds that flat  -> flatmate_rooms
--   * a GROUP of people, with or without an address yet              -> flatmate_groups
--
-- The consumer surface presents these as two tabs keyed on seeker INTENT rather than on our storage
-- model: `move-in` (rooms + groups that already hold an address) and `team-up` (seeker posts +
-- address-less groups). That is why a group has a nullable address rather than there being two
-- group tables — "we have a flat" is a state a group passes through, not a different kind of group.
--
-- ---------------------------------------------------------------------------------------------
-- ON THE NAMING, because it is genuinely confusing and docs/system/data-model.md gets it wrong.
--
-- data-model.md maps `flatmate_requests` to the FlatmateSeekerPost schema. That name is taken here
-- by the HOST INBOX (contract schema `FlatmateRequest`), which is a different thing entirely: a
-- seeker post is supply the seeker publishes, a request is one person asking one host for one seat.
-- Naming a table after the schema it does not serve would mislead every future reader, so:
--
--   flatmate_seeker_posts  -> FlatmateSeekerPost   (a person advertising themselves)
--   flatmate_requests      -> FlatmateRequest      (the host's inbox)
--
-- The doc is corrected in the same change.
-- ---------------------------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Seeker posts — the `team-up` supply
-- ---------------------------------------------------------------------------
-- A person with a budget and a shortlist of localities but no flat yet. Distinct from a listing in
-- every way that matters: there is no address to moderate, no owner to verify and nothing to visit.
-- What is being published is a person, which is exactly why `verified_contact_only` exists.
CREATE TABLE flatmate_seeker_posts (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               uuid        NOT NULL REFERENCES users (id),
    name                  text        NOT NULL,
    gender                text        NOT NULL DEFAULT 'any' CHECK (gender IN ('any','male','female')),
    -- Nullable, and floored at 18 rather than defaulted: age is optional on the form, and a
    -- default would invent a fact about a person. The floor is a platform rule, not a preference.
    age                   integer     CHECK (age IS NULL OR age >= 18),
    occupation            text,
    budget                bigint      NOT NULL CHECK (budget > 0),
    -- jsonb rather than text[] or a join table. A join table would buy referential integrity over a
    -- registry that is itself editorial, at the cost of a join on every feed row; text[] would be
    -- the only Postgres array in the schema, and every other list-like column on the platform
    -- (Property.amenities, Property.images, Locality, Society) is jsonb mapped to List<String>.
    -- One array style beats a marginally better one used once.
    localities            jsonb       NOT NULL DEFAULT '[]'::jsonb,
    -- Free text on purpose: the contract's FlatmateMoveIn is the literal 'now', a legacy day bucket
    -- ('15'|'30'|'60') or an ISO date. A CHECK enumerating those would reject every future date the
    -- picker can produce; the service parses it and the feed sorts on move_in_at below.
    move_in               text,
    -- The parsed form of move_in, so "available within 30 days" is an index range scan rather than
    -- a per-row string parse. Null means "now" or unparseable — both sort as immediately available.
    move_in_at            date,
    flat_pref             text        NOT NULL DEFAULT 'any' CHECK (flat_pref IN ('any','women','men')),
    room_pref             text        NOT NULL DEFAULT 'any' CHECK (room_pref IN ('any','private','shared')),
    tags                  jsonb       NOT NULL DEFAULT '[]'::jsonb,
    note                  text        CHECK (note IS NULL OR length(note) <= 600),
    -- The seeker's half of ADR-019: an opt-in demand for a badged caller. Never a platform default —
    -- requiring verification to be contacted would make the badge compulsory by the back door.
    verified_contact_only boolean     NOT NULL DEFAULT false,
    -- Snapshotted at post time (ADR-009a) rather than joined live. The badge on a card is a claim
    -- about when the post was written; recomputing it would silently rewrite history on every read.
    verified              boolean     NOT NULL DEFAULT false,
    mod_status            text        NOT NULL DEFAULT 'live'
                              CHECK (mod_status IN ('live','approved','flagged','removed','rejected')),
    lat                   double precision,
    lng                   double precision,
    archived              boolean     NOT NULL DEFAULT false,
    archived_at           timestamptz,
    archive_reason        text,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);

-- One live post per identity, enforced here rather than in the service so two concurrent creates
-- cannot both pass a count check. Partial, so archiving frees the slot — a person who found a flat
-- and later starts looking again is not blocked by their own history.
CREATE UNIQUE INDEX uq_flatmate_seeker_posts_live_user
    ON flatmate_seeker_posts (user_id) WHERE archived = false;

-- The default feed: live, visible, newest first. `mod_status` is in the predicate because a flagged
-- or removed post must vanish from the feed rather than merely render a different label.
CREATE INDEX idx_flatmate_seeker_posts_feed
    ON flatmate_seeker_posts (created_at DESC)
    WHERE archived = false AND mod_status NOT IN ('flagged','removed','rejected');

-- Locality filtering is a containment test against the array, which only GIN can answer. The
-- default jsonb operator class covers the `@>` containment this uses.
CREATE INDEX idx_flatmate_seeker_posts_localities
    ON flatmate_seeker_posts USING gin (localities);

CREATE INDEX idx_flatmate_seeker_posts_budget ON flatmate_seeker_posts (budget)
    WHERE archived = false;

COMMENT ON TABLE flatmate_seeker_posts IS
    'A person looking for flatmates with no address yet (the team-up tab). One live row per user; '
    'archiving frees the slot. Carries no contact -- the requester volunteers their own.';

-- ---------------------------------------------------------------------------
-- Rooms — the `move-in` supply
-- ---------------------------------------------------------------------------
-- A room inside a flat that actually exists. Two creation paths land in one table because a seeker
-- browsing rooms does not care which:
--
--   1. the list-property flatmate flow  -> one spare room, SEAT model (seats_total/seats_open)
--   2. an owner splitting a rent listing -> sibling rooms, OCCUPANCY model (occupants/max_occupants)
--
-- The two models are not interchangeable and the service refuses to mix them (`not_seat_based`).
-- Seats count abstract vacancies on a single post; occupancy counts real people across a whole flat,
-- which is why max_occupants is a property of the FLAT and is enforced across siblings.
CREATE TABLE flatmate_rooms (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    host_id            uuid        NOT NULL REFERENCES users (id),
    -- The parent rent listing when this room came from a split. Null for standalone spare rooms.
    -- This is the key that ties sibling rooms into one occupancy ledger and one joint agreement.
    property_id        uuid        REFERENCES properties (id),
    room_kind          text        CHECK (room_kind IS NULL OR room_kind IN ('master','bedroom','living')),
    room_type          text        NOT NULL CHECK (room_type IN ('Private room','Shared room')),
    attached_bath      text        NOT NULL DEFAULT 'shared' CHECK (attached_bath IN ('attached','shared')),
    -- Whether `budget` is what ONE PERSON pays (person, the legacy spare-room quote) or what the
    -- WHOLE ROOM costs (room, the split quote, divided by whoever takes it). Getting this wrong
    -- makes a shared bed look pricier than a private room, so it is explicit and defaulted to the
    -- legacy meaning for every row that predates the split flow.
    price_basis        text        NOT NULL DEFAULT 'person' CHECK (price_basis IN ('room','person')),
    budget             bigint      NOT NULL CHECK (budget > 0),
    deposit            bigint      CHECK (deposit IS NULL OR deposit >= 0),
    -- People living in THIS room. Emergent: the tenants decide, the host only records it. Capped at
    -- 3 by the same rule that caps any room anywhere on the platform.
    occupants          integer     NOT NULL DEFAULT 0 CHECK (occupants BETWEEN 0 AND 3),
    -- People allowed in the whole FLAT (the society's rule). The only ceiling the host declares.
    max_occupants      integer     NOT NULL DEFAULT 3 CHECK (max_occupants >= 1),
    -- Seat model. Null on split rooms, which use the occupancy ledger above instead.
    seats_total        integer     CHECK (seats_total IS NULL OR seats_total >= 1),
    seats_open         integer     CHECK (seats_open IS NULL OR seats_open >= 0),
    host_role          text        NOT NULL DEFAULT 'tenant' CHECK (host_role IN ('owner','tenant')),
    -- Derived server-side from role + proof and NEVER accepted from the client: a host that could
    -- name its own tier could award itself the badge the whole trust model rests on.
    verification_tier  text        NOT NULL DEFAULT 'identity'
                           CHECK (verification_tier IN ('identity','tenant','owner')),
    verified           boolean     NOT NULL DEFAULT false,
    agreement_declared boolean     NOT NULL DEFAULT false,
    -- Stable key for one physical flat. Two hosts resolving to the same fingerprint is the signal
    -- that someone is claiming a flat they do not hold. Indexed, not unique -- see the note below.
    address_fingerprint text,
    flag_for_review    boolean     NOT NULL DEFAULT false,
    mod_status         text        NOT NULL DEFAULT 'live'
                           CHECK (mod_status IN ('live','approved','flagged','removed','rejected')),
    society_id         uuid        REFERENCES societies (id),
    society            text,
    flat_number        text,
    locality           text        NOT NULL,
    localities         jsonb       NOT NULL DEFAULT '[]'::jsonb,
    lat                double precision,
    lng                double precision,
    bhk                text        CHECK (bhk IS NULL OR bhk IN ('1','2','3','4')),
    flat_type          text,
    home_type_label    text,
    gated_community    boolean     NOT NULL DEFAULT false,
    furnishing         text        CHECK (furnishing IS NULL OR furnishing IN ('unfurnished','semi','furnished')),
    move_in            text,
    available_from     date,
    gender             text        NOT NULL DEFAULT 'any' CHECK (gender IN ('any','male','female')),
    food               text        NOT NULL DEFAULT 'any' CHECK (food IN ('any','veg','nonveg')),
    tags               jsonb       NOT NULL DEFAULT '[]'::jsonb,
    note               text        CHECK (note IS NULL OR length(note) <= 600),
    photos             jsonb       NOT NULL DEFAULT '[]'::jsonb,
    status             text        NOT NULL DEFAULT 'active',
    archived           boolean     NOT NULL DEFAULT false,
    archived_at        timestamptz,
    archive_reason     text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),

    -- A room is one model or the other, never both and never neither-with-a-half-set-pair. Written
    -- as a constraint because every read has to know which ledger to trust, and a row with
    -- seats_total but no seats_open would make that unanswerable.
    CONSTRAINT ck_flatmate_rooms_seat_model
        CHECK ((seats_total IS NULL AND seats_open IS NULL)
            OR (seats_total IS NOT NULL AND seats_open IS NOT NULL AND seats_open <= seats_total)),
    -- Split rooms are occupancy-model by definition; a seat count on one would be a second,
    -- disagreeing answer to "how many people can still move in".
    CONSTRAINT ck_flatmate_rooms_split_has_no_seats
        CHECK (property_id IS NULL OR seats_total IS NULL)
);

CREATE INDEX idx_flatmate_rooms_feed
    ON flatmate_rooms (created_at DESC)
    WHERE archived = false AND mod_status NOT IN ('flagged','removed','rejected');

CREATE INDEX idx_flatmate_rooms_locality ON flatmate_rooms (lower(locality))
    WHERE archived = false;

CREATE INDEX idx_flatmate_rooms_budget ON flatmate_rooms (budget) WHERE archived = false;

-- Sibling lookup: every occupancy calculation on a split room has to count people across the flat,
-- so this is on the hot path of both reading and writing a split room.
CREATE INDEX idx_flatmate_rooms_property ON flatmate_rooms (property_id)
    WHERE property_id IS NOT NULL AND archived = false;

-- Deliberately NOT unique. The fingerprint is a fuzzy match (society+locality, or title+locality
-- when there is no society), so two genuinely different flats can collide -- a unique index would
-- refuse an honest second post in a large society. Contested addresses are FLAGGED for Ops, not
-- blocked, and the same-host case is what the service blocks outright.
CREATE INDEX idx_flatmate_rooms_fingerprint ON flatmate_rooms (address_fingerprint)
    WHERE address_fingerprint IS NOT NULL AND archived = false;

CREATE INDEX idx_flatmate_rooms_host ON flatmate_rooms (host_id) WHERE archived = false;

COMMENT ON TABLE flatmate_rooms IS
    'A room inside a real flat (the move-in tab). Seat model for standalone spare rooms, occupancy '
    'model for rooms created by splitting a parent rent listing. verification_tier is derived '
    'server-side and never accepted from the client.';

-- ---------------------------------------------------------------------------
-- Groups
-- ---------------------------------------------------------------------------
-- People teaming up. A group with an address sorts into `move-in`, one without into `team-up`; the
-- same row moves between tabs as the group finds a flat, which is why address is nullable here
-- rather than there being two tables.
CREATE TABLE flatmate_groups (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    host_id             uuid        NOT NULL REFERENCES users (id),
    title               text        NOT NULL,
    locality            text        NOT NULL,
    -- `any` means open-join: a request against it is auto-accepted rather than queued. The other
    -- two values are a stated preference the host applies by hand.
    policy              text        NOT NULL DEFAULT 'any' CHECK (policy IN ('any','women','men')),
    -- Whole-flat rent. Per-head is rent / seats_total, computed on read so it can never drift.
    rent                bigint      NOT NULL CHECK (rent > 0),
    seats_total         integer     NOT NULL DEFAULT 2 CHECK (seats_total >= 1),
    -- Seats open RIGHT NOW, which is not seats_total minus members: a tenant backfilling one seat
    -- of a full flat has one seat open and four members. Legacy rows leave it null and fall back.
    seats_open          integer     CHECK (seats_open IS NULL OR seats_open >= 0),
    property_id         uuid        REFERENCES properties (id),
    host_role           text        NOT NULL DEFAULT 'tenant' CHECK (host_role IN ('owner','tenant')),
    verification_tier   text        NOT NULL DEFAULT 'identity'
                            CHECK (verification_tier IN ('identity','tenant','owner')),
    agreement_declared  boolean     NOT NULL DEFAULT false,
    -- True only once the flat's OWNER confirmed by OTP that this replacement search is happening.
    -- Never client-asserted: the whole value of the record is that the owner acted.
    owner_consent       boolean     NOT NULL DEFAULT false,
    owner_consent_mobile text       CHECK (owner_consent_mobile IS NULL OR owner_consent_mobile ~ '^[6-9][0-9]{9}$'),
    address_fingerprint text,
    flag_for_review     boolean     NOT NULL DEFAULT false,
    mod_status          text        NOT NULL DEFAULT 'live'
                            CHECK (mod_status IN ('live','approved','flagged','removed','rejected')),
    tags                jsonb       NOT NULL DEFAULT '[]'::jsonb,
    note                text        CHECK (note IS NULL OR length(note) <= 600),
    archived            boolean     NOT NULL DEFAULT false,
    archived_at         timestamptz,
    archive_reason      text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT ck_flatmate_groups_seats_open
        CHECK (seats_open IS NULL OR seats_open <= seats_total)
);

CREATE INDEX idx_flatmate_groups_feed
    ON flatmate_groups (created_at DESC)
    WHERE archived = false AND mod_status NOT IN ('flagged','removed','rejected');

CREATE INDEX idx_flatmate_groups_locality ON flatmate_groups (lower(locality))
    WHERE archived = false;

CREATE INDEX idx_flatmate_groups_fingerprint ON flatmate_groups (address_fingerprint)
    WHERE address_fingerprint IS NOT NULL AND archived = false;

CREATE INDEX idx_flatmate_groups_host ON flatmate_groups (host_id) WHERE archived = false;

COMMENT ON TABLE flatmate_groups IS
    'People teaming up. With an address it sorts into move-in, without into team-up -- the same row '
    'moves between tabs as the group finds a flat.';

-- Members. A row per person rather than a jsonb array because a member is a person who can later
-- be a user: the array shape could not carry a user_id, and every "am I in this group" question
-- would be a scan of a document.
--
-- user_id is nullable because the group's creator names their initial flatmates before those people
-- have accounts. A named-but-unregistered member is exactly the state the product starts in.
CREATE TABLE flatmate_group_members (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id   uuid        NOT NULL REFERENCES flatmate_groups (id) ON DELETE CASCADE,
    user_id    uuid        REFERENCES users (id),
    name       text        NOT NULL,
    -- Stored, not derived: a person may prefer initials that are not the first letters of the name
    -- their account carries, and the card renders these directly.
    initials   text        CHECK (initials IS NULL OR length(initials) <= 2),
    verified   boolean     NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_flatmate_group_members_group ON flatmate_group_members (group_id);

-- One seat per account per group. Partial so the unregistered members above -- who all have a null
-- user_id -- do not collide with each other.
CREATE UNIQUE INDEX uq_flatmate_group_members_user
    ON flatmate_group_members (group_id, user_id) WHERE user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- The host inbox
-- ---------------------------------------------------------------------------
-- One person asking one host for one seat. Polymorphic on (kind, target_id) rather than three
-- nullable FKs: the inbox is read as one list ordered by time, and three columns of which exactly
-- two are always null is a shape that invites a query to forget one of them.
--
-- The trade-off is honest: there is no FK, so a deleted target orphans its requests. Accepted
-- because every target here is soft-deleted (archived), so the row it points at always exists.
CREATE TABLE flatmate_requests (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    kind             text        NOT NULL CHECK (kind IN ('flatmate','room','group')),
    target_id        uuid        NOT NULL,
    -- The host, denormalised at write time. The alternative is resolving the target on every inbox
    -- read to find out who owns it, which is a three-way union per row.
    host_id          uuid        NOT NULL REFERENCES users (id),
    requester_id     uuid        NOT NULL REFERENCES users (id),
    -- `request` needs the host's approval; `join` is an open-policy group the requester is already
    -- in, recorded so the host can see who arrived.
    action           text        NOT NULL DEFAULT 'request' CHECK (action IN ('request','join')),
    -- How many people are moving in, for per-room-priced rooms. Sets the opening message.
    share            text        NOT NULL DEFAULT 'solo' CHECK (share IN ('solo','bring','match')),
    message          text,
    status           text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
    requested_at     timestamptz NOT NULL DEFAULT now(),
    decided_at       timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),

    -- A decision has a time and an undecided request does not. Cheap to state, and it stops the
    -- inbox from ever having to render "accepted, at some unknown moment".
    CONSTRAINT ck_flatmate_requests_decided
        CHECK ((status = 'pending' AND decided_at IS NULL)
            OR (status <> 'pending' AND decided_at IS NOT NULL))
);

-- One request per person per target. This is what makes the interest endpoints idempotent and is
-- the reason the service does not check-then-insert: two concurrent presses would both pass a check
-- and only this can refuse the second.
CREATE UNIQUE INDEX uq_flatmate_requests_target_requester
    ON flatmate_requests (kind, target_id, requester_id);

CREATE INDEX idx_flatmate_requests_host ON flatmate_requests (host_id, requested_at DESC);

-- Backs the per-sender rate limit, which is keyed on the requester and a time window.
CREATE INDEX idx_flatmate_requests_requester ON flatmate_requests (requester_id, created_at DESC);

COMMENT ON TABLE flatmate_requests IS
    'The host-facing inbox: one row per (kind, target, requester). Resending edits the message '
    'rather than notifying twice -- a button that alerts on every press is a harassment tool.';

-- ---------------------------------------------------------------------------
-- The Ops agreement-review queue
-- ---------------------------------------------------------------------------
-- "I have a registered rent agreement" is self-declared, so a tenant-tier post does not get its
-- badge until a human has looked at the document. Owner-tier posts never appear here: they are
-- vetted through their parent listing's own documents, and reviewing them twice would be theatre.
CREATE TABLE flatmate_reviews (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    kind            text        NOT NULL CHECK (kind IN ('room','group')),
    room_id         uuid        REFERENCES flatmate_rooms (id) ON DELETE CASCADE,
    group_id        uuid        REFERENCES flatmate_groups (id) ON DELETE CASCADE,
    host_id         uuid        NOT NULL REFERENCES users (id),
    address         text,
    tier            text        NOT NULL CHECK (tier IN ('identity','tenant','owner')),
    flag_for_review boolean     NOT NULL DEFAULT false,
    owner_consent   boolean     NOT NULL DEFAULT false,
    -- The uploaded agreement, as metadata plus a URL. Files over 3 MB are recorded
    -- present-but-not-stored (tooLarge) so Ops can still ask the host for the original.
    agreement_doc   jsonb,
    status          text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    -- Required on reject and shown to the host: a rejection nobody can act on is just a dead end.
    reason          text,
    decided_by      uuid        REFERENCES users (id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),

    -- Exactly one target, matching `kind`. Two nullable FKs are the honest shape here (unlike the
    -- inbox above) because the queue genuinely joins to both tables to render an address.
    CONSTRAINT ck_flatmate_reviews_target
        CHECK ((kind = 'room'  AND room_id IS NOT NULL AND group_id IS NULL)
            OR (kind = 'group' AND group_id IS NOT NULL AND room_id IS NULL)),
    CONSTRAINT ck_flatmate_reviews_reason
        CHECK (status <> 'rejected' OR (reason IS NOT NULL AND length(trim(reason)) > 0))
);

-- One review per target, so a host cannot queue the same flat twice to get a second opinion.
CREATE UNIQUE INDEX uq_flatmate_reviews_room ON flatmate_reviews (room_id) WHERE room_id IS NOT NULL;
CREATE UNIQUE INDEX uq_flatmate_reviews_group ON flatmate_reviews (group_id) WHERE group_id IS NOT NULL;

-- The queue as Ops reads it: oldest pending first, because a review queue is a FIFO and the
-- interesting end is the one that has been waiting.
CREATE INDEX idx_flatmate_reviews_status ON flatmate_reviews (status, created_at);

COMMENT ON TABLE flatmate_reviews IS
    'Ops queue for tenant-tier posts and contested addresses. Owner-tier posts never enter it -- '
    'they are vetted through the parent listing.';

-- ---------------------------------------------------------------------------
-- Owner consent
-- ---------------------------------------------------------------------------
-- A sitting tenant listing a replacement flatmate pings the flat's owner, who confirms by OTP. The
-- row is the auditable record that turns "the owner knows" from a claim into a fact.
--
-- Keyed on the owner's mobile rather than a user id because the owner very often has no account --
-- they are a landlord, not a PuneNest user, and requiring them to sign up to say "yes, I know"
-- would mean the consent never gets recorded at all.
CREATE TABLE flatmate_owner_consents (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_mobile  text        NOT NULL CHECK (owner_mobile ~ '^[6-9][0-9]{9}$'),
    granted_by    uuid        NOT NULL REFERENCES users (id),
    group_id      uuid        REFERENCES flatmate_groups (id) ON DELETE CASCADE,
    granted_at    timestamptz NOT NULL DEFAULT now(),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_flatmate_owner_consents
    ON flatmate_owner_consents (owner_mobile, granted_by);

COMMENT ON TABLE flatmate_owner_consents IS
    'OTP-confirmed acknowledgement by a flat owner that a sitting tenant is seeking a replacement. '
    'Keyed on mobile because the owner usually has no account.';

-- ---------------------------------------------------------------------------
-- Saved searches learn a second kind
-- ---------------------------------------------------------------------------
-- The alerts table was built for listings, where a search IS a URL query string. A flatmates alert
-- is a structured criteria object over a tab-gated filter set, and squeezing it into `query` would
-- mean parsing a query string to decide which tab an alert watches.
ALTER TABLE saved_searches
    ADD COLUMN kind     text NOT NULL DEFAULT 'listings' CHECK (kind IN ('listings','flatmates')),
    ADD COLUMN criteria jsonb,
    ADD COLUMN label    text,
    ADD COLUMN mobile   text CHECK (mobile IS NULL OR mobile ~ '^[6-9][0-9]{9}$');

-- `query` was NOT NULL, which is correct for a listings alert and impossible for a flatmates one.
-- The requirement does not disappear, it becomes conditional -- so it moves from the column to a
-- CHECK that states which kind needs which payload.
ALTER TABLE saved_searches ALTER COLUMN query DROP NOT NULL;

ALTER TABLE saved_searches ADD CONSTRAINT ck_saved_searches_payload
    CHECK ((kind = 'listings'  AND query IS NOT NULL)
        OR (kind = 'flatmates' AND criteria IS NOT NULL));

-- V8 declared channel IN ('whatsapp','email','push') but the contract has always listed `sms` too,
-- so an SMS alert was a 500 from a constraint rather than a 422 from validation.
ALTER TABLE saved_searches DROP CONSTRAINT IF EXISTS saved_searches_channel_check;
ALTER TABLE saved_searches ADD CONSTRAINT saved_searches_channel_check
    CHECK (channel IN ('whatsapp','sms','email','push'));

CREATE INDEX idx_saved_searches_kind ON saved_searches (user_id, kind);

-- ---------------------------------------------------------------------------
-- share-flat is NOT retired here, deliberately
-- ---------------------------------------------------------------------------
-- `share_flat_posts` (V7) and `share_flat_interests` (V25) survive this migration untouched, and
-- ShareFlatController keeps serving them.
--
-- The temptation is to carry the rows over and drop the tables in one go. That would make this
-- migration and the Java change that deletes the share-flat package a single indivisible step:
-- deploy the SQL a moment early and the running application is validating against tables that no
-- longer exist. Keeping V27 purely additive means it can land, be inspected, and be rolled forward
-- from at leisure, with the old surface still answering the whole time.
--
-- The carry-over and the two DROPs live in V28, alongside the controller deletion, the removal of
-- the legacy /share-flat/* block from the contract, and the SpecCoverageTest floor change. One
-- change, one moment where the old surface stops answering and the new one starts.

-- V1 convention: every migration ends by (re)wiring trg_set_updated_at onto every table that has
-- an updated_at column. Idempotent.
SELECT install_updated_at_triggers();
