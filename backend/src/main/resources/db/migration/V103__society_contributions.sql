-- =====================================================================================
-- V103 — society contributions, their helpful votes and their replies
-- =====================================================================================
-- The third and last thing the society hub kept in `localStorage`: the community tab.
-- Tips ("the 6am water pressure is fine on the lower floors"), trusted picks (a plumber
-- the building actually uses, with a number) and photos of the place as it really looks.
-- Every one of them was written into `pnSocietyContributions` in the author's own browser,
-- so the "community" tab showed each visitor a community of one — and the most useful
-- thing on the page, a neighbour's phone number for a reliable electrician, was known only
-- to the person who already had it.
--
-- THREE TABLES, and specifically not one with a `helpful integer` column:
--
--  * `society_contributions` — the post.
--  * `society_contribution_helpful` — one ROW per (post, voter), primary-keyed on the pair.
--    A counter column cannot answer "have I already found this helpful?", which is what the
--    button renders, and it cannot stop a double tap or a retried request counting twice.
--    Un-voting is a delete; the count is `count(*)`, which cannot drift.
--  * `society_contribution_replies` — the thread under a post, cascading on delete, because
--    replies to a removed tip are answers to a question nobody can see.
--
-- ONE `body` COLUMN, not three. A tip's text, a pick's note and a photo's caption are the
-- same thing wearing three names: the prose the author wrote. What genuinely differs is the
-- STRUCTURED part — a pick has a name and a number, a photo has a URL — and those get their
-- own columns and their own check constraints.
--
-- The checks are deliberately two-sided. `ck_society_contrib_kind_shape` insists a tip has
-- prose, a pick has a name and a photo has a URL — the "not empty" half. It also insists a
-- non-pick carries NO referral name or number and a non-photo carries NO photo URL. That
-- second half is a privacy rule, not tidiness: a contact detail stored on a row whose UI
-- neither renders it nor offers to remove it is a phone number nobody can get back.
--
-- `photo_url` is a URL, never a data URI. Images go through `POST /me/photos` to the public
-- bucket first; the browser build stored base64 in localStorage, which is why a photo
-- contribution was invisible on any other device and why the composer had a "too large"
-- warning at all.

create table if not exists public.society_contributions (
    id                uuid primary key default gen_random_uuid(),
    society_id        uuid not null references public.societies (id),
    author_id         uuid not null references public.users (id),
    kind              text not null,
    category          text,
    body              text,
    referral_name     text,
    referral_contact  text,
    photo_url         text,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    constraint ck_society_contrib_kind check (kind in ('tip', 'pick', 'photo')),
    constraint ck_society_contrib_kind_shape check (
        case kind
            when 'tip'   then body is not null
                          and referral_name is null and referral_contact is null
                          and photo_url is null
            when 'pick'  then referral_name is not null
                          and photo_url is null
            when 'photo' then photo_url is not null
                          and referral_name is null and referral_contact is null
            else false
        end
    )
);

create index if not exists idx_society_contrib_society_created
    on public.society_contributions (society_id, created_at desc);

comment on table public.society_contributions is
    'Community tab posts on a society hub: tips, trusted picks and photos. One `body` column '
    'because a tip''s text, a pick''s note and a photo''s caption are all the author''s prose; '
    'the structured per-kind fields are separate and check-constrained both ways, so a photo '
    'cannot quietly carry a stranger''s phone number that no screen will ever show or delete.';

create table if not exists public.society_contribution_helpful (
    contribution_id   uuid not null references public.society_contributions (id) on delete cascade,
    user_id           uuid not null references public.users (id),
    created_at        timestamptz not null default now(),
    primary key (contribution_id, user_id)
);

comment on table public.society_contribution_helpful is
    'One row per person per contribution. The composite primary key is the whole point: it '
    'makes a second vote from the same person impossible rather than merely unlikely, so a '
    'double tap or a retried request on a bad connection cannot inflate the count.';

create table if not exists public.society_contribution_replies (
    id                uuid primary key default gen_random_uuid(),
    contribution_id   uuid not null references public.society_contributions (id) on delete cascade,
    author_id         uuid not null references public.users (id),
    body              text not null,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

create index if not exists idx_society_contrib_replies_parent
    on public.society_contribution_replies (contribution_id, created_at);

comment on table public.society_contribution_replies is
    'Threaded replies under a contribution, oldest first, cascading on delete — a reply to a '
    'removed tip is an answer to a question the reader cannot see.';

select install_updated_at_triggers();
