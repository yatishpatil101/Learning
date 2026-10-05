-- consent_language: which translation of the notice the user saw (DPDP Act 2023 s.5(3)).
-- claimed_*: one reviewer works a case at a time; the service treats a claim older than 30 min as free.
-- qa_*: a sample of approvals gets a second look by a different staff member (maker-checker).
ALTER TABLE identity_verifications
    ADD COLUMN consent_language text CHECK (consent_language IN ('en','hi','mr')),
    ADD COLUMN claimed_by       uuid REFERENCES users(id),
    ADD COLUMN claimed_at       timestamptz,
    ADD COLUMN qa_sampled_at    timestamptz,
    ADD COLUMN qa_reviewed_by   uuid REFERENCES users(id),
    ADD COLUMN qa_reviewed_at   timestamptz,
    ADD COLUMN qa_outcome       text CHECK (qa_outcome IN ('confirmed','revoked')),
    ADD CONSTRAINT identity_verifications_claim_is_whole
        CHECK ((claimed_by IS NULL) = (claimed_at IS NULL)),
    ADD CONSTRAINT identity_verifications_qa_is_whole
        CHECK ((qa_reviewed_by IS NULL) = (qa_reviewed_at IS NULL)
               AND (qa_reviewed_at IS NULL) = (qa_outcome IS NULL)),
    ADD CONSTRAINT identity_verifications_qa_needs_sample
        CHECK (qa_reviewed_at IS NULL OR qa_sampled_at IS NOT NULL),
    ADD CONSTRAINT identity_verifications_qa_checker_is_not_maker
        CHECK (qa_reviewed_by IS NULL OR reviewer_id IS NULL OR qa_reviewed_by <> reviewer_id),
    ADD CONSTRAINT identity_verifications_qa_checker_is_not_subject
        CHECK (qa_reviewed_by IS NULL OR qa_reviewed_by <> user_id);

CREATE INDEX idx_identity_verifications_qa_open ON identity_verifications (qa_sampled_at)
    WHERE qa_sampled_at IS NOT NULL AND qa_reviewed_at IS NULL;
