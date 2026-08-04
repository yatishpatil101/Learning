-- V22 Conversations and support (slice 12). The tables have existed since V4/V8; this makes them
-- serviceable and retires one that never was.

-- ---------------------------------------------------------------------------
-- 1. Retire `enquiries`.
-- ---------------------------------------------------------------------------
-- The pre-ADR-019 name for a contact request. `GET /enquiries` was declared, marked DEPRECATED and
-- never implemented; the contact-request surface replaced it before either shipped, and no code
-- path in the platform has ever inserted a row here. Spec fix S45 removed the operation, so the
-- table is now unreachable by any endpoint and unwritten by any service.
--
-- Guarded rather than dropped outright. If some environment does hold rows, this migration fails
-- loudly instead of deleting leads: a failed deploy is recoverable, a dropped table of customer
-- enquiries is not. Nothing can write the table, so the guard should never fire.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM enquiries) THEN
        RAISE EXCEPTION
            'enquiries is not empty (% rows). V22 expected it unused - migrate the data to '
            'contact_requests before re-running.', (SELECT count(*) FROM enquiries);
    END IF;
END $$;

DROP TABLE enquiries;

-- ---------------------------------------------------------------------------
-- 2. A conversation between two people is one row, whichever of them started it.
-- ---------------------------------------------------------------------------
-- V4 stored an unordered pair, so (A,B) and (B,A) are the same conversation but two different
-- rows, and nothing stopped both existing. Two threads for one relationship is the worst possible
-- failure here: each party replies into their own copy and neither sees the other's messages.
--
-- Fixed by canonicalising the pair -- user_a is always the lower uuid -- which turns "is there
-- already a conversation between these two about this listing?" into an index lookup instead of an
-- OR across both columns. The CHECK is what makes the unique indexes below actually mean it;
-- without it the application could insert the flipped pair and the index would allow it.
-- IF EXISTS, not a bare DROP: the V4 constraint was unnamed, so its name is Postgres's own
-- derivation. If that name ever differs the weaker constraint simply stays, which is harmless next
-- to the strict one below -- whereas a failed DROP would block the deploy over a naming detail.
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_pair_ordered CHECK (user_a_id < user_b_id);

-- Two indexes, not one, because Postgres treats NULLs as distinct in a unique index: a single
-- index over (user_a, user_b, property_id) would happily accept any number of general
-- (property-less) conversations between the same pair. `NULLS NOT DISTINCT` would do it in one,
-- but it is PG15+ and this schema does not otherwise require it.
CREATE UNIQUE INDEX uq_conversations_pair_property
    ON conversations (user_a_id, user_b_id, property_id) WHERE property_id IS NOT NULL;
CREATE UNIQUE INDEX uq_conversations_pair_general
    ON conversations (user_a_id, user_b_id) WHERE property_id IS NULL;

-- The inbox is "my conversations, most recent first", and the caller may be on either side of the
-- pair. V4's single-column indexes served the membership test but left the sort to a heap sort of
-- everything the user has ever talked about.
DROP INDEX IF EXISTS idx_conversations_user_a;
DROP INDEX IF EXISTS idx_conversations_user_b;
CREATE INDEX idx_conversations_a_recent ON conversations (user_a_id, updated_at DESC);
CREATE INDEX idx_conversations_b_recent ON conversations (user_b_id, updated_at DESC);

-- The unread badge counts messages the caller did not write and has not read. Partial, because
-- read messages are the overwhelming majority within days and none of them can ever match.
CREATE INDEX idx_messages_unread ON messages (conversation_id, author_id) WHERE read = false;

-- ---------------------------------------------------------------------------
-- 3. Support tickets.
-- ---------------------------------------------------------------------------
-- GET /support/tickets is the caller's own, newest first (spec fix S47). V8 indexed only user_id.
DROP INDEX IF EXISTS idx_support_tickets_user;
CREATE INDEX idx_support_tickets_user_created ON support_tickets (user_id, created_at DESC);
