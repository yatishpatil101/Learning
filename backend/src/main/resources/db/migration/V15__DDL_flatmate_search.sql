-- V15 DDL Flatmate search: the columns and indexes the merged `/flatmates/feed` search needs to
-- narrow, count and page in the database instead of in the browser.
--
-- Background. Until this migration the flatmate board was filtered in two places at once. The
-- server accepted `locality`, `budget` and `verifiedOnly`, gathered at most 200 rows per source
-- table, merged them in Java and handed the lot to the client, which then re-applied the SAME
-- three facets plus seven more (free text, near-a-point, gender, sharing, attached bath, move-in
-- and habits) in JavaScript. Two consequences, both user-visible:
--
--   1. Every count on the screen was a count of the 200-row gather, not of the board. A locality
--      with 240 rooms reported the wrong total and had no 201st row to page to.
--   2. Any facet the browser owned could only ever NARROW what the server had already chosen, so
--      the two predicates intersected to whichever was tighter. Adding a value to the server's
--      vocabulary changed nothing on screen while the client's copy stayed behind.
--
-- The fix is to move all ten facets to the server. Most of what that needs already exists: `tags`
-- is jsonb on all three tables, `seats_total` is on groups, and move-in is already a real `date`
-- (`flatmate_rooms.available_from`, `flatmate_seeker_posts.move_in_at`) alongside the legacy
-- free-text `move_in` the API still accepts. This file adds only what is genuinely missing.
--
-- ---------------------------------------------------------------------------------------------
-- ON THE PER-HEAD PRICE, because the two supply types are not symmetrical and one of them cannot
-- have a stored column.
--
-- The board quotes what ONE PERSON pays, but neither table stores that number.
--
--   * A GROUP divides a whole-flat rent by its seats: `rent / seats_total`. Both operands are on
--     the row, `seats_total` is NOT NULL with a `>= 1` check, so this is a per-row immutable
--     expression and therefore a legitimate generated column. It is added below.
--
--   * A ROOM cannot have one. A room priced `per room` is split between however many people can
--     still move in, and that headroom is a property of the FLAT, not of the row: it is
--     `max_occupants` minus the SUM of `occupants` across every sibling room sharing the flat. A
--     generated column must be immutable and may reference only its own row, so this is not
--     expressible as one, and a trigger maintaining it would be a second writer of a derived truth
--     that can silently drift from the rows it summarises. The search query computes it instead,
--     with a window aggregate partitioned by flat key -- see FlatmateSearchQueries.
--
-- The asymmetry is deliberate and worth keeping: a stored column where one is safe, a computed one
-- where it is not. What must never happen is the third option -- filtering rooms on the raw
-- `budget` and leaving the split rule in the browser -- because the server's total would then be a
-- claim the visible rows contradict.
-- ---------------------------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Groups: coordinates, for the day a group has an address of its own
-- ---------------------------------------------------------------------------
-- Rooms have carried `lat`/`lng` since V13 and most seeded rooms fill them. Groups and seeker
-- posts have never had a per-row address to record: a group is a locality and a rent until its
-- search succeeds, and a seeker is a shortlist of localities by definition. So these columns are
-- added for the housed case (a group bound to a property can carry that property's point) and are
-- expected to be null on most rows for the foreseeable future.
--
-- That expectation is load-bearing, and it is why the radius filter must NOT require them. A
-- predicate that drops null coordinates does not exclude a few unlocatable rows here, it excludes
-- every group and every seeker post -- a whole supply type vanishing from a tab, reading as "there
-- is nothing near you" on a board that is full. `FlatmateSearchQueries.appendRadius` therefore
-- places a coordinate-less row at its locality's centroid from the `localities` reference table,
-- which is the same published datum the locality pages and the map already quote, and is what the
-- browser's version of this filter approximated from a hard-coded copy in the bundle.
--
-- Nullable, and null means "unknown", never zero. Coordinates near (0,0) are in the Gulf of
-- Guinea; a NOT NULL DEFAULT 0 here would put every group without an address 5,000km from anywhere
-- and quietly answer a question we cannot answer.
ALTER TABLE flatmate_groups
    ADD COLUMN lat double precision,
    ADD COLUMN lng double precision;

COMMENT ON COLUMN flatmate_groups.lat IS
    'Latitude of the group''s flat, null while the group has no address yet -- which is most of '
    'them. Null means unknown, never 0; radius search falls back to the locality centroid.';
COMMENT ON COLUMN flatmate_groups.lng IS
    'Longitude of the group''s flat, null while the group has no address yet. Null means unknown '
    'and is excluded from radius search rather than treated as 0.';

-- ---------------------------------------------------------------------------
-- Groups: the per-head price the board actually quotes
-- ---------------------------------------------------------------------------
-- `round(...)`, not integer division. `rent / seats_total` on bigint/integer truncates, which puts
-- the value up to a rupee below the number the card shows -- invisible everywhere except exactly at
-- a filter boundary, where a group priced at the user's ceiling would drop out of its own range.
-- The cast to numeric is what makes `round` available; both it and `round` are immutable, which is
-- what a generated column requires.
ALTER TABLE flatmate_groups
    ADD COLUMN per_head bigint
        GENERATED ALWAYS AS (round(rent::numeric / seats_total)::bigint) STORED;

COMMENT ON COLUMN flatmate_groups.per_head IS
    'What one member pays: round(rent / seats_total). Generated, so it can never drift from the '
    'two columns it summarises. This is the number budget filters compare against, not `rent`.';

CREATE INDEX idx_flatmate_groups_per_head ON flatmate_groups (per_head)
    WHERE archived = false;

-- ---------------------------------------------------------------------------
-- Habits, on all three supply types
-- ---------------------------------------------------------------------------
-- The habits facet is an AND over the chosen tags ("non-smoker AND early riser"), which is exactly
-- the jsonb containment operator: `tags @> '["non-smoker","early-riser"]'`. `jsonb_path_ops` is the
-- smaller and faster operator class and supports `@>`, which is the only operator these three
-- indexes have to serve -- matching the choice already made for `properties.tenants` in V04.
CREATE INDEX idx_flatmate_rooms_tags ON flatmate_rooms USING gin (tags jsonb_path_ops)
    WHERE archived = false;

CREATE INDEX idx_flatmate_groups_tags ON flatmate_groups USING gin (tags jsonb_path_ops)
    WHERE archived = false;

CREATE INDEX idx_flatmate_seeker_posts_tags ON flatmate_seeker_posts USING gin (tags jsonb_path_ops)
    WHERE archived = false;

-- ---------------------------------------------------------------------------
-- Move-in date
-- ---------------------------------------------------------------------------
-- The facet asks "available within N days", which is a range scan on a date. Both columns already
-- exist and neither was indexed, because until now nothing queried them -- the browser read the
-- legacy free-text `move_in` and parsed three different dialects out of it ('now', a bucket name,
-- or an ISO date). The server narrows on the real date column and leaves the text alone.
--
-- Partial on the same predicate as the feed indexes: a row that is archived or unmoderated is never
-- in a search result, so it has no business in the index that serves one.
CREATE INDEX idx_flatmate_rooms_available_from ON flatmate_rooms (available_from)
    WHERE archived = false AND mod_status IN ('live','approved');

CREATE INDEX idx_flatmate_seeker_posts_move_in_at ON flatmate_seeker_posts (move_in_at)
    WHERE archived = false AND mod_status IN ('live','approved');

-- ---------------------------------------------------------------------------
-- Seeker posts: the facets rooms and groups already had indexed
-- ---------------------------------------------------------------------------
-- `idx_flatmate_seeker_posts_budget` from V13 is unpartitioned, so it carries archived rows the
-- feed can never return. Left alone rather than replaced -- it serves the admin board, which does
-- want them.
CREATE INDEX idx_flatmate_seeker_posts_gender ON flatmate_seeker_posts (gender)
    WHERE archived = false AND mod_status IN ('live','approved');

CREATE INDEX idx_flatmate_rooms_gender ON flatmate_rooms (gender)
    WHERE archived = false AND mod_status IN ('live','approved');
