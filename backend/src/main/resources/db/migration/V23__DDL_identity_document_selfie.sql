-- Identity verification moves from the DigiLocker redirect to live-captured ID + selfie photos
-- reviewed by staff. Pre-launch: identity_verifications holds no production rows, so it is
-- rebuilt rather than migrated.

-- `verified` already carries the badge; the Aadhaar-specific alias is gone with the funnel.
ALTER TABLE users DROP COLUMN aadhaar_verified;

ALTER TABLE referrals RENAME COLUMN aadhaar_verified TO identity_verified;
ALTER TABLE referrals RENAME COLUMN aadhaar_unique TO identity_unique;

UPDATE properties SET handback_milestone = 'identity_verified' WHERE handback_milestone = 'aadhaar_verified';
ALTER TABLE properties DROP CONSTRAINT properties_handback_milestone_check;
ALTER TABLE properties ADD CONSTRAINT properties_handback_milestone_check
    CHECK (handback_milestone IN ('photos_uploaded','identity_verified','claim_sent','claimed'));
COMMENT ON COLUMN properties.handback_milestone IS
    'Hand-back axis: photos_uploaded -> identity_verified -> claim_sent -> claimed. Null until the hand-back starts.';

DROP TABLE identity_verifications;

-- One case per user; a resubmission overwrites the pending/rejected case in place.
-- identity_hash = HMAC(doc_type:normalised number), set only from reviewer-confirmed values ->
-- UNIQUE enforces "one document = one badge" across all three document types.
-- claimed_hash = the same HMAC over what the on-device OCR read; a queue warning, never a gate.
-- person_key = HMAC(normalised name|dob) — soft cross-document signal for the reviewer.
-- The full document number is never stored: the hash is one-way and only the last 4 survive.
CREATE TABLE identity_verifications (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              uuid NOT NULL UNIQUE REFERENCES users(id),
    status               text NOT NULL CHECK (status IN ('pending','verified','rejected')),
    doc_type             text NOT NULL CHECK (doc_type IN ('aadhaar','pan','driving_licence')),
    claimed_number_last4 text,
    claimed_name         text,
    claimed_dob          date,
    claimed_hash         text,
    identity_hash        text UNIQUE,
    person_key           text,
    doc_last4            text,
    holder_name          text,
    holder_dob           date,
    consent_at           timestamptz NOT NULL,
    submitted_at         timestamptz NOT NULL DEFAULT now(),
    attempt_count        int NOT NULL DEFAULT 1,
    attempt_window_start timestamptz NOT NULL DEFAULT now(),
    reviewer_id          uuid REFERENCES users(id),
    decided_at           timestamptz,
    rejection_reason     text CHECK (rejection_reason IN ('blurry','cropped','mismatch','expired','not_holder','unsupported','other')),
    rejection_note       text,
    files_purged_at      timestamptz,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_identity_verifications_queue ON identity_verifications (status, submitted_at);
CREATE INDEX idx_identity_verifications_claimed_hash ON identity_verifications (claimed_hash) WHERE claimed_hash IS NOT NULL;
CREATE INDEX idx_identity_verifications_person_key ON identity_verifications (person_key) WHERE person_key IS NOT NULL;
-- The purge sweep scans decided cases whose images still exist.
CREATE INDEX idx_identity_verifications_purge ON identity_verifications (decided_at) WHERE decided_at IS NOT NULL AND files_purged_at IS NULL;

-- Private-bucket keys of the captured images; rows go when the sweep deletes the objects.
CREATE TABLE identity_verification_files (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    verification_id uuid NOT NULL REFERENCES identity_verifications(id) ON DELETE CASCADE,
    kind            text NOT NULL CHECK (kind IN ('front','back','selfie')),
    storage_key     text NOT NULL,
    content_type    text NOT NULL,
    size_bytes      int NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (verification_id, kind)
);
