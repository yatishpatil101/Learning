ALTER TABLE identity_verifications
    ADD COLUMN liveness_challenge text,
    ADD COLUMN number_overridden boolean NOT NULL DEFAULT false;

ALTER TABLE identity_verifications
    ADD CONSTRAINT ck_identity_verifications_liveness_challenge
    CHECK (liveness_challenge IN ('left', 'right', 'smile'));
