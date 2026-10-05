-- Back-office sign-in becomes email + password + authenticator (TOTP). Mobile OTP no longer opens a
-- staff or admin session: a SIM swap would otherwise walk around both new factors.
--
-- staff_credentials holds everything past the password, one row per back-office account, created
-- lazily on the first password attempt. totp_secret is AES-GCM ciphertext (StaffTotpCipher), never
-- the raw secret. totp_last_step is the replay guard: a code is accepted only for a later 30s step.
-- failed_attempts / locked_until throttle password and code guesses per account.
CREATE TABLE staff_credentials (
    user_id              uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    totp_secret          text,
    totp_confirmed_at    timestamptz,
    totp_last_step       bigint,
    recovery_code_hashes jsonb       NOT NULL DEFAULT '[]'::jsonb,
    failed_attempts      integer     NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    locked_until         timestamptz,
    created_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT staff_credentials_confirmed_has_secret
        CHECK (totp_confirmed_at IS NULL OR totp_secret IS NOT NULL)
);

COMMENT ON TABLE staff_credentials IS
    'Second factor and guess throttle for staff/admin sign-in. Written by identity/auth only.';

-- An administrator can now reissue an invite (forgotten password, expired invite), so "one invite per
-- account, ever" relaxes to "one OPEN invite per account". Reissue deletes the open row first.
ALTER TABLE staff_invites DROP CONSTRAINT staff_invites_user_id_key;
CREATE UNIQUE INDEX uq_staff_invites_open_user ON staff_invites (user_id) WHERE redeemed_at IS NULL;

-- Sessions minted over mobile OTP carry no second factor; end them so every back-office session
-- after this release went through password + TOTP.
UPDATE refresh_tokens SET revoked = true
WHERE revoked = false
  AND user_id IN (SELECT id FROM users WHERE role IN ('staff', 'admin'));
