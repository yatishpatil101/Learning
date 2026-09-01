-- Wave C slice 1 — society residency and society claims.
--
-- Everything a resident has ever typed into the society hub lived in their own browser. Both of the
-- tables below back a permission, not a preference, which is why they are the first slice: the
-- notice board is already gated on "is this person a verified resident or the committee", and that
-- question cannot be answered by a localStorage array that the person answering it owns.
--
-- Why two tables and not one "membership" row. A claim is a society saying "we run this listing"
-- and is decided by ops; a residency is a person saying "I live in flat B/704" and is decided by
-- the committee once a claim exists, or by ops until then. They have different subjects, different
-- deciders and different lifetimes — a society stays claimed while residents come and go.

-- ---------------------------------------------------------------------------------------------
-- society_claims — a committee asking for control of its own society page.
-- ---------------------------------------------------------------------------------------------
create table society_claims (
    id          uuid primary key default gen_random_uuid(),
    society_id  uuid not null references societies (id),
    claimed_by  uuid not null references users (id),
    name        text not null,
    role        text,
    email       text,
    note        text,
    status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    decided_at  timestamptz,
    decided_by  uuid references users (id),
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

-- One live claim per society, enforced by the database rather than by a read-then-write check.
-- A rejected claim is deliberately outside the index: a committee whose paperwork was wrong must be
-- able to apply again, and a society whose secretary changed must be able to be claimed by the next
-- one. Only 'pending' and 'approved' are exclusive, and they are exclusive against each other too —
-- a second committee cannot queue up behind the one that already holds the page.
create unique index ux_society_claims_live
    on society_claims (society_id)
    where status in ('pending', 'approved');

-- The ops queue reads "every pending claim, oldest first" and nothing else.
create index idx_society_claims_status_created
    on society_claims (status, created_at);

-- The hub asks "who administers this society" on every load for a signed-in reader.
create index idx_society_claims_claimed_by
    on society_claims (claimed_by, status);

comment on table society_claims is
    'A committee asking to administer its own society page. Approved => societies.claim_status = claimed and the claimant becomes the society admin.';

-- ---------------------------------------------------------------------------------------------
-- society_residents — one person's verified tenure of one flat.
-- ---------------------------------------------------------------------------------------------
create table society_residents (
    id           uuid primary key default gen_random_uuid(),
    society_id   uuid not null references societies (id),
    user_id      uuid not null references users (id),
    wing         text,
    flat         text,
    -- Wing and flat normalised into one comparable token ('B','704' -> 'B704'). Stored rather than
    -- computed because it is what the uniqueness index below is built on, and an index over an
    -- expression that has to agree with application code in two languages is a trap.
    unit_key     text not null,
    relation     text not null default 'resident'
                 check (relation in ('owner', 'tenant', 'family', 'resident')),
    status       text not null default 'pending'
                 check (status in ('pending', 'verified', 'rejected')),
    -- Who owes this request a decision. A claimed society reviews its own residents; an unclaimed
    -- one has nobody to, so ops do. Stamped at request time rather than derived on read, because
    -- the answer must not change under a queue somebody is already working.
    assigned_to  text not null default 'ops' check (assigned_to in ('ops', 'committee')),
    -- 'conflict' when a different person is already verified in this unit. Advisory: the request is
    -- still accepted and still reviewable, because a flat genuinely does change hands and the
    -- reviewer is the one who can tell a handover from an impostor.
    flagged      text,
    note         text,
    decided_at   timestamptz,
    decided_by   uuid references users (id),
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now(),
    -- One standing request per person per society. Re-applying replaces rather than accumulates.
    constraint ux_society_residents_person unique (society_id, user_id)
);

-- One verified holder per flat. This is the rule the whole feature rests on — a notice board where
-- two people can both be B/704 is a notice board nobody can trust — and it is enforced here rather
-- than in the service so that two reviewers approving two claimants at the same moment cannot both
-- win. Partial, so rejected and pending rows for the same unit are free to exist.
create unique index ux_society_residents_unit_verified
    on society_residents (society_id, unit_key)
    where status = 'verified';

-- The committee/ops review queue: every request for one society, newest first.
create index idx_society_residents_society_status
    on society_residents (society_id, status, created_at desc);

-- "Which societies am I a verified resident of" — asked by every gated write in the hub.
create index idx_society_residents_user_status
    on society_residents (user_id, status);

comment on table society_residents is
    'One person''s claimed tenure of one flat. Verified residents may post to the society board and Q&A.';

-- Wire trg_set_updated_at onto the new tables (V1 convention: every migration ends with this).
select install_updated_at_triggers();
