ALTER TABLE otp_codes DROP CONSTRAINT IF EXISTS otp_codes_purpose_check;
ALTER TABLE otp_codes ADD CONSTRAINT otp_codes_purpose_check CHECK (
    purpose IN ('login', 'owner-consent') OR purpose LIKE 'owner-consent:%' OR purpose LIKE 'tenant-consent:%'
        OR purpose LIKE 'draft-approval:%'
);
