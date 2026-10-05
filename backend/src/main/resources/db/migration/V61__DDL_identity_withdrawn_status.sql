-- Withdrawal keeps the row: it holds the attempt window and the fraud tombstone (identity_hash of a
-- revoked or not_holder case), so deleting it would reset both. Files and claims are purged instead.
ALTER TABLE identity_verifications DROP CONSTRAINT identity_verifications_status_check;
ALTER TABLE identity_verifications ADD CONSTRAINT identity_verifications_status_check
    CHECK (status IN ('pending','verified','rejected','revoked','withdrawn'));

ALTER TABLE identity_verifications ADD CONSTRAINT identity_verifications_revocation_reason_length
    CHECK (revocation_reason IS NULL OR length(btrim(revocation_reason)) BETWEEN 10 AND 300);
