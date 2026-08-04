-- V17 Index the two per-user engagement list reads (slice 8 review follow-up).
--
-- V16 fixed this same class of defect for `notifications`; a review pass over the rest of the
-- slice-8 read surface found two more of it. Both endpoints answer "mine, newest first" over a
-- table that grows without bound as a user uses the product, and in both cases the existing key
-- satisfies the WHERE but not the ORDER BY -- so Postgres finds the rows cheaply and then sorts
-- every one of them, on every request, for exactly the users who have the most rows.
--
-- api-standards.md §5: every sort must be index-backed.
--
-- Deliberately NOT indexed here: announcements, banners, cms_services and faqs. Those are
-- editor-curated tables of a few dozen rows whose entire contents are read on every call; the
-- planner would ignore an index in favour of a sequential scan, so adding one would be cost
-- without benefit. They are bounded by an editor's patience, not by user growth -- which is the
-- distinction that matters here.

-- ---------------------------------------------------------------------------
-- saved_searches: GET /me/saved-searches
-- ---------------------------------------------------------------------------
--
-- V8 shipped idx_saved_searches_user (user_id). The read is
-- `WHERE user_id = ? ORDER BY created_at DESC`, so the sort is unbacked. Extending the key makes
-- the V8 index a redundant prefix of this one.
DROP INDEX idx_saved_searches_user;
CREATE INDEX idx_saved_searches_user_created
    ON saved_searches (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- saved_properties: GET /me/saved
-- ---------------------------------------------------------------------------
--
-- The V8 primary key (user_id, property_id) answers both the membership check and the delete, but
-- the list read is `WHERE user_id = ? ORDER BY created_at DESC` -- created_at is not in the key at
-- all. The PK stays: it is the uniqueness constraint that makes the save idempotent, and it is the
-- key the ON CONFLICT DO NOTHING insert depends on.
CREATE INDEX idx_saved_properties_user_created
    ON saved_properties (user_id, created_at DESC);
