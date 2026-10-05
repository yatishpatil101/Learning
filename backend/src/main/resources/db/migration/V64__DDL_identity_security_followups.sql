-- Storage deletes run after commit; a failed one stays queued here and a sweeper retries it, so
-- an erased or withdrawn identity image is never forgotten by a lost log line.
CREATE TABLE identity_storage_deletes (
    storage_key text        PRIMARY KEY,
    queued_at   timestamptz NOT NULL DEFAULT now(),
    attempts    integer     NOT NULL DEFAULT 0,
    last_error  text
);

-- The dedup 409 is recorded here, outside the rolled-back submit, so a dispute refers to a conflict
-- the server saw rather than taking a document number (which would make it an enumeration oracle).
CREATE TABLE identity_conflicts (
    id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    doc_type               text        NOT NULL,
    claimed_hash           text        NOT NULL,
    holder_verification_id uuid        REFERENCES identity_verifications(id) ON DELETE SET NULL,
    created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_identity_conflicts_user ON identity_conflicts (user_id, created_at DESC);

ALTER TABLE identity_verifications
    ADD CONSTRAINT identity_verifications_claimer_is_not_subject
        CHECK (claimed_by IS NULL OR claimed_by <> user_id),
    ADD CONSTRAINT identity_verifications_qa_sample_needs_decision
        CHECK (qa_sampled_at IS NULL OR status IN ('verified','revoked','withdrawn')),
    ADD CONSTRAINT identity_verifications_qa_revoke_matches_status
        CHECK (qa_outcome IS DISTINCT FROM 'revoked' OR status IN ('revoked','withdrawn')),
    ADD CONSTRAINT identity_verifications_qa_revoker_is_qa_checker
        CHECK (qa_outcome IS DISTINCT FROM 'revoked' OR status <> 'revoked'
               OR revoked_by = qa_reviewed_by);

CREATE UNIQUE INDEX uq_support_tickets_open_identity_dispute ON support_tickets (user_id)
    WHERE category = 'identity_dispute' AND status NOT IN ('resolved','closed');
