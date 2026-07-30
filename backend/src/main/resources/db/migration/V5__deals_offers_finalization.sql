-- V5 Deals, Offers, Finalization & Property Verification (Phase 4). The transaction core.
-- Schemas: Offer(Create/Response), Deal(CloseRequest), FinalizationRequest(Create/Accept),
--          PropertyReview. All maker-checker; side-effects applied transactionally in services.

-- offers: buyer proposes; owner accepts/counters/declines. Negotiation trail -> offer_history.
CREATE TABLE offers (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id  uuid NOT NULL REFERENCES properties(id),
    from_user_id uuid NOT NULL REFERENCES users(id),   -- Party.from
    amount       bigint NOT NULL,
    status       text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','countered','accepted','declined','withdrawn')),
    message      text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_offers_property ON offers (property_id);
CREATE INDEX idx_offers_from     ON offers (from_user_id);

CREATE TABLE offer_history (
    id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    offer_id uuid NOT NULL REFERENCES offers(id),
    amount   bigint NOT NULL,
    by       text NOT NULL CHECK (by IN ('buyer','owner')),  -- counter direction
    at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_offer_history_offer ON offer_history (offer_id, at);

-- deals: single aggregate (reconciliation #4). status {active,reserved,closed}; the analytics
-- closed/in_progress+value view is derived, not a second table. counterparty is one Party -> FK.
-- (deal_parties child deferred: no multi-party deal in the contract -- add a V* migration if needed.)
CREATE TABLE deals (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id    uuid NOT NULL REFERENCES properties(id),
    deal           text NOT NULL CHECK (deal IN ('buy','rent')),
    counterparty_id uuid REFERENCES users(id),
    agreed_price   bigint,
    status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active','reserved','closed')),
    closed_at      timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_deals_property ON deals (property_id);
CREATE INDEX idx_deals_status   ON deals (status);

-- finalization_requests: buyer requests finalize -> owner accepts (closes deal, auto-declines
-- the property's other pending requests -- enforced in the service, transactionally).
CREATE TABLE finalization_requests (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id     uuid NOT NULL REFERENCES properties(id),
    initiator_id    uuid NOT NULL REFERENCES users(id),
    counterparty_id uuid NOT NULL REFERENCES users(id),
    agreed_price    bigint NOT NULL,
    status          text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','accepted','declined','cancelled')),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_finalization_property ON finalization_requests (property_id);

-- property_reviews: verification record, 1:1 with a property (schema: PropertyReview).
CREATE TABLE property_reviews (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id uuid NOT NULL UNIQUE REFERENCES properties(id),
    status      text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected','flagged','archived')),
    reviewer    text,
    notes       text,
    decided_at  timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Per-document verification checklist (PropertyReview.checklist[]).
CREATE TABLE property_review_checklist (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id uuid NOT NULL REFERENCES property_reviews(id),
    item      text NOT NULL,
    pass      boolean NOT NULL DEFAULT false
);
CREATE INDEX idx_review_checklist_review ON property_review_checklist (review_id);

-- owner<->admin clarification thread on a verification review.
CREATE TABLE review_messages (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    review_id  uuid NOT NULL REFERENCES property_reviews(id),
    sender_id  uuid REFERENCES users(id),
    body       text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_review_messages_review ON review_messages (review_id, created_at);

SELECT install_updated_at_triggers();
