-- D206: the second key signs for a PERSON, not a record.
--
-- WHAT THIS CLOSES. V67 made a newly minted back-office account unable to authenticate until a
-- second administrator co-signed it. What it did not take away was the maker's ability to choose
-- that account's password: `StaffCreate` carried a `password` field, so the administrator who
-- minted the account also knew the credential it would sign in with. The co-signature therefore
-- attested to a ROW -- "an account with this name and role should exist" -- and not to a HUMAN
-- BEING, because the person who would actually be holding it was never involved. A maker could
-- mint a colleague, have a peer approve it in good faith, and then sign in as that colleague; the
-- peer's name is on the decision and the maker holds the session.
--
-- The fix is that NEITHER administrator ever sets or learns the credential. The account is created
-- with no password hash at all, and a single-use, time-limited invite is issued to the person the
-- account is for. They set their own password by redeeming it. The maker has no field to type a
-- password into, and the checker is handed nothing but a decision.
--
-- WHY THE RAW TOKEN IS NOT IN THIS TABLE. Only `sha256(secret)` is stored, for the same reason
-- `refresh_tokens.token_hash` and `otp_codes.code_hash` hold digests: a dump of this table must not
-- be replayable. The token handed to the invitee is `<id>.<secret>` -- the id is a SELECTOR used to
-- fetch exactly one row, and the secret is then compared with `MessageDigest.isEqual`, which is
-- constant-time. Looking a token up BY its hash would have worked too, but the comparison would
-- then be the database's `=` on an indexed column, which is neither constant-time nor ours.
--
-- WHY `user_id` IS UNIQUE RATHER THAN THE PRIMARY KEY. The id has to be an independent selector the
-- token can carry, and a token that carried the user id would name the account it belongs to in
-- plain sight -- an enumeration surface handed out by design. UNIQUE then enforces ONE INVITE PER
-- ACCOUNT, EVER -- not merely one open one. That is deliberately the strictest reading available
-- today, because there is no reissue route to write a second row: an invite that expires unredeemed
-- currently strands the account, and the operator's remedy is to archive it and mint another. A
-- reissue endpoint is the obvious next step and will need its own migration to relax this to a
-- partial unique index over the open rows; until it exists, the loose constraint would only be
-- permission for a second write path nobody has reviewed.
--
-- WHY AN UNREDEEMED ROW BLOCKS AUTHENTICATION, ON TOP OF THE APPROVAL ROW. An account with no
-- password is not thereby unreachable: it has a mobile number, and mobile-OTP login needs no
-- password whatsoever. A maker who typed their OWN number into the create form would hold the
-- account outright the moment the checker approved it. So `identity.auth.AuthService` refuses to
-- issue a token for an account whose invite is still open, on all three issuing paths -- the same
-- shape as V67's gate, and for the same reason: an account that can obtain a session is a foothold
-- regardless of what it is currently permitted to do.
--
-- WHY EXPIRY IS A COLUMN AND NOT A POLICY IN JAVA. An invite that never expires is a credential
-- lying around in somebody's SMS history forever. The TTL is applied when the row is written, so
-- changing the policy later cannot retroactively extend an invite already in flight, and a reader
-- of this table can see when each one dies without reading any code.
--
-- ON DELETE: the subject cascades (an invite to an account that does not exist is a record of
-- nothing); the issuer RESTRICTs, matching V67 -- who issued a credential is the fact a later
-- dispute turns on, and users are never hard-deleted on this platform anyway (erasure
-- pseudonymises and archives).

CREATE TABLE staff_invites (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
    token_hash  text        NOT NULL,
    created_by  uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL,
    redeemed_at timestamptz,
    CONSTRAINT staff_invites_expires_after_issue CHECK (expires_at > created_at)
);

-- The only query shape that scans: "which invites are still open". Partial, because a redeemed row
-- is history and nothing lists it -- an index over those would be the whole table for a question
-- that excludes them.
CREATE INDEX idx_staff_invites_open
    ON staff_invites (expires_at)
    WHERE redeemed_at IS NULL;

COMMENT ON TABLE staff_invites IS
    'Single-use credential invites for back-office accounts (D206). One row per account minted '
    'through POST /users/staff. A row with redeemed_at IS NULL BLOCKS AUTHENTICATION for that '
    'account on every login path, exactly as an unapproved staff_account_approvals row does, and '
    'for the same reason: the account has no usable password yet and a passwordless account is '
    'still reachable over mobile OTP. NO ROW means the account is not subject to the invite flow, '
    'which is the state of every account created before this migration and of every consumer '
    'account. Read by identity/auth/AuthService, written and redeemed by '
    'identity/auth/StaffInviteService.';

COMMENT ON COLUMN staff_invites.id IS
    'Selector half of the token handed to the invitee (`<id>.<secret>`). Public by construction; it '
    'names no account, which is why it is safe to put in a token and why user_id is not the key.';

COMMENT ON COLUMN staff_invites.token_hash IS
    'sha256(secret) -- the secret half of the token, NEVER the token itself. Compared with '
    'MessageDigest.isEqual so the verify path leaks no timing signal about how much of a guess '
    'matched.';

COMMENT ON COLUMN staff_invites.created_by IS
    'The administrator who minted the account. Recorded for the audit trail only: this person is '
    'deliberately never told the token and cannot set the password, which is the whole of D206.';

COMMENT ON COLUMN staff_invites.redeemed_at IS
    'When the invitee set their own password. NULL means the invite is open, which blocks login. '
    'One-way and single-use: a redeemed invite is refused for the rest of its life.';
