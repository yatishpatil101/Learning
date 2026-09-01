-- V105 — community society minting: provenance, and the ops queue that promotes it.
--
-- WHY THIS EXISTS
--
-- A lister or a searcher who cannot find their society is offered "Add it". Until now that mint
-- wrote a record to `pnCommunitySocieties` in that one browser's localStorage and registered the
-- slug into an in-memory lookup map. Three things followed from that, in ascending order of cost:
--
--   1. The society existed for exactly one person. Nobody else could find it, follow it, or list a
--      flat in it -- which is the entire reason somebody adds a society.
--   2. Following it 404'd against the server, because the server had never heard of the slug. The
--      follow context had to special-case such follows and hold them locally, hoping ops would one
--      day promote the slug. Ops could not: see (3).
--   3. The "Candidates" queue an operator opens to verify a community society read the *operator's*
--      browser. It was permanently empty. No community society has ever been promoted, because
--      there was no reachable path from minting one to anybody else seeing it.
--
-- So this migration does not add a feature. It gives an existing, shipped, four-surface funnel
-- somewhere real to write to.
--
-- WHAT IT ADDS
--
-- `source = 'community'` was already an allowed value on `societies_source_check` and is already
-- documented on the entity as one of the three provenances -- it just had no writer. Nothing about
-- the enum changes here. What was missing is who minted a row and whether anybody has since checked
-- it, which are exactly the two questions the ops queue is asking.
--
-- Verification is deliberately NOT a boolean. `verified_at` plus `verified_by` answers "has anybody
-- looked at this, and who do I ask about it" -- a flag answers only the first, and the day two
-- operators disagree about a society the flag cannot say which of them set it. The pair is
-- constrained to move together, because a verification with no verifier is a decision nobody signed.
--
-- `registration` and `conveyance` stay untouched by promotion. They are claims about the building's
-- legal state, not about our confidence in the record; conflating "we checked this society is real"
-- with "its conveyance deed is done" is how a community-minted row would start telling a buyer
-- something nobody ever established.

alter table public.societies add column created_by uuid references public.users(id);
alter table public.societies add column verified_at timestamptz;
alter table public.societies add column verified_by uuid references public.users(id);

alter table public.societies
    add constraint ck_society_verified_pair
    check ((verified_at is null) = (verified_by is null));

comment on column public.societies.created_by is
    'The member who minted this society, for community-sourced rows. Null for curated and RERA '
    'imports, which nobody in particular typed in. Kept so an operator reviewing a candidate can '
    'ask the person who added it, and so a single account minting fifty societies is visible.';

comment on column public.societies.verified_at is
    'When ops confirmed this society is real. Null means it is still a candidate. Paired with '
    'verified_by by ck_society_verified_pair: a verification with no verifier is a decision nobody '
    'signed, and the day two operators disagree it is the only way to know who to ask.';

comment on column public.societies.verified_by is
    'The operator who confirmed it. See verified_at.';

-- The candidates queue, oldest first: the society that has waited longest is the one somebody is
-- still waiting on. Partial, because the queue is a handful of rows against a catalogue of hundreds
-- and a full index would be almost entirely dead weight.
create index idx_society_candidates
    on public.societies (created_at)
    where source = 'community' and verified_at is null;

-- Every society we already hold came from a curated list or a RERA filing, both of which are
-- verified by construction -- they are not candidates and must not appear in the ops queue. Stamped
-- with the row's own creation time rather than now(), so the audit trail does not claim somebody
-- reviewed 348 societies the moment this migration ran. verified_by stays null, which would violate
-- the pair constraint, so the backfill is deliberately NOT applied to existing rows: the queue is
-- filtered on `source = 'community'` instead, and no existing row has that source.
--
-- (Left as a comment rather than as code on purpose. The filter is the correct mechanism; a
-- backfill that has to fabricate a verifier to satisfy its own constraint is a sign the constraint
-- is right and the backfill is wrong.)

select install_updated_at_triggers();
