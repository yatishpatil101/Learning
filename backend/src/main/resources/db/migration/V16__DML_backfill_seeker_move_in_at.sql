-- V16 DML Backfill `flatmate_seeker_posts.move_in_at` from the legacy free-text `move_in`.
--
-- Background. V13 added `move_in_at` as the range-scannable form of the free-text `move_in` a
-- post has always carried, and `FlatmateSeekerService.parseMoveIn` fills it on every write. But
-- nothing ever populated the rows that already existed, so `move_in_at` was null on EVERY post
-- predating that write path -- which, in the seeded databases, is all of them.
--
-- That gap was invisible for as long as move-in was filtered in the browser, because the browser
-- read the free-text column. V15 moved the facet to the server, where it reads `move_in_at`, and
-- the null column turned "3 posts are available immediately" into "no post has ever stated a
-- date". The board did not error; it simply stopped distinguishing, and every move-in threshold
-- returned an identical set. A column being present, typed and indexed says nothing about it
-- being POPULATED, and only the second matters to a predicate.
--
-- The translation below is the SQL twin of `parseMoveIn`, and must stay that way:
--
--   'now'            -> today                  (an immediate post is the most definite of all,
--                                               so it must not land in the "unstated" bucket)
--   '15' '30' '60'   -> today + N days         (the legacy buckets the picker used to emit)
--   ISO 'YYYY-MM-DD' -> that date
--   anything else    -> left null              (genuinely unstated; a value we cannot read is
--                                               not a value we may invent)
--
-- Only null rows are touched, so a post that already parsed a date on write keeps it, and
-- re-running this against a populated table is a no-op rather than a rewrite.
--
-- The dates are computed relative to the migration's own run date. For the legacy buckets that is
-- the same approximation `parseMoveIn` makes on write ("60 days from when it was said"), and for
-- seed data -- which is what this actually touches -- it is what keeps a fixture meaningfully
-- "available soon" instead of decaying into the past as the fixture ages.

UPDATE flatmate_seeker_posts
SET move_in_at = CASE
        WHEN lower(btrim(move_in)) = 'now' THEN current_date
        WHEN btrim(move_in) IN ('15', '30', '60') THEN current_date + btrim(move_in)::integer
        WHEN btrim(move_in) ~ '^\d{4}-\d{2}-\d{2}$' THEN btrim(move_in)::date
        ELSE NULL
    END
WHERE move_in_at IS NULL
  AND move_in IS NOT NULL
  AND btrim(move_in) <> '';
