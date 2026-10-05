CREATE TABLE property_verification_override_requests (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id   uuid        NOT NULL REFERENCES properties (id) ON DELETE CASCADE,
    requested_by  uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    action        text        NOT NULL CHECK (action IN ('approve','reverse_reject')),
    reason        text        NOT NULL CHECK (length(btrim(reason)) >= 10),
    status        text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved')),
    decided_by    uuid        REFERENCES users (id) ON DELETE RESTRICT,
    decided_at    timestamptz,
    decision_note text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT property_verification_override_checker_is_not_maker
        CHECK (decided_by IS NULL OR decided_by <> requested_by),
    CONSTRAINT property_verification_override_decision_is_whole
        CHECK ((status = 'pending') = (decided_by IS NULL AND decided_at IS NULL))
);

CREATE UNIQUE INDEX property_verification_override_one_pending
    ON property_verification_override_requests (property_id, action) WHERE status = 'pending';
CREATE INDEX idx_property_verification_override_queue
    ON property_verification_override_requests (status, created_at);
