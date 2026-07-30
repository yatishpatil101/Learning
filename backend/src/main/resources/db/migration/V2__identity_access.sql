-- V2 Identity & Access (Phase 1). Root of the trust boundary: users + auth material.
-- Schemas: User, UserUpdate, StaffCreate, AuthResponse, AadhaarVerification, KycStart, DigilockerWebhook.

-- users: the identity root every other table hangs off (reconciliation #10: *Mobile natural keys
-- become user_id FKs). email nullable (reconciliation #9). Seekers (buyer/tenant) share 'buyer'.
CREATE TABLE users (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name                  text,
    mobile                text NOT NULL UNIQUE CHECK (mobile ~ '^[6-9][0-9]{9}$'),  -- schema: Mobile
    email                 text,
    password_hash         text,                                                     -- staff/admin only (StaffLoginRequest)
    role                  text NOT NULL DEFAULT 'buyer' CHECK (role IN ('buyer','owner','staff','admin')),
    team                  text CHECK (team IN ('rental','legal','loans','interior','packers','valuation')),
    status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
    city                  text,
    -- Trust ladder (ADR-019): mobile_verified (L1) is the floor; verified/aadhaar_verified is the
    -- opt-in badge (L2), a trust signal never a gate.
    mobile_verified       boolean NOT NULL DEFAULT false,
    verified              boolean NOT NULL DEFAULT false,
    aadhaar_verified      boolean NOT NULL DEFAULT false,
    verified_contact_only boolean NOT NULL DEFAULT false,  -- owner pref: accept L2-verified contacts only
    listings_count        integer NOT NULL DEFAULT 0,      -- denormalized (owners)
    avatar                text,
    joined_at             timestamptz NOT NULL DEFAULT now(),
    last_active           timestamptz,
    archived              boolean NOT NULL DEFAULT false,   -- soft-delete (never hard-delete users)
    archived_at           timestamptz,
    archive_reason        text,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_role   ON users (role);
CREATE INDEX idx_users_team   ON users (team) WHERE team IS NOT NULL;
CREATE INDEX idx_users_status ON users (status) WHERE archived = false;

-- Passwordless login OTP (ADR-008). Code stored hashed; attempts + TTL support throttling.
CREATE TABLE otp_codes (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mobile     text NOT NULL CHECK (mobile ~ '^[6-9][0-9]{9}$'),
    code_hash  text NOT NULL,
    purpose    text NOT NULL DEFAULT 'login' CHECK (purpose IN ('login','signup','contact')),
    attempts   integer NOT NULL DEFAULT 0,
    consumed   boolean NOT NULL DEFAULT false,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_otp_codes_mobile ON otp_codes (mobile, purpose);

-- Rotating refresh tokens with reuse-detection (ADR-008). Stored hashed; rotated_from chains
-- rotations so a replayed old token can be detected and the family revoked.
CREATE TABLE refresh_tokens (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES users(id),
    token_hash   text NOT NULL UNIQUE,
    rotated_from uuid REFERENCES refresh_tokens(id),
    revoked      boolean NOT NULL DEFAULT false,
    expires_at   timestamptz NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens (user_id);

-- Identity (KYC) verification badge (ADR-009/009b/019). Merges the in-progress KycStart handle
-- (ref/verification_url/expires_at) with the DigiLocker result (masked UID, mobile_match).
-- identity_hash = server-computed composite dedup key -> UNIQUE enforces "one Aadhaar = one account".
-- Raw Aadhaar is NEVER stored (only last-4 masked).
CREATE TABLE identity_verifications (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid NOT NULL UNIQUE REFERENCES users(id),
    ref              text UNIQUE,                       -- correlates KycStart <-> DigiLocker webhook
    badge            boolean NOT NULL DEFAULT false,
    status           text NOT NULL DEFAULT 'none' CHECK (status IN ('none','pending','verified','failed')),
    source           text CHECK (source IN ('digilocker')),
    masked_aadhaar   text,                              -- 'XXXX XXXX 1234'
    identity_hash    text UNIQUE,                       -- dedup key; irreversible
    mobile_match     boolean,                           -- soft signal (ADR-009a), nullable
    verification_url text,
    expires_at       timestamptz,
    verified_at      timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

SELECT install_updated_at_triggers();
