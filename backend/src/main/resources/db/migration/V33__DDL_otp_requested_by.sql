-- ---------------------------------------------------------------------------
-- An OTP send has a requester, not just a recipient (V33)
-- ---------------------------------------------------------------------------
-- Every send budget in `OtpSendBudget` is keyed on the RECIPIENT: the cooldown and the five-per-hour
-- ceiling are `(mobile, purpose)`, and the platform ceiling is one undifferentiated pool. That is
-- the right shape for login, where the caller and the recipient are the same person, and it is the
-- wrong shape for `POST /flatmates/owner-consent`, where an authenticated tenant names somebody
-- else's number. A caller who rotates the number they type starts every send with a fresh
-- per-recipient budget, so the only limit they ever meet is the one shared with everybody.
--
-- `OtpSendBudget.MAX_PURPOSE_SENDS_PER_WINDOW` bounded the blast radius — the consent flow can
-- exhaust itself without draining the pool sign-in draws from — but it is still a share of a
-- COMMONS. One account can spend the whole hundred and lock every honest tenant out of the flow for
-- the rest of the hour. Charging the caller needs a column naming them, which is why this is a
-- migration and not a predicate.
--
-- Nullable, and it will stay nullable: a login or signup code is requested by whoever is holding the
-- phone, who has no session yet, and no backfill can invent one for a row already written. Null
-- therefore means "no authenticated caller", which the budget reads as "not chargeable to anyone" —
-- the pre-existing behaviour, unchanged, for every flow that does not name a third party.
--
-- ON DELETE SET NULL rather than CASCADE: the row is the recipient's rate-limit evidence, and it
-- must not disappear because the person who spent it did. Erasure is the other direction and is
-- handled in `ErasureService`, which deletes the subject's own OTP rows outright.
ALTER TABLE otp_codes
    ADD COLUMN requested_by uuid REFERENCES users (id) ON DELETE SET NULL;

-- Partial, because the budget only ever asks about rows that name a caller, and the null rows are
-- the overwhelming majority (every login). `created_at` trails the key so the window scan is an
-- index-only range rather than a filter over the whole caller's history.
CREATE INDEX idx_otp_codes_requested_by
    ON otp_codes (requested_by, purpose, created_at)
    WHERE requested_by IS NOT NULL;

COMMENT ON COLUMN otp_codes.requested_by IS
    'The authenticated account that asked for this code, when one asked. Null for login and signup, '
    'where the caller is the recipient and has no session yet. Read only by the per-caller send '
    'budget, which is what stops one account spending a third-party flow''s whole hourly share.';
