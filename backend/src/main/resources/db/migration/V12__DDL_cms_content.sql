-- V12 DDL CMS Content: the copy an editor writes and a visitor reads, and the reviews visitors
-- leave in return.
--
-- Scope: `announcements`, `cms_services`, `faqs` and `banners` -- the four admin-editable content
-- tables behind the public site's notices, services strip, help page and hero slots -- plus
-- `reviews`, the unified polymorphic review table behind the rating and badge shown on a property,
-- locality, society or owner.
--
-- Folded from the old chain: V7 (the `reviews` table and its index only -- V7's tickets /
-- service_requests / reports / referrals / documents statements belong to other files), V8 (the
-- four CMS tables only -- V8's engagement, billing, support and notifications tables live in the
-- engagement file), V16 (the `reviews` parts only -- its notifications index belongs to the
-- engagement file), V18 (the review-takedown finding only -- its reports / users / audit_log
-- indexes belong to the service-requests and identity files), V84 (translations, which land on all
-- four content tables).
--
-- `users` is created by an earlier file; `reviews.author_id` carries a foreign key to it.

-- ---------------------------------------------------------------------------
-- Translations on the four content tables (D2)
-- ---------------------------------------------------------------------------
--
-- The help page already localises FAQs. `lib/contentLang.js` reads suffixed fields off the record --
-- `q_mr`, `a_mr`, `q_hi` -- because a FAQ is written by an editor at runtime and therefore cannot
-- live in a locale bundle with the rest of the UI copy. The server has no such fields, so moving
-- the page onto `GET /faqs` would have looked fine (nothing is translated today) and then silently
-- regressed the first time somebody wrote a Marathi answer.
--
-- Nested, not suffixed. The alternative -- question_mr, answer_mr, category_mr, and the same three
-- again in Hindi -- is six columns on this table and eighteen more across the other three, and a
-- fourth language is another twelve. It also spreads one fact (this row, in Marathi) across three
-- columns that nothing constrains to agree: a row can have a Marathi question and an English answer
-- and the schema cannot tell you that happened. A single jsonb object keyed by language holds the
-- translation as the thing it is, and adding Hindi is data rather than DDL.
--
-- The shape is language -> field name -> text:
--
--   {"mr": {"question": "...", "answer": "...", "category": "..."}}
--
-- Field names inside are the *wire* names, not the column names, because the client is what reads
-- them and the client speaks the contract. For the four content types those happen to coincide.
--
-- No CHECK on the inner shape. Postgres could enforce that the value is an object, but not that its
-- keys are known languages or that its leaves are strings, so a partial check would buy the
-- appearance of validation while leaving the parts that actually go wrong unguarded. The Java side
-- types it as Map<String, Map<String, String>> and Jackson refuses anything else on the way in,
-- which is the real gate; `not null default '{}'` is here so a reader never has to distinguish
-- "no translations" from "column absent".
--
-- All four tables together, deliberately. Announcements, banners and services are the same kind of
-- object -- copy an editor writes and a visitor reads -- and answering the question once for FAQs
-- and again later for the others is how a codebase ends up with two conventions for one problem.

-- ---------------------------------------------------------------------------
-- No list indexes on the four content tables
-- ---------------------------------------------------------------------------
--
-- Deliberately NOT indexed: announcements, banners, cms_services and faqs. Those are
-- editor-curated tables of a few dozen rows whose entire contents are read on every call; the
-- planner would ignore an index in favour of a sequential scan, so adding one would be cost
-- without benefit. They are bounded by an editor's patience, not by user growth -- which is the
-- distinction that matters here. (The per-user engagement lists next door, which do grow without
-- bound, each carry a key for their sort; see the engagement file.)

