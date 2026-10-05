-- A granted badge can now be withdrawn; before this the only way out of `verified` was SQL.
ALTER TABLE identity_verifications DROP CONSTRAINT identity_verifications_status_check;
ALTER TABLE identity_verifications ADD CONSTRAINT identity_verifications_status_check
    CHECK (status IN ('pending','verified','rejected','revoked'));

-- Passport for NRI owners, Voter ID (EPIC) for owners who hold neither PAN nor a licence.
ALTER TABLE identity_verifications DROP CONSTRAINT identity_verifications_doc_type_check;
ALTER TABLE identity_verifications ADD CONSTRAINT identity_verifications_doc_type_check
    CHECK (doc_type IN ('aadhaar','pan','driving_licence','passport','voter_id'));

-- not_reviewed: closed by the stale-pending sweep, never by a person, and never costs an attempt.
ALTER TABLE identity_verifications DROP CONSTRAINT identity_verifications_rejection_reason_check;
ALTER TABLE identity_verifications ADD CONSTRAINT identity_verifications_rejection_reason_check
    CHECK (rejection_reason IN ('blurry','cropped','mismatch','expired','not_holder','unsupported','other','not_reviewed'));

ALTER TABLE identity_verifications
    ADD COLUMN holder_dob_year_only   boolean NOT NULL DEFAULT false,
    ADD COLUMN liveness               text CHECK (liveness IN ('passed','bypassed','unavailable')),
    ADD COLUMN consent_notice_version text,
    ADD COLUMN revoked_at             timestamptz,
    ADD COLUMN revoked_by             uuid REFERENCES users(id),
    ADD COLUMN revocation_reason      text,
    ADD CONSTRAINT identity_verifications_revocation_is_whole
        CHECK ((status = 'revoked') = (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND revocation_reason IS NOT NULL)),
    ADD CONSTRAINT identity_verifications_revoker_is_not_subject
        CHECK (revoked_by IS NULL OR revoked_by <> user_id);

COMMENT ON COLUMN identity_verifications.holder_dob_year_only IS
    'Older Aadhaar cards print only the year of birth; holder_dob is then YYYY-01-01 and this is true.';
COMMENT ON COLUMN identity_verifications.liveness IS
    'What the on-device pose checks reported: passed, bypassed after the stall timer, or unavailable. A reviewer signal, never a gate.';
