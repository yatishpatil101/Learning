-- A licensor who types the tenant's Aadhaar and PAN into the wizard files a deed in the tenant's name
-- without the tenant ever touching Draazy. The tenant confirms by an OTP to the mobile the licensor
-- typed, and checkout stays shut until every typed tenant has. Keyed to the pair, not the request,
-- so the tenant can confirm before the request exists; a confirmation is good for 30 days.

CREATE TABLE rent_agreement_tenant_consents (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    granted_to    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_mobile varchar(10) NOT NULL CHECK (tenant_mobile ~ '^[6-9][0-9]{9}$'),
    consented_at  timestamptz NOT NULL DEFAULT now(),
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (granted_to, tenant_mobile)
);

ALTER TABLE otp_codes DROP CONSTRAINT IF EXISTS otp_codes_purpose_check;
ALTER TABLE otp_codes ADD CONSTRAINT otp_codes_purpose_check CHECK (
    purpose IN ('login', 'owner-consent') OR purpose LIKE 'owner-consent:%' OR purpose LIKE 'tenant-consent:%'
);
