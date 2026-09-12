-- V13 DDL Flatmates: the flat-sharing market -- supply, demand, the host inbox, the Ops
-- agreement-review queue, owner consent and the flatmate shortlist.
--
-- Scope: `flatmate_seeker_posts` (a person advertising themselves), `flatmate_rooms` (a room inside
-- a real flat), `flatmate_groups` + `flatmate_group_members` (people teaming up),
-- `flatmate_group_applications` (a formed group applying to a whole-flat listing),
-- `flatmate_requests` (the host inbox), `flatmate_reviews` (the Ops agreement queue),
-- `flatmate_owner_consents` (the OTP-confirmed owner acknowledgement) and `flatmate_saves`
-- (the flatmate shortlist).
--
-- Folded from the old chain: V27 (the seven original tables -- its `saved_searches` half lives in
-- the alerts file), V28 (the share-flat retirement; its two carry-over INSERTs are DML and the two
-- `share_flat_*` tables it dropped are therefore never created anywhere -- see the history block at
-- the foot of this file), V29 (flatmate_group_applications only -- its `otp_codes.purpose` half
-- lives in the identity file), V30 (the unfiltered admin board index), V41 (moderate-before-public:
-- the `pending` mod_status and the whitelist feed indexes), V49 (the status-filtered host-inbox
-- index -- its document-request sibling lives in the documents file), V54 (the correction to V27's
-- comment on `uq_flatmate_requests_target_requester`), V55 (member name nullable -- its "Member"
-- rows update is DML), V124 (flatmate_saves).
--
-- `flatmate_groups` MUST be created before `flatmate_group_members`,
-- `flatmate_group_applications`, `flatmate_reviews` and `flatmate_owner_consents`, and
-- `flatmate_rooms` before `flatmate_reviews`, which carry foreign keys to them.
--
-- ---------------------------------------------------------------------------------------------
-- From V27 -- the re-modelled flat-sharing market.
--
-- This replaces the V7/V25 share-flat tables. The product decision it encodes: what used
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
-- group tables -- "we have a flat" is a state a group passes through, not a different kind of group.
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
--
-- ---------------------------------------------------------------------------------------------
-- From V41 -- flatmate posts are moderated before they are public (D72).
--
-- Until V41 a seeker post, a room or a group appeared on a `security: []` board the instant it was
-- written. Every other public-facing thing a user writes on this platform — a listing, a review —
-- passes a moderator first. The board is free-text `title`, `note` and `locality`, which is exactly
-- where a broker puts a phone number to route around the contact rules, so the moderation queue was
-- a cleanup crew arriving after the harm rather than a gate in front of it.
--
-- Three decisions, folded into the three tables below:
--
--   1. `pending` is allowed by the CHECK constraints.
--   2. It is the column default, so a row inserted by any path — the API, a fixture, a support
--      script — starts unvetted. The application default in the entity says the same thing; this is
--      the guarantee, that one is the message.
--   3. The three feed indexes match the queries, which switched from a blacklist
--      (`NOT IN ('flagged','removed','rejected')`) to a whitelist (`IN ('live','approved')`). The
--      index predicate has to be at least as permissive as the query predicate for PostgreSQL to
--      use it, and — more to the point — a partial index still describing the old rule is a
--      standing invitation to write the old rule back.
--
-- Rows written before V41 were NOT migrated to `pending`. They say `live` and they were published
-- under the rule in force at the time; sweeping the whole board into a queue would take down honest
-- supply to punish people for a policy they could not have known about. Backfilling is a moderation
-- decision, not a schema one.
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
    -- `pending` and the `pending` default are V41/D72: moderated before public, see the header.
    mod_status            text        NOT NULL DEFAULT 'pending'
                              CHECK (mod_status IN ('pending','live','approved','flagged','removed','rejected')),
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
-- or removed post must vanish from the feed rather than merely render a different label. The
-- predicate is the V41 whitelist rather than V27's original blacklist -- see the header.
CREATE INDEX idx_flatmate_seeker_posts_feed
    ON flatmate_seeker_posts (created_at DESC)
    WHERE archived = false AND mod_status IN ('live','approved');

-- The moderation queue's own read: oldest first, so the person who has waited longest is served
-- first. Partial on `pending` because the queue is the only caller and the table is dominated by
-- rows that have already been decided.
CREATE INDEX idx_flatmate_seeker_posts_pending
    ON flatmate_seeker_posts (created_at)
    WHERE mod_status = 'pending' AND archived = false;

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
--
-- Flat splits need NO table of their own (V29) -- they are rows here with a `property_id`, which is
-- exactly the point of putting both room models in one table.
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
    -- `pending` and the `pending` default are V41/D72: moderated before public, see the header.
    mod_status         text        NOT NULL DEFAULT 'pending'
                           CHECK (mod_status IN ('pending','live','approved','flagged','removed','rejected')),
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
    WHERE archived = false AND mod_status IN ('live','approved');

