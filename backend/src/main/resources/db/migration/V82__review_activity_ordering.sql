-- V82: finish the job V81 started, and stop paying for an index nothing can use (D218).
--
-- V81 added property_reviews.last_message_at, backfilled it from review_messages, left it nullable,
-- and indexed it partially on `last_message_at is not null`. Both queue queries then sorted on
-- `coalesce(last_message_at, updated_at)`. Three things were wrong with that shape:
--
-- 1. Postgres matches ORDER BY to an index by expression identity. The index key was
--    `last_message_at`; the sort key was `coalesce(last_message_at, updated_at)`. Different
--    expressions, so no index scan -- and the index being partial on a predicate neither query
--    carries meant it was not even eligible. Both desks seq-scanned and top-N sorted every page,
--    and the index earned nothing but write cost.
-- 2. The coalesce made the sort key mean two different things depending on the row: "when someone
--    last spoke" for a case with messages, "when the row was last touched by anything at all" for
--    one without. A queue whose ordering rule changes per row is a queue nobody can reason about.
-- 3. No unique tiebreak. Ties are not exotic here -- V81's own backfill gave many rows the same
--    value, and so does a batch of notes written in one transaction. Postgres is free to order ties
--    differently per execution, so paging the ops queue could show one case twice and skip another.
--
-- The fix is to make the column total: every case has a last-activity instant, a case with no
-- messages uses the moment it was opened, and the queries sort on the bare column plus id. One
-- meaning, one expression, one index that serves it.
--
-- A note on V81, because the mistake is a general one and this is where it is written down: its
-- backfill UPDATE fired trg_set_updated_at (installed on every table carrying updated_at, see
-- V1/V5), so it collapsed updated_at to the migration timestamp on every case file that had ever
-- had a message. Nothing sorts on that column any more, but it is still rendered to moderators, and
-- the value is not recoverable. Any backfill of a table with that trigger has to disable it for the
-- duration -- as this one does below.

alter table property_reviews disable trigger trg_set_updated_at;

-- Cases nobody has spoken in: opened is the last thing that happened to them, which is exactly what
-- the desk should sort them by. created_at rather than updated_at because a decision or a checklist
-- tick is not conversation, and letting those set the initial value would put a case that has been
-- worked but never replied to above one that is genuinely waiting.

update property_reviews
set last_message_at = created_at
where last_message_at is null;

alter table property_reviews enable trigger trg_set_updated_at;

alter table property_reviews
    alter column last_message_at set not null;

-- Matches `order by last_message_at desc, id desc` term for term, which is what makes it usable as
-- an ordering index rather than decoration.
drop index if exists idx_property_reviews_last_message;
create index if not exists idx_property_reviews_activity
    on property_reviews (last_message_at desc, id desc);
