-- V107 — inviting the other side before they have an account: the pending co-fill party (D121).
--
-- V75 built `service_request_parties` around a deliberate refusal, and stated it in as many words:
-- "you cannot invite somebody who has not signed up. That is the correct trade." Six weeks of the
-- flow existing says it is not. The owner raising a Leave & License agreement is, overwhelmingly,
-- the party who has heard of PuneNest; the tenant is somebody they met last week. Requiring the
-- tenant to have registered *before* the owner can even name them puts a third party's sign-up in
-- the middle of the owner's checkout, and the owner is the one who abandons.
--
-- So this migration lets the invitation be addressed to a mobile number that resolves to nobody
-- yet. What it does not do is give back the hole V75 closed, and the difference is worth being
-- precise about, because the two designs look similar and are not.
--
-- V75's objections, and what answers them here
-- --------------------------------------------
-- (1) "The row would be a claim about a person nobody had authenticated, and matching it later
--     would mean trusting whoever ends up registering that number."
--
--     It does mean exactly that, and that is the same trust the whole product already rests on:
--     registration is OTP-verified against the number, and every subsequent sign-in proves control
--     of it again. Whoever passes that check *is* the account for that number as far as any part of
--     this system can tell — an invite that resolved the mobile eagerly (V75) and one that resolves
--     it lazily (here) are trusting the identical proof, one of them earlier. What V75 was really
--     protecting against was the mock's *bearer token*: a random invite id in a WhatsApp link that
--     granted sight of the matter to anyone holding the message, authenticated or not. That is
--     still gone and stays gone. There is no token here; there is a number, and the only way to
--     turn it into sight of the agreement is to hold an account for it and then accept.
--
--     The residual risk V75 did not have is number *recycling* — TRAI releases a disconnected
--     mobile back into the pool after 90 days, so a year-old unclaimed invite could be claimed by a
--     genuine stranger. That is what `invite_expires_at` is for, below.
--
-- (2) "This table needs no entry in the erasure classification — it holds no personal data, only
--     two foreign keys to the table that does."
--
--     True until this migration and false after it: `mobile` is personal data about someone who,
--     by construction, has no account and therefore no way to ask us for anything. Two mechanisms
--     answer that and they are both required.
--
--       * The column is *transient by design*. It exists only while the row is pending. The moment
--         the invitee registers and the row is claimed, `user_id` is filled and `mobile` is set
--         back to NULL — enforced by the `addressee` CHECK below, which permits exactly one of the
--         two to be present. A claimed row is byte-for-byte the V75 row, so the steady state of
--         this table still holds no personal data. Only the waiting room does.
--       * While it is pending it is reachable by erasure and bounded by retention.
--         `ErasureService` deletes pending rows keyed on the subject's old mobile, the same idiom
--         it already uses for `otp_codes` — which is the case that matters, because somebody
--         invited-then-registered-then-erased is precisely the person whose number is sitting here.
--         `CoFillInviteRetentionSweep` deletes the rest on expiry.

-- ---------------------------------------------------------------------------------------------
-- 1. The addressee: an account, or a number waiting to become one.
ALTER TABLE service_request_parties ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE service_request_parties
    ADD COLUMN mobile text CHECK (mobile IS NULL OR mobile ~ '^[6-9][0-9]{9}$');

-- Exactly one of the two, never both and never neither. This is the constraint that makes the
-- claim a *move* rather than a copy: filling `user_id` without clearing `mobile` is rejected by the
-- database, so no code path can leave the number behind once it has served its purpose. It is also
-- what keeps the erasure story short — there is no such thing as a claimed row that still holds a
-- number, so erasure never has to reason about one.
ALTER TABLE service_request_parties
    ADD CONSTRAINT service_request_parties_addressee_check
    CHECK ((user_id IS NULL) <> (mobile IS NULL));

-- ---------------------------------------------------------------------------------------------
-- 2. The expiry, which only pending rows have.
--
-- A claimed invitation is a party to a matter and lives as long as the matter does. An unclaimed
-- one is a phone number we are holding on the strength of somebody else's typing, and it gets a
-- clock. Ninety days is the retention window used for the other "personal data we were not given
-- directly" case (V64's referral signals) and it comfortably outlasts the days-to-weeks in which a
-- real agreement is actually filled.
--
-- Not merely tidiness: it is the second half of the recycling answer above. An invite that has been
-- sitting unclaimed long enough for the number to have changed hands is deleted before it can be
-- claimed by whoever holds it next.
ALTER TABLE service_request_parties ADD COLUMN invite_expires_at timestamptz;

-- A pending row is always `invited` and always has a clock; a claimed row has neither concern.
-- Stated as a constraint rather than left to the service because the sweep's correctness depends on
-- it: a pending row with a NULL expiry would be invisible to `... WHERE invite_expires_at < now()`
-- and would sit here forever, which is the one outcome this whole section exists to prevent.
ALTER TABLE service_request_parties
    ADD CONSTRAINT service_request_parties_pending_check
    CHECK (user_id IS NOT NULL
           OR (status = 'invited' AND invite_expires_at IS NOT NULL));

-- ---------------------------------------------------------------------------------------------
-- 3. Indexes.
--
-- Partial, and on the pending rows only. The claim runs on every customer read of the service-request
-- list, so it has to be cheap on the overwhelmingly common answer, which is "nothing pending for
-- this number". Once claimed, a row leaves this index for good — the index is the waiting room, and
-- it is meant to stay small.
CREATE INDEX idx_service_request_parties_pending
    ON service_request_parties (mobile)
    WHERE mobile IS NOT NULL;

-- The sweep's access path, likewise partial: expired rows are pending rows by definition.
CREATE INDEX idx_service_request_parties_expiry
    ON service_request_parties (invite_expires_at)
    WHERE invite_expires_at IS NOT NULL;

-- ---------------------------------------------------------------------------------------------
-- 4. V75's unique indexes, re-examined under NULLs.
--
-- `uq_service_request_parties_role (request_id, role)` is unaffected and still does the load-bearing
-- work: two rows per request maximum, one per side, whether or not either is claimed. It is why no
-- extra guard is needed to stop a request accumulating pending invitations.
--
-- `uq_service_request_parties_user (request_id, user_id)` now admits NULLs, and PostgreSQL treats
-- distinct NULLs as distinct — so it no longer constrains pending rows. That is harmless here only
-- because the role index already caps the table at two rows per request; it is called out because
-- the guarantee that index appears to give ("one row per person per request") is, for pending rows,
-- now given by something else. The claim path re-checks it explicitly before filling `user_id`,
-- since that is the moment a NULL becomes a value and the index starts applying again.

COMMENT ON COLUMN service_request_parties.mobile IS
    'PERSONAL DATA, transient. The invited counterparty''s number, held only until they register and '
    'the row is claimed, at which point user_id is filled and this is set back to NULL. Erased by '
    'ErasureService keyed on the old mobile; expired by CoFillInviteRetentionSweep after 90 days.';

COMMENT ON COLUMN service_request_parties.invite_expires_at IS
    'When an unclaimed invitation is deleted. NULL once claimed. Bounds how long a mobile belonging '
    'to a non-user is retained, and stops a recycled number being claimed by its next holder.';

COMMENT ON COLUMN service_request_parties.user_id IS
    'The party, once they hold an account. NULL while the invitation is still addressed to a mobile.';

-- V1 convention: every migration ends by (re)wiring trg_set_updated_at onto every table that has an
-- updated_at column.
SELECT install_updated_at_triggers();
