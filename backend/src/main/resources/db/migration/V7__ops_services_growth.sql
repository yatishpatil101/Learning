-- V7 Ops, Services, Growth & Moderation (Phase 6). Internal ops surface + secondary marketplaces.
-- Schemas: Ticket(Create/Update), ServiceRequest(Create), Referral, Review(Create), Report(Create),
--          ShareFlatPost(Create), SocietyLead(Create).

-- tickets: team-scoped ops work item. requester/assignee resolve to users (nullable: ops may
-- create on behalf of a guest lead, so customer/mobile are also denormalized).
CREATE TABLE tickets (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    subject      text NOT NULL,
    team         text CHECK (team IN ('rental','legal','loans','interior','packers','valuation')),
    priority     text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
    status       text NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','in-progress','waiting','resolved','closed')),
    property_id  uuid REFERENCES properties(id),
    requester_id uuid REFERENCES users(id),
    assignee_id  uuid REFERENCES users(id),
    service      text,
    customer     text,
    mobile       text CHECK (mobile ~ '^[6-9][0-9]{9}$'),
    value        bigint,
    detail       text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tickets_team_status ON tickets (team, status);
CREATE INDEX idx_tickets_assignee    ON tickets (assignee_id);

-- Internal staff notes on a ticket (Ticket.notes[]). Never deleted -- audit trail.
CREATE TABLE ticket_notes (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id uuid NOT NULL REFERENCES tickets(id),
    by        text,
    text      text NOT NULL,
    at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ticket_notes_ticket ON ticket_notes (ticket_id, at);

-- service_requests: staff-driven draft/decision workflow (rent agreement, valuation, ...).
CREATE TABLE service_requests (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_id uuid REFERENCES users(id),
    type         text NOT NULL,
    status       text NOT NULL DEFAULT 'new'
                   CHECK (status IN ('new','assigned','in-progress','draft-shared','approved','completed','cancelled')),
    property_id  uuid REFERENCES properties(id),
    assignee_id  uuid REFERENCES users(id),
    details      text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_service_requests_status ON service_requests (status);

CREATE TABLE service_request_timeline (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id uuid NOT NULL REFERENCES service_requests(id),
    at         timestamptz NOT NULL DEFAULT now(),
    event      text NOT NULL,
    by         text
);
CREATE INDEX idx_service_timeline_request ON service_request_timeline (request_id, at);

-- ServiceRequest.documents[] : a document may belong to a service request instead of a property.
ALTER TABLE documents ADD COLUMN service_request_id uuid REFERENCES service_requests(id);
CREATE INDEX idx_documents_service_request ON documents (service_request_id) WHERE service_request_id IS NOT NULL;

-- referrals: fraud-review queue (schema: Referral). referred is often not yet a user -> mobile text;
-- referrer is a registered user -> FK, with denormalized mobile for the ops view.
CREATE TABLE referrals (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_id      uuid REFERENCES users(id),
    referrer_mobile  text CHECK (referrer_mobile ~ '^[6-9][0-9]{9}$'),
    referred         text,
    referred_mobile  text CHECK (referred_mobile ~ '^[6-9][0-9]{9}$'),
    channel          text CHECK (channel IN ('seeker','owner')),
    reward           text,
    status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','qualified','rewarded','rejected')),
    risk             text CHECK (risk IN ('low','medium','high')),
    aadhaar_verified boolean NOT NULL DEFAULT false,
    aadhaar_unique   boolean NOT NULL DEFAULT false,
    same_device      boolean NOT NULL DEFAULT false,
    same_ip          boolean NOT NULL DEFAULT false,
    velocity_high    boolean NOT NULL DEFAULT false,
    activated        boolean NOT NULL DEFAULT false,
    at               timestamptz NOT NULL DEFAULT now(),
    handled_by       text,
    handled_at       timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_referrals_referrer ON referrals (referrer_id);
CREATE INDEX idx_referrals_status   ON referrals (status);

-- reviews: unified polymorphic model (reconciliation #6). target_id is polymorphic (no FK);
-- status carries moderation state (implied by admin moderation feed; not exposed on the Review DTO).
CREATE TABLE reviews (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    target_type text NOT NULL CHECK (target_type IN ('property','locality','society','owner')),
    target_id   text NOT NULL,
    author_id   uuid REFERENCES users(id),
    rating      integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
    title       text,
    body        text,
    status      text NOT NULL DEFAULT 'published' CHECK (status IN ('pending','published','rejected')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_reviews_target ON reviews (target_type, target_id);

-- reports: trust & safety (schema: Report). reason kept free-text; a canonical reason enum is
-- deferred (reconciliation #7) -- add a CHECK in a later V* once the vocabulary is frozen.
CREATE TABLE reports (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    target_type text NOT NULL CHECK (target_type IN ('property','user','review','post')),
    target_id   text NOT NULL,
    reporter_id uuid REFERENCES users(id),
    reason      text NOT NULL,
    details     text,
    status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewing','actioned','dismissed')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_reports_target ON reports (target_type, target_id);
CREATE INDEX idx_reports_status ON reports (status);

-- share_flat_posts: flatmate/rooms secondary marketplace (schema: ShareFlatPost). Preferences
-- flattened to columns (queryable filters).
CREATE TABLE share_flat_posts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    poster_id       uuid NOT NULL REFERENCES users(id),
    title           text NOT NULL,
    locality        text NOT NULL,
    rent_share      bigint NOT NULL,
    available_from  date,
    pref_gender     text CHECK (pref_gender IN ('any','male','female')),
    pref_food       text CHECK (pref_food IN ('any','veg','non-veg')),
    pref_occupation text,
    archived        boolean NOT NULL DEFAULT false,
    archived_at     timestamptz,
    archive_reason  text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_share_flat_locality ON share_flat_posts (locality) WHERE archived = false;

-- society_leads: B2B society/builder lead capture (schema: SocietyLead). Lead contact is not a user.
CREATE TABLE society_leads (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    society_name text NOT NULL,
    contact_name text NOT NULL,
    mobile       text NOT NULL CHECK (mobile ~ '^[6-9][0-9]{9}$'),
    units        integer,
    interest     text CHECK (interest IN ('bulk-listing','society-services','partnership')),
    status       text NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','qualified','won','lost')),
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_society_leads_status ON society_leads (status);

SELECT install_updated_at_triggers();
