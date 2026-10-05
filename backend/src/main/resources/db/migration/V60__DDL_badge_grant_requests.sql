-- Maker-checker on the hand-granted Verified badge (the D200 two-key shape of staff_account_approvals).
-- One administrator proposes, a different one approves; neither may be the person receiving it.
-- Withdrawal stays single-signer: taking a badge away is the protective direction.
CREATE TABLE badge_grant_requests (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    requested_by  uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    reason        text        NOT NULL CHECK (length(btrim(reason)) >= 10),
    status        text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    decided_by    uuid        REFERENCES users (id) ON DELETE RESTRICT,
    decided_at    timestamptz,
    decision_note text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT badge_grant_requests_maker_is_not_subject CHECK (requested_by <> user_id),
    CONSTRAINT badge_grant_requests_checker_is_not_maker CHECK (decided_by IS NULL OR decided_by <> requested_by),
    CONSTRAINT badge_grant_requests_checker_is_not_subject CHECK (decided_by IS NULL OR decided_by <> user_id),
    CONSTRAINT badge_grant_requests_decision_is_whole
        CHECK ((status = 'pending') = (decided_by IS NULL AND decided_at IS NULL))
);

CREATE UNIQUE INDEX badge_grant_requests_one_pending_per_user
    ON badge_grant_requests (user_id) WHERE status = 'pending';
CREATE INDEX idx_badge_grant_requests_queue ON badge_grant_requests (status, created_at);
