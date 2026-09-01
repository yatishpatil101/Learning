-- =====================================================================================
-- V104 — community proposals about a society: details, the WhatsApp group, the map pin
-- =====================================================================================
-- Three features, one table, on purpose.
--
-- A detail suggestion, a resident WhatsApp invite and a corrected map pin are the same
-- lifecycle wearing three names: somebody who knows the building proposes a fact, ops
-- screen it, and on approval it is written onto the society itself. They share the same
-- queue, the same "already decided, do not double-write" rule, and the same question of
-- who is allowed to propose. Three parallel tables would be three places for that rule to
-- drift, and the drift would be invisible until the day one of them silently reverted an
-- operator's decision.
--
-- What differs between them is the payload, so the payload gets columns rather than a jsonb
-- blob: `invite_url` has a format the database can refuse, `lat`/`lng` have a range, and a
-- suggestion of "towers: 4" is a number nobody should have to cast out of JSON at read time.
--
-- `ck_society_proposal_shape` is two-sided, exactly like the contributions check in V103. It
-- insists a proposal of each kind carries what that kind means, AND that it carries nothing
-- belonging to another kind. The second half is not tidiness: a WhatsApp invite riding along
-- on a detail suggestion would be approved by an operator reviewing a builder's name, which
-- is precisely the review the invite is supposed to get.

create table public.society_proposals (
    id uuid primary key default gen_random_uuid(),
    society_id uuid not null references public.societies (id),
    author_id uuid not null references public.users (id),
    kind text not null,
    status text not null default 'pending',

    -- details
    builder text,
    build_year integer,
    towers integer,
    units integer,
    maintenance_per_sqft numeric,
    amenities jsonb,

    -- whatsapp
    invite_url text,

    -- location
    lat double precision,
    lng double precision,
    place_id text,
    label text,

    decided_by uuid references public.users (id),
    decided_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint ck_society_proposal_kind
        check (kind in ('details', 'whatsapp', 'location')),
    constraint ck_society_proposal_status
        check (status in ('pending', 'approved', 'rejected')),
    -- A decision has a decider and a moment; a pending proposal has neither. Without this a
    -- rejected row can carry no record of who rejected it, which is the one thing the author
    -- will ask about.
    constraint ck_society_proposal_decision
        check ((status = 'pending' and decided_by is null and decided_at is null)
            or (status <> 'pending' and decided_by is not null and decided_at is not null)),
    constraint ck_society_proposal_shape check (
        case kind
            -- At least one detail, or the proposal says nothing and still occupies a queue.
            when 'details' then
                (builder is not null or build_year is not null or towers is not null
                 or units is not null or maintenance_per_sqft is not null
                 or amenities is not null)
                and invite_url is null
                and lat is null and lng is null and place_id is null and label is null
            when 'whatsapp' then
                invite_url is not null
                and builder is null and build_year is null and towers is null
                and units is null and maintenance_per_sqft is null and amenities is null
                and lat is null and lng is null and place_id is null and label is null
            -- Half a point is not a point: a latitude with no longitude lands the map in the
            -- sea, which is worse than the wrong pin it was meant to correct.
            when 'location' then
                lat is not null and lng is not null
                and builder is null and build_year is null and towers is null
                and units is null and maintenance_per_sqft is null and amenities is null
                and invite_url is null
            else false
        end)
);

-- One pending proposal per society per kind. A resident who re-proposes is correcting their
-- own submission, not queueing a second one for an operator to reconcile; the service upserts
-- onto this index. Decided rows are deliberately outside it, so the history of what was
-- approved and rejected survives.
create unique index uq_society_proposal_pending
    on public.society_proposals (society_id, kind)
    where status = 'pending';

-- The ops queue reads by status, oldest first: a proposal that has waited longest is the one
-- somebody is still waiting on.
create index idx_society_proposal_queue
    on public.society_proposals (status, created_at);

comment on table public.society_proposals is
    'Community-proposed facts about a society (details, WhatsApp group invite, map pin), held '
    'pending until ops decide. On approval the value is written onto societies itself — these '
    'rows are the audit trail, not the source the hub reads.';

-- The two facts an approved proposal writes that the societies table had nowhere to put.
-- `place_id` is the only Google Place field persisted besides the coordinates; nothing else
-- (ratings, photos, reviews, opening hours) may be stored, per the Places terms.
alter table public.societies add column place_id text;

-- 'community' when a resident's corrected pin was approved. The hub renders the provenance
-- next to the map: a coordinate a neighbour walked to and a coordinate bulk-imported from a
-- RERA filing are both coordinates, and only one of them has been to the building.
alter table public.societies add column loc_source text;

comment on column public.societies.place_id is
    'Google Place id for the society, when a resident''s approved location fix supplied one. '
    'The only Place field persisted besides lat/lng.';
comment on column public.societies.loc_source is
    'Provenance of lat/lng: ''community'' once an approved resident correction wrote them.';

select install_updated_at_triggers();
