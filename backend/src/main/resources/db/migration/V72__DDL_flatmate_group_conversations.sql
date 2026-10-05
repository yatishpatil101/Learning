-- A conversation is either a pair (user_a_id < user_b_id) or one flatmate group's thread. A group
-- thread stores no participants: they are the group's current members, read live, so leaving or
-- being removed ends access with nothing to keep in sync.
ALTER TABLE conversations
    ALTER COLUMN user_a_id DROP NOT NULL,
    ALTER COLUMN user_b_id DROP NOT NULL,
    ADD COLUMN flatmate_group_id uuid UNIQUE REFERENCES flatmate_groups (id),
    DROP CONSTRAINT conversations_pair_ordered,
    ADD CONSTRAINT conversations_shape CHECK (
        (flatmate_group_id IS NULL
            AND user_a_id IS NOT NULL AND user_b_id IS NOT NULL AND user_a_id < user_b_id)
        OR (flatmate_group_id IS NOT NULL
            AND user_a_id IS NULL AND user_b_id IS NULL AND property_id IS NULL));

-- messages.read has one reader per message, which a group does not. Group unread is instead every
-- message by someone else newer than the reader's cursor.
CREATE TABLE conversation_reads (
    conversation_id uuid        NOT NULL REFERENCES conversations (id),
    user_id         uuid        NOT NULL REFERENCES users (id),
    read_at         timestamptz NOT NULL,
    PRIMARY KEY (conversation_id, user_id)
);
