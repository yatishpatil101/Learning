ALTER TABLE users
    ADD COLUMN share_activity_status boolean NOT NULL DEFAULT true,
    ADD COLUMN share_read_receipts boolean NOT NULL DEFAULT true;

ALTER TABLE messages
    ADD COLUMN delivered_at timestamptz;

CREATE INDEX idx_messages_undelivered_pair
    ON messages (conversation_id, author_id)
    WHERE delivered_at IS NULL;
