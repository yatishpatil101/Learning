-- One row per call to a paid third party (email, WhatsApp, payment gateway) and per inbound payment
-- webhook, so the back office can see what left the building without a vendor console login.
-- Never holds a body, OTP, link or key: `recipient` is masked, `recipient_hash` (sha-256 of the
-- normalised address) is only for exact-match search, and `detail` is a vendor code, not free text.
CREATE TABLE provider_call (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    provider       text        NOT NULL CHECK (provider IN ('zeptomail', 'whatsapp', 'cashfree')),
    operation      text        NOT NULL,
    outcome        text        NOT NULL CHECK (outcome IN ('ok', 'failed', 'skipped')),
    recipient      text,
    recipient_hash text,
    reference      text,
    detail         text,
    duration_ms    integer,
    created_at     timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX idx_provider_call_created ON provider_call (created_at DESC);
CREATE INDEX idx_provider_call_provider ON provider_call (provider, created_at DESC);
CREATE INDEX idx_provider_call_recipient ON provider_call (recipient_hash) WHERE recipient_hash IS NOT NULL;
CREATE INDEX idx_provider_call_reference ON provider_call (reference) WHERE reference IS NOT NULL;
