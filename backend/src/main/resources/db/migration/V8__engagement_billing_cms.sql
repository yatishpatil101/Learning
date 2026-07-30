-- V8 Engagement, Billing, CMS & Support (Phase 7). The consumer layer on top of everything.
-- Schemas: SavedSearch(Create), Plan, Subscription(SubscribeRequest), BoostPack, Boost,
--          ServiceOffering, ServiceOrder(Create), SupportTicket(Create), Notification,
--          Announcement, CmsService, Faq, Banner.

CREATE TABLE saved_properties (
    user_id     uuid NOT NULL REFERENCES users(id),
    property_id uuid NOT NULL REFERENCES properties(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, property_id)
);

-- saved_searches: alerting. filters as JSONB (structured) alongside the URL query string.
CREATE TABLE saved_searches (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users(id),
    name            text,
    query           text NOT NULL,
    filters         jsonb NOT NULL DEFAULT '{}'::jsonb,
    alert_frequency text NOT NULL DEFAULT 'daily' CHECK (alert_frequency IN ('off','instant','daily','weekly')),
    channel         text NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp','email','push')),
    new_count       integer NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_saved_searches_user ON saved_searches (user_id);

-- Billing & Growth
CREATE TABLE plans (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name          text NOT NULL,
    audience      text CHECK (audience IN ('owner','tenant','buyer','agent')),
    price         bigint NOT NULL DEFAULT 0,
    billing_cycle text CHECK (billing_cycle IN ('monthly','quarterly','yearly')),
    features      jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users(id),
    plan_id    uuid NOT NULL REFERENCES plans(id),
    status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active','past-due','cancelled','expired')),
    started_at timestamptz NOT NULL DEFAULT now(),
    renews_at  timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_subscriptions_user ON subscriptions (user_id);

CREATE TABLE boost_packs (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name          text NOT NULL,
    price         bigint NOT NULL DEFAULT 0,
    duration_days integer,
    placement     text CHECK (placement IN ('top','featured','homepage')),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE boosts (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id uuid NOT NULL REFERENCES properties(id),
    pack_id     uuid NOT NULL REFERENCES boost_packs(id),
    starts_at   timestamptz,
    ends_at     timestamptz,
    status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_boosts_property ON boosts (property_id);

CREATE TABLE service_offerings (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name           text NOT NULL,
    category       text,
    starting_price bigint,
    description    text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE service_orders (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    offering_id   uuid NOT NULL REFERENCES service_offerings(id),
    user_id       uuid NOT NULL REFERENCES users(id),
    property_id   uuid REFERENCES properties(id),
    status        text NOT NULL DEFAULT 'placed'
                    CHECK (status IN ('placed','scheduled','in-progress','completed','cancelled')),
    amount        bigint,
    scheduled_for timestamptz,
    notes         text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_service_orders_user ON service_orders (user_id);

-- support_tickets: consumer support, per-user (distinct from ops Ticket).
CREATE TABLE support_tickets (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users(id),
    subject    text NOT NULL,
    category   text,
    status     text NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','in-progress','waiting','resolved','closed')),
    unread     boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_support_tickets_user ON support_tickets (user_id);

CREATE TABLE support_ticket_messages (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id   uuid NOT NULL REFERENCES support_tickets(id),
    author_id   uuid REFERENCES users(id),
    author_role text CHECK (author_role IN ('buyer','owner','staff','admin')),
    body        text NOT NULL,
    attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_support_ticket_messages_ticket ON support_ticket_messages (ticket_id, created_at);

-- notifications: per-user, server-generated as a side-effect of approvals/state changes.
CREATE TABLE notifications (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL REFERENCES users(id),
    type       text,
    title      text,
    body       text,
    read       boolean NOT NULL DEFAULT false,
    link       text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user ON notifications (user_id, read, created_at DESC);

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
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

SELECT install_updated_at_triggers();
