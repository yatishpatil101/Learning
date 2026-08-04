-- V16: what a review has to carry before it can be trusted (slice 8, Engagement).
--
-- The `reviews` table has existed since V7, but it was modelled from the contract, and the
-- contract was missing three things the property page has always rendered: the
-- "Verified resident" / "Visited" badge, five per-aspect sub-ratings, and a recommend flag.
-- Spec fix S26 corrected the contract first; this migration makes the schema able to hold it.
--
-- It also adds the constraint that makes a rating average mean anything.

-- ---------------------------------------------------------------------------
-- The three columns behind spec fix S26
-- ---------------------------------------------------------------------------
--
-- `context` is the anti-fake-review badge. It is written by the server from the author's
-- visit/tenancy history and never accepted from the client -- a client-settable badge would be
-- forgeable by anyone able to POST, which is the whole population.
--
-- It is stored rather than derived at read time on purpose. A review is a historical statement:
-- when a tenancy ends, the person was still a resident when they wrote it, and re-deriving would
-- silently downgrade their badge and drop the review out of the UI's "Residents" filter. Nullable
-- because society / locality / owner reviews have no visit or tenancy to speak of.
ALTER TABLE reviews
    ADD COLUMN context text CHECK (context IN ('visit', 'tenant'));

COMMENT ON COLUMN reviews.context IS
    'Server-derived reviewer standing: tenant | visit. Never accepted from the client (S26).';

-- Five named sub-ratings, sparse -- the UI reads them as an optional map (r.categories?.[k]) and
-- shows only the keys present, so a row of five NOT NULL columns would misrepresent "not answered"
-- as a rating. JSONB matches both the shape and the house precedent (saved_searches.filters, the
-- property arrays). The key set is closed and validated in the service against the same vocabulary
-- constant the contract declares, so this cannot decay into a junk drawer.
ALTER TABLE reviews
    ADD COLUMN categories jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN reviews.categories IS
    'Sparse per-aspect sub-ratings 1-5. Closed key set: locality, condition, value, owner, accuracy.';

-- Nullable, and that is the point: the UI distinguishes "did not say" from "would not recommend"
-- (r.recommend != null). A NOT NULL DEFAULT false would answer a question nobody asked.
ALTER TABLE reviews
    ADD COLUMN recommend boolean;

COMMENT ON COLUMN reviews.recommend IS
    'Would recommend. NULL means not answered, which is not the same as false.';

-- ---------------------------------------------------------------------------
-- One review per author per target
-- ---------------------------------------------------------------------------
--
-- Nothing stopped one account posting fifty reviews on one property and moving its average
-- wherever it liked. The service will check first so the common case gets a clean 422, but the
-- check alone is racy -- two concurrent submissions both pass it before either commits. This is
-- the slice-3 / V9 lesson: if a rule matters, the database has to be the one enforcing it.
--
-- Partial on author_id IS NOT NULL because the column is nullable (seeded and legacy rows carry no
-- author) and NULLs would not collide anyway; writing it down makes the intent explicit rather
-- than incidental.
CREATE UNIQUE INDEX idx_reviews_author_target
    ON reviews (author_id, target_type, target_id)
    WHERE author_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Index for the paged entity-review read (spec fix S27)
-- ---------------------------------------------------------------------------
--
-- idx_reviews_target (target_type, target_id) from V7 answers the filter but not the ordering, so
-- a paged newest-first read would sort every matching row per page. api-standards.md §5 requires
-- every sort be index-backed; extending the existing key with created_at DESC does that, and makes
-- the V7 index redundant as a prefix of this one.
DROP INDEX idx_reviews_target;
CREATE INDEX idx_reviews_target_created
    ON reviews (target_type, target_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Index for the paged notification read (spec fix S27)
-- ---------------------------------------------------------------------------
--
-- V8 shipped idx_notifications_user (user_id, read, created_at DESC), which serves "my unread,
-- newest first". The list endpoint asks a different question -- "mine, newest first", with no
-- predicate on `read` -- and `read` sits in the middle of that key, so Postgres can use the
-- user_id prefix to find the rows but must then sort every one of them to order them. That is a
-- full sort per page for exactly the users who have the most notifications.
--
-- api-standards.md §5 requires every sort be index-backed, so the read gets its own key. Both
-- indexes stay: they answer different questions and neither is a prefix of the other.
CREATE INDEX idx_notifications_user_created
    ON notifications (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Length bounds mirroring the DTO annotations
-- ---------------------------------------------------------------------------
--
-- Bean Validation runs only on the path that happens to carry the annotation; the column is the
-- bound that holds for every path, now and after whatever gets added later. Values chosen to match
-- the DTOs so the two cannot drift silently.
ALTER TABLE reviews
    ADD CONSTRAINT reviews_title_len_check CHECK (title IS NULL OR length(title) <= 160),  -- mirrors @Size(max=160)
    ADD CONSTRAINT reviews_body_len_check  CHECK (body  IS NULL OR length(body)  <= 4000); -- mirrors @Size(max=4000)
