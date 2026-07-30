-- V4 Leads, Contact, Visits & Messaging (Phase 3). Seekers connect to listings behind the
-- badge-not-gate model (ADR-019). Schemas: ContactRequest(Create), ContactStatus, Enquiry,
-- Visit(Create), Conversation(Create), Message(Create).
-- Party embeds resolve to user_id FKs (reconciliation #10). Contact masking is applied at the
-- API/mapper layer, not stored here -- the raw owner mobile lives on users, revealed only on grant.

-- contact_requests: maker(requester) -> checker(owner) approval for contact reveal.
CREATE TABLE contact_requests (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id  uuid NOT NULL REFERENCES properties(id),
    requester_id uuid NOT NULL REFERENCES users(id),
    status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined')),
    message      text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_contact_requests_property  ON contact_requests (property_id);
CREATE INDEX idx_contact_requests_requester ON contact_requests (requester_id);

-- enquiries: legacy pre-ADR-019 lead model (schema deprecated but retained for back-compat).
-- Thread lives in the generic messages table below (linked by conversation), so no child table here.
CREATE TABLE enquiries (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id  uuid NOT NULL REFERENCES properties(id),
    from_user_id uuid NOT NULL REFERENCES users(id),
    message      text,
    status       text NOT NULL DEFAULT 'new' CHECK (status IN ('new','replied','closed')),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_enquiries_property ON enquiries (property_id);

-- visits: maker(visitor) requests a slot -> checker(owner) confirms.
CREATE TABLE visits (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id uuid NOT NULL REFERENCES properties(id),
    visitor_id  uuid NOT NULL REFERENCES users(id),
    slot        timestamptz NOT NULL,
    mode        text NOT NULL DEFAULT 'in-person' CHECK (mode IN ('in-person','video')),
    status      text NOT NULL DEFAULT 'scheduled'
                  CHECK (status IN ('scheduled','confirmed','completed','cancelled','no-show')),
    note        text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_visits_property ON visits (property_id);
CREATE INDEX idx_visits_visitor  ON visits (visitor_id);

-- conversations: 1:1 chat thread between two users, optionally about a listing. counterparty /
-- unread are computed per-viewer at the API layer; here we store the symmetric participant pair.
CREATE TABLE conversations (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_a_id    uuid NOT NULL REFERENCES users(id),
    user_b_id    uuid NOT NULL REFERENCES users(id),
    property_id  uuid REFERENCES properties(id),
    last_message text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CHECK (user_a_id <> user_b_id)
);
CREATE INDEX idx_conversations_user_a ON conversations (user_a_id);
CREATE INDEX idx_conversations_user_b ON conversations (user_b_id);

CREATE TABLE messages (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES conversations(id),
    author_id       uuid NOT NULL REFERENCES users(id),
    author_role     text CHECK (author_role IN ('buyer','owner','staff','admin')),
    body            text NOT NULL,
    attachments     jsonb NOT NULL DEFAULT '[]'::jsonb,
    read            boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_conversation ON messages (conversation_id, created_at);

SELECT install_updated_at_triggers();