CREATE INDEX idx_flatmate_rooms_pending
    ON flatmate_rooms (created_at)
    WHERE mod_status = 'pending' AND archived = false;

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
    -- `pending` and the `pending` default are V41/D72: moderated before public, see the header.
    mod_status          text        NOT NULL DEFAULT 'pending'
                            CHECK (mod_status IN ('pending','live','approved','flagged','removed','rejected')),
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
    WHERE archived = false AND mod_status IN ('live','approved');

CREATE INDEX idx_flatmate_groups_pending
    ON flatmate_groups (created_at)
    WHERE mod_status = 'pending' AND archived = false;

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
--
-- ---------------------------------------------------------------------------------------------
-- From V55 -- a flatmate member's name is nullable: "we have not been told" is a real answer (D118).
--
-- WHAT WAS WRONG
--
-- `flatmate_group_members.name` was declared NOT NULL (V27) and is fed from `users.name`, which is
-- nullable: an OTP sign-in creates an account with a verified mobile and nothing else, and the name
-- only appears if and when the person fills in their profile. Joining an open-policy group
-- therefore flushed a null into a NOT NULL column and 500'd -- for exactly the people who had just
-- signed up, the ones least equipped to read a server error.
--
-- That was patched at the write site in `FlatmateSupplyService.join` by substituting the literal
-- string "Member". It stopped the 500 and replaced it with something worse: a value that is stored
-- permanently, is indistinguishable from a person genuinely called Member, and is rendered to other
-- people as *that person's name*. The schema was insisting on a fact the application does not have,
-- so the application invented one. A constraint that can only be satisfied by inventing data is not
-- protecting the data.
--
-- WHY NULLABLE RATHER THAN A NAME AT SIGN-UP
--
-- Requiring a name at sign-up is the other way to make the constraint honest, and it is a product
-- decision with real cost: it adds a field to the one flow -- OTP -- whose whole point is that it
-- asks for nothing but a number. That call is deliberately left open. The nullable column only
-- stops the database asserting something the application cannot know.
--
-- NULL here reads as "this member has not told us their name yet", which is the literal truth and,
-- unlike "Member", is reversible: the moment the person fills in their profile there is nothing
-- wrong stored that has to be found and undone. The fallback moves to the display layer, where it
-- is a rendering choice rather than a claim -- the card draws a neutral avatar, and no one is shown
-- a name the platform made up.
--
-- EXISTING "Member" ROWS BECAME NULL
--
-- V55 also cleared the rows the old fallback had already written. The only writer that could
-- produce that literal is the join fallback above, and it always wrote alongside a `user_id` (a
-- join is by definition an account acting), so the update was narrowed to rows that carry one. The
-- other writer -- group creation -- takes the name from the request body, where
-- `FlatmateGroupCreate.name` is required, so it cannot have produced a null-substitute.
--
-- The residual false positive is a creator who typed "Member" as their own display name. Converting
-- their row costs them nothing observable: the display fallback renders the same neutral avatar
-- either way, so what they see does not change, while every genuinely fabricated row stops claiming
-- to be a name. Leaving the rows instead would preserve a lie the display layer has no way to
-- detect -- there is no column that says "this string was invented" -- which is the whole defect.
--
-- `initials` was cleared with it. It was derived from the fabricated name ("M"), so keeping it
-- would move the invention from the name column into the avatar and leave the card still showing
-- it.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE flatmate_group_members (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id   uuid        NOT NULL REFERENCES flatmate_groups (id) ON DELETE CASCADE,
    user_id    uuid        REFERENCES users (id),
    name       text,
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

COMMENT ON COLUMN flatmate_group_members.name IS
    'Display name, or NULL when the person has not given one -- an OTP account has no name until '
    'its profile is filled in (D118). NULL is not a missing value to be defaulted: the fallback is '
    'rendered at display time so nothing invented is ever stored.';

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
    -- ---------------------------------------------------------------------------------------
    -- Group applications keep `live` as their default.
    --
    -- Deliberate, not an oversight: an application is a private message from one person to one
    -- host, not a public post. `mod_status` here exists so an admin can remove spam, and defaulting
    -- it to `pending` would mean a host could not see who had applied until a moderator got round
    -- to it — which is a worse outcome than the problem V41 is solving.
    -- ---------------------------------------------------------------------------------------
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

-- From V30 — the index the paged admin group-application board needs.
--
-- V29 created two indexes on flatmate_group_applications: (listing_id, created_at DESC) for the
-- owner's per-listing view, and (mod_status, created_at DESC) for a filtered moderation queue.
-- Neither serves `GET /admin/group-applications`, which is unfiltered and ordered by created_at
-- alone, so that read did a full-table sort.
--
-- It went unnoticed because the endpoint returned every row anyway: sorting the whole table is not
-- obviously wasteful when the whole table is the answer. Paging the endpoint is what makes the
-- absence expensive rather than merely untidy -- without this index the database would still sort
-- every application on every page request and then discard all but twenty rows, which is the same
-- work as before plus the discarding.
--
-- DESC to match the query's own ordering. A plain ASC index can be read backwards by Postgres, so
-- this is not strictly required, but matching the query means the plan needs no reverse scan and
-- the intent is legible to whoever reads the schema next.
CREATE INDEX idx_flatmate_group_applications_created
    ON flatmate_group_applications (created_at DESC);

COMMENT ON TABLE flatmate_group_applications IS
    'A flatmate group applying to an owner''s listing. `status` is the owner''s decision and '
    '`mod_status` the admin''s -- two independent axes that must never be written by each other.';

COMMENT ON COLUMN flatmate_group_applications.mod_status IS
    'Admin spam axis on a private application. Defaults to live, unlike the public flatmate '
    'surfaces (V41/D72), because an application is addressed to one host rather than published.';

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

-- =========================================================================================
-- One request per person per target.
--
-- V27's own comment on this index was false, and had been since it shipped. V54 recorded the
-- correction beside the index rather than editing V27, because `spring.flyway.validate-on-migrate`
-- is not set anywhere in this repo, so Flyway's default applied and validation was ON: editing an
-- applied migration -- even prose, even a comment -- moves its checksum, and both databases had V27
-- applied (`draazy`, the seeded dev database, and `draazy_test`). Every subsequent boot of
-- either would have failed validation, and the only ways out are `flyway repair` or rebuilding the
-- database from empty. The dev database carries hand-made local state and the register itself says
-- to do this "when the test DB is next rebuilt, never mid-wave"; that was mid-wave. Consolidating
-- the chain IS that rebuild, so the corrected account now stands here on its own.
-- =========================================================================================
--
-- V27 said, above the index:
--
--     "One request per person per target. This is what makes the interest endpoints idempotent and
--      is the reason the service does not check-then-insert: two concurrent presses would both pass
--      a check and only this can refuse the second."
--
-- Three claims, and the first two are the wrong way round from the code they sit beside.
--
--   * "idempotent" -- it is not. A second ask is REFUSED: both write paths throw
--     `alreadyInterested()` and the caller gets the contract's 409. An idempotent endpoint would
--     answer with the first request; this one declines to make a second. Refusal and idempotence
--     are different promises and a reader who believes the wrong one will write a client that
--     treats 409 as a bug.
--
--   * "the reason the service does not check-then-insert" -- the service does exactly
--     check-then-insert, in both doors, and always has.
--     `FlatmateSeekerService.express` and `FlatmateSupplyService.record` each call
--     `findByKindAndTargetIdAndRequesterId(...).isPresent()` and throw before reaching
--     `saveAndFlush`. D175 did not add that check; it moved the read to *after*
--     `locks.holdUntilCommit(FLATMATE_INTEREST, requesterId)`, because reading before the lock was
--     a stale read by construction and was answering 201 to the press that arrived a millisecond
--     late.
--
--   * "two concurrent presses would both pass a check and only this can refuse the second" -- true
--     when written, and now only the residual case. The advisory lock serialises the two presses on
--     the requester, so under READ COMMITTED the loser's post-lock read takes a fresh snapshot and
--     sees the winner's committed row. The index is the BACKSTOP for the case the lock cannot cover
--     -- an isolation level above READ COMMITTED, where the loser carries its pre-lock snapshot past
--     the check -- and the `DataIntegrityViolationException` catch beside each save turns that into
--     the same 409 rather than a 500.
--
-- So the index is right, the constraint is right, and the prose beside it argued for the opposite
-- design. That is worse than no comment: a correct constraint defends itself, whereas a wrong
-- explanation gets trusted and then propagated.
--
-- The correction is also recorded in two places that cost nothing to change:
--
--   * on the index itself, below, so `\d+ flatmate_requests` carries the truth in the database
--     rather than only in a file, and
--   * as a javadoc paragraph on `FlatmateRequestRepository.findByKindAndTargetIdAndRequesterId`,
--     which is the Java side of the same invariant and the place a reader of the service lands.
CREATE UNIQUE INDEX uq_flatmate_requests_target_requester
    ON flatmate_requests (kind, target_id, requester_id);

comment on index uq_flatmate_requests_target_requester is
    'One request per (kind, target, requester). CORRECTION TO V27''s COMMENT (D176): V27 calls this '
    'the reason the service does not check-then-insert, and calls the interest endpoints '
    'idempotent. Both are false. Both write paths -- FlatmateSeekerService.express and '
    'FlatmateSupplyService.record -- do check-then-insert, and a second ask is refused with 409, '
    'not answered idempotently. Since D175 the check runs behind an advisory lock on the requester, '
    'which closes the race under READ COMMITTED; this index is the backstop for a higher isolation '
    'level, and the DataIntegrityViolationException catch beside each save turns it into the same '
    '409 rather than a 500.';

CREATE INDEX idx_flatmate_requests_host ON flatmate_requests (host_id, requested_at DESC);

-- Backs the per-sender rate limit, which is keyed on the requester and a time window.
CREATE INDEX idx_flatmate_requests_requester ON flatmate_requests (requester_id, created_at DESC);

-- From V49, one of the composite indexes for the two remaining inboxes D77 paged. The other one --
-- the document-request inbox (`GET /me/documents/requests`) -- lives in the documents file.
--
-- Same reasoning as V48's deal-cluster indexes (now in the deals file), which shipped alongside its
-- paging change: api-standards.md §5 requires every read the API sorts on to be index-served, and
-- paging a read whose sort is not indexed makes it *slower*, not faster -- the scan still happens,
-- the whole matched set is still sorted, all but twenty rows are then discarded, and the envelope's
-- count(*) adds a second pass. The index is what turns a page into a saving.
--
-- Both predicates are `<scope> = ? / in (?)` followed by `order by <timestamp> desc limit ?`.
-- A composite index with the timestamp in it lets Postgres walk from the newest row in scope and
-- stop after `size`, so page one costs the same at ten rows and at ten thousand.
--
-- The flatmate host inbox (`GET /me/flatmate-requests`), status-filtered.
--
-- `idx_flatmate_requests_host (host_id, requested_at DESC)` already serves the unfiltered inbox
-- exactly, and is left to do so. What it does not serve is `?status=accepted`: Postgres walks
-- the host's rows newest-first and discards everything that does not match, which is fine while
-- most rows match and pathological when few do -- a host with two thousand pending requests and
-- three accepted ones reads almost the entire index to fill one page of three. Since a host filters
-- precisely because the unfiltered list has become unmanageable, the bad case is the one people
-- actually hit.
--
-- Not partial: unlike V48's finalization index, no status here is write-only. `pending` is the
-- default view, `accepted` is the one a host revisits to find who is moving in, and `declined` is
-- read when somebody asks why they never heard back.
CREATE INDEX idx_flatmate_requests_host_status_requested
    ON flatmate_requests (host_id, status, requested_at DESC);

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
-- they are a landlord, not a Draazy user, and requiring them to sign up to say "yes, I know"
-- would mean the consent never gets recorded at all.
--
-- The OTP side of this flow -- `otp_codes.purpose` learning 'owner-consent' (V29) -- lives in the
-- identity file. Scoping it as its own purpose is what keeps a consent code and a login code apart.
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
-- The flatmate shortlist (V124)
-- ---------------------------------------------------------------------------
-- `saved_properties` has held the property half of "Saved" since V1. The flatmate half was never
-- given a table: it lived in `draazyFlatmateSaved`, a localStorage key that also cached the card's
-- title, price and photo at save time. A save therefore belonged to a browser rather than to a
-- person, and the cached card went stale the moment the room's rent changed.
--
-- Deliberately NOT a column on `saved_properties`. A flatmate save points at one of three tables,
-- so it cannot carry `property_id`, and widening that table would mean a nullable FK plus a check
-- constraint to keep exactly one of them set — a shape whose only purpose would be to let two
-- unrelated shortlists share a name.
--
-- No FK on `post_id`, for the same reason: Postgres has no polymorphic reference. Existence is
-- checked in the service before the insert, and a row whose target is later deleted is dropped from
-- the projection rather than returned as a hole — the same contract `SavedPropertyService` states
-- for a hard-deleted property.
CREATE TABLE flatmate_saves (
    user_id    uuid NOT NULL REFERENCES users(id),
    kind       text NOT NULL,
    post_id    uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (user_id, kind, post_id),
    CONSTRAINT flatmate_saves_kind_chk CHECK (kind IN ('room', 'group', 'post'))
);

-- The only read pattern: one user's shortlist, newest save first.
--
-- `clock_timestamp()` rather than `now()`: `now()` is the *transaction* timestamp and is constant
-- for its whole duration, so three saves made inside one transaction would tie and the shortlist's
-- order would be whatever the planner returned. This column is an ordering key, so it has to be the
-- wall clock.
CREATE INDEX ix_flatmate_saves_user_created ON flatmate_saves (user_id, created_at DESC);

COMMENT ON TABLE flatmate_saves IS
    'A user''s flatmate shortlist. `kind` names which table `post_id` points at: flatmate_rooms, '
    'flatmate_groups or flatmate_seeker_posts. Hard-deleted like saved_properties (D8.9) — a '
    'shortlist toggle is a preference, not a business record.';

-- ---------------------------------------------------------------------------------------------
-- HISTORY: how share-flat became flatmates (V27 + V28)
-- ---------------------------------------------------------------------------------------------
-- `share_flat_posts` (V7) and `share_flat_interests` (V25) are NOT created anywhere in this chain.
-- They were retired by V28 and the reasoning is kept here because it is the product history of the
-- tables above.
--
-- V27 added the flatmates tables and deliberately left both share-flat tables in place, so that
-- migration could land while the old controller was still answering:
--
--     "`share_flat_posts` (V7) and `share_flat_interests` (V25) survive this migration untouched,
--      and ShareFlatController keeps serving them.
--
--      The temptation is to carry the rows over and drop the tables in one go. That would make this
--      migration and the Java change that deletes the share-flat package a single indivisible step:
--      deploy the SQL a moment early and the running application is validating against tables that
--      no longer exist. Keeping V27 purely additive means it can land, be inspected, and be rolled
--      forward from at leisure, with the old surface still answering the whole time.
--
--      The carry-over and the two DROPs live in V28, alongside the controller deletion, the removal
--      of the legacy /share-flat/* block from the contract, and the SpecCoverageTest floor change.
--      One change, one moment where the old surface stops answering and the new one starts."
--
-- V28 was that other half: carry the data across, then drop the tables. It shipped in the same
-- change that deleted ShareFlatController, removed the legacy /share-flat/* block from the contract
-- and adjusted the SpecCoverageTest floor -- one moment where the old surface stopped answering and
-- the new one started.
--
-- POSTS BECAME SEEKER POSTS
--
-- The old board's rows are seeker posts in everything but shape: a person, a locality, a budget.
-- They were carried across rather than dropped, because a live post is somebody's actual search and
-- deleting it to simplify a migration is deleting their work.
--
-- The mapping was lossy in exactly one place and deliberately so: `title` was free text that mixed
-- an introduction with a locality, and there is no honest way to recover a person's NAME from it.
-- The poster's account name was used instead and the old title kept as the note, which is where
-- free text belongs on the new shape.
--
-- One value was respelled: pref_gender 'non-veg' does not exist (that was pref_food), but pref_food
-- 'non-veg' becomes 'nonveg' -- the same value spelled the way the new vocabulary spells it. Food
-- preference has no column on a seeker post at all, so it survived only inside the carried note.
--
-- The newest live post per poster became their one live seeker post. V7 allowed five; V27 allows
-- one, so the rest were carried in as archived rather than silently dropped -- a poster's history
-- survives and the partial unique index still holds. `pref_gender` used the same vocabulary as the
-- new `gender` column, so it mapped straight across; NULL meant "no preference recorded", which the
-- new column spells 'any' since it is NOT NULL.
--
-- INTERESTS BECAME INBOX ROWS
--
-- `kind` was 'flatmate' because the target is now a seeker post, and the host is whoever wrote it.
-- Status stayed 'pending': the old model had no accept/decline, so every carried interest is a
-- question nobody has answered yet -- which is exactly what pending means. decided_at stayed null,
-- as the check constraint requires for a pending row. A poster answering their own ad is not
-- representable in the new model and never was meaningful; the old service refused it, so the
-- carry-over only guarded against rows that predated that service.
--
-- Both carry-overs were `INSERT ... SELECT` against tables that no longer exist. On a fresh
-- database there is nothing to carry, so no DML is emitted here.
-- ---------------------------------------------------------------------------------------------

-- V1 convention: every migration ends by (re)wiring trg_set_updated_at onto every table that has
-- an updated_at column. Idempotent.
SELECT install_updated_at_triggers();
