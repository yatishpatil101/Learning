ALTER TABLE messages
    ADD COLUMN client_id text,
    ADD COLUMN reply_to_id uuid REFERENCES messages(id);

CREATE UNIQUE INDEX uq_messages_client_id
    ON messages (conversation_id, author_id, client_id)
    WHERE client_id IS NOT NULL;

CREATE INDEX idx_messages_reply_to ON messages (reply_to_id);

CREATE TABLE conversation_user_state (
    conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    archived        boolean NOT NULL DEFAULT false,
    muted           boolean NOT NULL DEFAULT false,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX idx_conversation_user_state_user
    ON conversation_user_state (user_id, muted, archived);

CREATE TABLE hidden_conversation_messages (
    conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    message_id      uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, user_id)
);

CREATE INDEX idx_hidden_conversation_messages_thread
    ON hidden_conversation_messages (conversation_id, user_id);

CREATE TABLE user_blocks (
    blocker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker_id, blocked_id),
    CONSTRAINT ck_user_blocks_not_self CHECK (blocker_id <> blocked_id)
);
