-- V18: the indexes and constraints behind slice 9 (Trust & Safety / admin trust boundary).
--
-- No new tables. Every surface this slice implements already has one: `reports` and
-- `society_leads` from V7, `property_reviews` + `property_review_checklist` + `review_messages`
-- from V5, `users` from V2, `audit_log` from V1. What none of them has is an index that answers
-- the question the new endpoints actually ask, which is always some filter *plus* a newest-first
-- ordering. api-standards.md §5 requires every sort be index-backed, and the back-office reads are
-- exactly the ones that get slow first: they are unfiltered by user, so they scan the whole table.

-- ---------------------------------------------------------------------------
-- The abuse queue
-- ---------------------------------------------------------------------------
--
-- V7 shipped idx_reports_status (status) and idx_reports_target (target_type, target_id). Both
-- answer a filter and neither answers the ordering, so `GET /reports` -- "the open ones, newest
-- first" -- would find the matching rows by index and then sort every one of them, on every page.
--
-- The composite makes idx_reports_status redundant (it is a strict prefix of this key), so it is
-- dropped rather than left to be maintained on every write for nothing.
DROP INDEX idx_reports_status;
CREATE INDEX idx_reports_status_created ON reports (status, created_at DESC);

-- The unfiltered queue read ("everything, newest first") has no status predicate to lead with, so
-- the composite above cannot serve it.
CREATE INDEX idx_reports_created ON reports (created_at DESC);

-- One open report per person per target. Without this, a tap that double-fires -- or anyone who
-- wants to bury a listing -- files the same report N times and the queue is unworkable. Partial on
-- status so a person may legitimately report the same target again after an earlier report was
-- actioned or dismissed, and on reporter_id because it is nullable (anonymous reports do not
-- collide). This is the slice-3 / V9 lesson: a service-level check alone is racy, because two
-- concurrent submissions both pass it before either commits.
CREATE UNIQUE INDEX idx_reports_one_open_per_reporter
    ON reports (reporter_id, target_type, target_id)
    WHERE reporter_id IS NOT NULL AND status IN ('open', 'reviewing');

-- ---------------------------------------------------------------------------
-- The user directory
-- ---------------------------------------------------------------------------
--
-- V2 shipped idx_users_role (role) and idx_users_status (status) WHERE archived = false -- again
-- filters without an ordering. The directory is "live users, optionally of one role, newest
-- first", so both variants get a key whose trailing column is the sort.
--
-- Both are partial on archived = false: that is the default read, and excluding suspended accounts
-- from the index keeps it proportional to the live population rather than to everyone who ever
-- signed up. The `?archived=true` variant is an audit view, expected to be rare and small.
CREATE INDEX idx_users_created ON users (created_at DESC) WHERE archived = false;
CREATE INDEX idx_users_role_created ON users (role, created_at DESC) WHERE archived = false;

-- `q` is deliberately a PREFIX search, not a substring search.
--
-- A substring match ("%sharma%") cannot use a btree at all; serving it properly needs pg_trgm and
-- a GIN index. An internal ops lookup -- where the operator is reading a name or a number off a
-- support ticket and typing the start of it -- does not justify adding an extension to the
-- platform, and a seq-scan-per-keystroke on the users table certainly does not justify itself.
-- text_pattern_ops is what makes LIKE 'x%' index-usable regardless of the database's collation.
CREATE INDEX idx_users_name_prefix ON users (lower(name) text_pattern_ops);
CREATE INDEX idx_users_mobile_prefix ON users (mobile text_pattern_ops);

-- ---------------------------------------------------------------------------
-- The audit log
-- ---------------------------------------------------------------------------
--
-- V1 shipped idx_audit_log_at (at DESC), which serves the unfiltered newest-first read, and
-- idx_audit_log_entity (entity, entity_id) for "everything that happened to this row". The read
-- this slice adds also filters by actor and by entity type with the same ordering, so those two
-- combinations get keys of their own. idx_audit_log_entity stays: it answers a different question
-- (one specific row's history) and is not a prefix of the new key.
CREATE INDEX idx_audit_log_actor_at ON audit_log (actor, at DESC);
CREATE INDEX idx_audit_log_entity_at ON audit_log (entity, at DESC);

-- ---------------------------------------------------------------------------
-- Review takedown: no column needed
-- ---------------------------------------------------------------------------
--
-- Slice 8 recorded that `reviews` lacked an `archived` column and handed the takedown to this
-- slice. Re-reading the schema, it does not need one. `reviews.status` already carries moderation
-- state ('pending','published','rejected') and *every* read filters status = 'published' --
-- including ReviewRepository.aggregateFor, which computes the rating average. Setting a review to
-- 'rejected' therefore already removes it from both the public list and the score it contributed
-- to, which is exactly the invariant the takedown has to satisfy.
--
-- Adding an `archived` boolean beside it would create two columns expressing one concept, and a
-- second way for a row to be invisible that the aggregate query does not know about. Recorded
-- here so the deferred item is closed by reasoning rather than left looking forgotten.

-- ---------------------------------------------------------------------------
-- Report reasons: validated in the service, not by a CHECK
-- ---------------------------------------------------------------------------
--
-- V7 left reports.reason free-text with a note to "add a CHECK in a later V* once the vocabulary
-- is frozen". This is that later V*, and the answer is no.
--
-- The vocabulary is frozen, but it is three vocabularies, not one: the frontend's ReportModal
-- ships a different reason set per target type (listing / post / user), and they only partly
-- overlap -- 'pricing' is meaningful for a listing and meaningless for a person, 'impersonation'
-- the reverse. A single flat CHECK over the union would accept every nonsensical pairing while
-- looking like it validated something. The rule is genuinely "reason must be valid *for this
-- target type*", which is a two-column rule the service enforces against the same constants the
-- contract declares (ReportReasons). Unlike a uniqueness rule, a vocabulary check has no race for
-- the database to arbitrate, so there is nothing the CHECK would add beyond false assurance.
COMMENT ON COLUMN reports.reason IS
    'Per-target-type vocabulary, validated in ReportService against ReportReasons (V18). '
    'Deliberately no CHECK: the legal set depends on target_type, which one flat constraint cannot express.';