-- CMS content (soft-deletable). Announcement carries a live window; add active for admin toggling.
CREATE TABLE announcements (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title          text NOT NULL,
    body           text,
    severity       text CHECK (severity IN ('info','success','warning')),
    starts_at      timestamptz,
    ends_at        timestamptz,
    active         boolean NOT NULL DEFAULT true,
    archived       boolean NOT NULL DEFAULT false,
    archived_at    timestamptz,
    archive_reason text,
    translations   jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cms_services (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name           text NOT NULL,
    icon           text,
    description    text,
    link           text,
    archived       boolean NOT NULL DEFAULT false,
    archived_at    timestamptz,
    archive_reason text,
    translations   jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE faqs (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    question       text NOT NULL,
    answer         text,
    category       text,
    archived       boolean NOT NULL DEFAULT false,
    archived_at    timestamptz,
    archive_reason text,
    translations   jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE banners (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    image          text,
    link           text,
    headline       text,
    position       integer NOT NULL DEFAULT 0,
    archived       boolean NOT NULL DEFAULT false,
    archived_at    timestamptz,
    archive_reason text,
    translations   jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- reviews: what a review has to carry before it can be trusted (slice 8, Engagement)
-- ---------------------------------------------------------------------------
--
-- Unified polymorphic model (reconciliation #6). target_id is polymorphic (no FK); status carries
-- moderation state (implied by admin moderation feed; not exposed on the Review DTO).
--
-- The table was first modelled from the contract, and the contract was missing three things the
-- property page has always rendered: the "Verified resident" / "Visited" badge, five per-aspect
-- sub-ratings, and a recommend flag. Spec fix S26 corrected the contract first; `context`,
-- `categories` and `recommend` below are the schema able to hold it.
--
-- The table also carries the constraint that makes a rating average mean anything -- see
-- idx_reviews_author_target.
--
-- The three columns behind spec fix S26
-- ------------------------------------
--
-- `context` is the anti-fake-review badge. It is written by the server from the author's
-- visit/tenancy history and never accepted from the client -- a client-settable badge would be
-- forgeable by anyone able to POST, which is the whole population.
--
-- It is stored rather than derived at read time on purpose. A review is a historical statement:
-- when a tenancy ends, the person was still a resident when they wrote it, and re-deriving would
-- silently downgrade their badge and drop the review out of the UI's "Residents" filter. Nullable
-- because society / locality / owner reviews have no visit or tenancy to speak of.
--
-- `categories` holds five named sub-ratings, sparse -- the UI reads them as an optional map
-- (r.categories?.[k]) and shows only the keys present, so a row of five NOT NULL columns would
-- misrepresent "not answered" as a rating. JSONB matches both the shape and the house precedent
-- (saved_searches.filters, the property arrays). The key set is closed and validated in the service
-- against the same vocabulary constant the contract declares, so this cannot decay into a junk
-- drawer.
--
-- `recommend` is nullable, and that is the point: the UI distinguishes "did not say" from "would
-- not recommend" (r.recommend != null). A NOT NULL DEFAULT false would answer a question nobody
-- asked.
--
-- Length bounds mirroring the DTO annotations
-- -------------------------------------------
--
-- Bean Validation runs only on the path that happens to carry the annotation; the column is the
-- bound that holds for every path, now and after whatever gets added later. Values chosen to match
-- the DTOs so the two cannot drift silently.
--
-- Review takedown: no column needed
-- ---------------------------------
--
-- Slice 8 recorded that `reviews` lacked an `archived` column and handed the takedown to the
-- moderation slice. Re-reading the schema, it does not need one. `reviews.status` already carries
-- moderation state ('pending','published','rejected') and *every* read filters status =
-- 'published' -- including ReviewRepository.aggregateFor, which computes the rating average.
-- Setting a review to 'rejected' therefore already removes it from both the public list and the
-- score it contributed to, which is exactly the invariant the takedown has to satisfy.
--
-- Adding an `archived` boolean beside it would create two columns expressing one concept, and a
-- second way for a row to be invisible that the aggregate query does not know about. Recorded
-- here so the deferred item is closed by reasoning rather than left looking forgotten.
CREATE TABLE reviews (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    target_type text NOT NULL CHECK (target_type IN ('property','locality','society','owner')),
    target_id   text NOT NULL,
    author_id   uuid REFERENCES users(id),
    rating      integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
    title       text,
    body        text,
    status      text NOT NULL DEFAULT 'published' CHECK (status IN ('pending','published','rejected')),
    context     text CHECK (context IN ('visit', 'tenant')),
    categories  jsonb NOT NULL DEFAULT '{}'::jsonb,
    recommend   boolean,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT reviews_title_len_check CHECK (title IS NULL OR length(title) <= 160),  -- mirrors @Size(max=160)
    CONSTRAINT reviews_body_len_check  CHECK (body  IS NULL OR length(body)  <= 4000)  -- mirrors @Size(max=4000)
);

COMMENT ON COLUMN reviews.context IS
    'Server-derived reviewer standing: tenant | visit. Never accepted from the client (S26).';

COMMENT ON COLUMN reviews.categories IS
    'Sparse per-aspect sub-ratings 1-5. Closed key set: locality, condition, value, owner, accuracy.';

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
-- A bare (target_type, target_id) key answers the filter but not the ordering, so a paged
-- newest-first read would sort every matching row per page. api-standards.md §5 requires every sort
-- be index-backed; extending that key with created_at DESC does so, and makes the shorter
-- (target_type, target_id) index redundant as a prefix of this one -- which is why only this one
-- exists.
CREATE INDEX idx_reviews_target_created
    ON reviews (target_type, target_id, created_at DESC);

SELECT install_updated_at_triggers();
