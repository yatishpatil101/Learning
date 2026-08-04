-- V19 — the owner<->ops clarification thread needs somewhere to record "seen".
--
-- `POST /properties/{id}/verification/read` has been in the contract since the first draft and had
-- nothing to write to: `review_messages` (V5) carries id, review_id, sender_id, body, created_at and
-- no read state whatsoever. The endpoint could only ever have been a 204 that did nothing, which is
-- worse than a missing endpoint because the UI would show an unread badge that never cleared.
--
-- Per-message rather than a per-thread high-water mark: the frontend mock
-- (lib/data/properties-admin.js#markReviewRead) tracks `read` on each message, and the admin queue
-- counts unread messages rather than testing a timestamp. A high-water mark would be smaller but
-- could not answer "which messages are new", which is the only question the UI asks.
--
-- Nullable, not `NOT NULL DEFAULT false`: null means "not yet read" and carries no false precision,
-- and when it is set it records *when*, which a boolean throws away. Existing rows are correctly
-- unread under this reading, so no backfill is needed.
ALTER TABLE review_messages ADD COLUMN read_at timestamptz;

-- Reading the thread is the common query and it is always scoped to one review, ordered oldest-first
-- (a conversation reads forwards). Without this the thread page is a scan of every message on the
-- platform filtered down to one review.
CREATE INDEX idx_review_messages_review_at ON review_messages (review_id, created_at);

-- The unread count the ops queue renders. Partial, because a read message can never contribute to it
-- and there is no reason to carry the whole history in the index.
CREATE INDEX idx_review_messages_unread ON review_messages (review_id) WHERE read_at IS NULL;

COMMENT ON COLUMN review_messages.read_at IS
  'When the *other* participant read this message; null = unread. Set by POST /properties/{id}/verification/read.';
