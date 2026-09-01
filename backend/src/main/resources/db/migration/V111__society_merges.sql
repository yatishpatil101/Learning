-- V111 — one society absorbing its duplicate: `merged_into`.
--
-- WHY THIS EXISTS
--
-- Auto-minting a society (V105) from four surfaces guarantees duplicates: "Kumar Pinnacle", "Kumar
-- Pinnacle Phase 1" and "kumar pinacle" are three rows and one building. V105's own comments say so
-- and say what fixes it -- "an operator finds them and merges them by hand" -- and the mint guard's
-- comments say the same in three more places. There has never been a server-side merge for that
-- operator to use.
--
-- What shipped instead was `mergeSocieties()` in the browser, writing a `from -> to` map to
-- `pnSocietyMerges` in localStorage. That has the same shape of failure as every other society
-- queue before it, and one worse consequence:
--
--   1. The merge was recorded in exactly one operator's browser. A second operator opening the
--      candidates queue saw the same duplicate pair untouched.
--   2. So they merged it again -- and nothing said which direction the first one chose. Two
--      operators can and will pick opposite survivors, and neither can see the other's decision.
--   3. Nobody outside that browser ever saw the result. The duplicate stayed in the public
--      directory, kept collecting listings, follows, reviews and residency claims, and split the
--      building's page in two for every reader.
--
-- So this migration does not add a feature either. It gives an existing, shipped ops action
-- somewhere real to write to, and makes the answer the same for everybody who asks.
--
-- WHY A POINTER AND NOT A DELETE
--
-- Nine tables reference `societies (id)`: `properties`, `society_follows`, `society_claims`,
-- `society_residents`, `society_questions`, `society_board_items`, `society_contributions`,
-- `society_proposals`, and the flatmate rooms of V27. Deleting the losing row is therefore not
-- "tidying up" -- it is either a foreign-key violation or, if somebody cascades it, the silent
-- destruction of a resident's verified residency and of every review written about the building
-- under the other name. Moving those rows onto the survivor instead is not destructive but is
-- irreversible: once `properties.society_id` has been rewritten, nothing records which listings
-- moved, so a merge made in error can never be taken back.
--
-- A pointer moves nothing. `merged_into` records the operator's judgement and leaves every other
-- row exactly where it was; the reads follow the pointer and union the two societies' activity, so
-- one hub shows the whole building. Undoing a merge is then one statement that restores a state we
-- never left, which matters because merging the wrong pair is a realistic mistake -- the operator is
-- looking at two rows that differ by a typo -- and today it has no undo at all.
--
-- WHY THE THREE COLUMNS MOVE TOGETHER
--
-- `ck_society_merged_trio` mirrors V105's `ck_society_verified_pair`, for the same reason. A merge
-- with no operator and no timestamp is a decision nobody signed, and on the day two operators
-- disagree about which of two societies is the real one, the signature is the only thing that can
-- say who to ask. `num_nonnulls` rather than three pairwise checks: the constraint is "all or
-- none", and writing it as the thing it is keeps a future fourth column from being added to two of
-- the three checks.
--
-- WHY SELF-MERGE IS A SCHEMA CONSTRAINT AND CHAINS ARE NOT
--
-- `ck_society_merge_not_self` is expressible in SQL, costs nothing, and closes the one case that
-- would deadlock every reader: a row pointing at itself is an infinite resolution loop, and no
-- amount of service-layer care survives a hand-run UPDATE. So it is enforced where a hand-run
-- UPDATE cannot get past it.
--
-- Chains -- A merged into B while B is merged into C -- cannot be a CHECK, because a CHECK cannot
-- see another row. They are refused in `SocietyMergeService` instead, in both directions: a society
-- that is already merged away cannot be a merge target, and a society that has absorbed others
-- cannot itself be merged away until those are undone. The result is that resolution depth is
-- exactly one hop, forever, which is what lets every read follow the pointer with a single lookup
-- and lets an undo restore precisely the state that preceded it. That guarantee is worth the two
-- 409s it costs an operator, who is told in each case exactly which merge to undo first.

alter table public.societies add column merged_into uuid references public.societies (id);
alter table public.societies add column merged_at timestamptz;
alter table public.societies add column merged_by uuid references public.users (id);

alter table public.societies
    add constraint ck_society_merge_not_self
    check (merged_into is distinct from id);

alter table public.societies
    add constraint ck_society_merged_trio
    check (num_nonnulls(merged_into, merged_at, merged_by) in (0, 3));

comment on column public.societies.merged_into is
    'The surviving society this duplicate was merged into, or null. A pointer, not a move: every '
    'row in the nine tables that reference societies(id) stays where it is, and the reads union the '
    'two societies together. That is what makes a merge undoable -- rewriting properties.society_id '
    'would not be, because nothing would record which listings had moved.';

comment on column public.societies.merged_at is
    'When the merge was recorded. Moves with merged_into and merged_by via ck_society_merged_trio.';

comment on column public.societies.merged_by is
    'The operator who merged it. A merge with no signature is a decision nobody made, and the day '
    'two operators disagree about which of two rows is the real society it is the only way to know '
    'who to ask. See merged_at.';

-- One partial index, serving both readers of this column: the read-side union ("which societies
-- were merged into this one?", an equality lookup on merged_into) and the ops merge list ("what is
-- merged right now?", the whole partial index). Partial because merges are a handful of rows
-- against a catalogue of hundreds and a full index would be almost entirely dead weight.
--
-- Deliberately NOT a second index on (merged_at desc) for the ops list's ordering. That list sorts
-- the same handful of rows this index already narrows to, so the sort is over tens of rows and an
-- index to avoid it would be maintained on every merge to save nothing measurable.
create index idx_society_merged_into
    on public.societies (merged_into)
    where merged_into is not null;
