-- V64  Referral integrity: the qualifying action, the share channel, and two hashed fraud signals.
--
-- Closes the referral half of D191/D56/D60/D55/D61. One migration rather than four because the
-- columns are one decision: Q17 (closed 2026-08-11) rules that a referral credits the referrer
-- *when the referee's first listing passes verification*, and everything below is either that event
-- or a signal the fraud desk needs in order to read it.
--
-- WHY THIS EVENT. The rejected alternatives are on record and should not be re-litigated here:
-- verified-mobile (a SIM costs less than the credit it mints), referee identity verification (too
-- much friction on the exact surface being used to buy liquidity), and manual review (does not
-- scale, and delays the reward that makes a referral scheme work at all). Clearing the ownership-
-- document gate is the one qualifying action that is already expensive to fake, so it does the
-- anti-fraud work twice and no separate fraud machinery is needed.
--
-- ---------------------------------------------------------------------------
-- 1. The qualifying action (D191, D56)
-- ---------------------------------------------------------------------------
-- `qualified` has been in the status CHECK since V7 and extended by V23, and no code path has ever
-- produced it -- the vocabulary declared a state the platform could not reach. These two columns
-- are what makes it reachable, and what makes it auditable afterwards.
--
-- WHY RECORD THE PROPERTY AND NOT JUST A FLAG. "First listing" is a claim about a specific listing
-- on a specific date. A bare boolean leaves a fraud desk investigating a suspicious referrer with no
-- way to ask which listing bought the credit, which is the first question they will have. It also
-- makes the idempotency visible: a second announcement for the same property is recognisable as a
-- repeat rather than inferred from a timestamp.
--
-- NO FOREIGN KEY TO `properties`, deliberately. This is evidence about a decision that was taken,
-- not a live association: a listing that is later withdrawn or deleted must neither erase the record
-- of why a credit was granted nor block its own deletion behind a growth-context row.
ALTER TABLE referrals ADD COLUMN qualified_at          timestamptz;
ALTER TABLE referrals ADD COLUMN qualified_property_id uuid;

COMMENT ON COLUMN referrals.qualified_at IS
    'When the referee''s first listing passed ownership verification (Q17). NULL until it does. '
    'Set exactly once: a second verified listing by the same owner, and re-verification after a '
    'lapse, are both no-ops.';
COMMENT ON COLUMN referrals.qualified_property_id IS
    'Which listing cleared the gate. Evidence, not an association -- no FK, so deleting the listing '
    'neither erases the reason a credit was granted nor is blocked by it.';

-- The per-referrer rolling-window cap (D61) counts qualifications, so it reads exactly this shape.
-- Partial because the overwhelming majority of rows never qualify and an index over their NULLs
-- would be most of the table for none of the benefit.
CREATE INDEX idx_referrals_referrer_qualified
    ON referrals (referrer_id, qualified_at) WHERE qualified_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. How the link was actually shared (D60)
-- ---------------------------------------------------------------------------
-- `channel` says `seeker` or `owner`. That is which side of the marketplace the referred party
-- joined on -- a real fact, and a useful one, but not the one the name promises. Nothing has ever
-- recorded how the link travelled, because redemption carried no share context to record.
--
-- Added as a second column rather than by repurposing `channel`: `channel` is on the wire, in the
-- contract's enum, in the ops queue's facet and behind a CHECK constraint, and changing what it
-- means would silently rewrite every row already stored under the old meaning. A field that is
-- merely under-named is cheaper to document than to migrate; a field that is *missing* has to be
-- added either way.
--
-- Nullable, and null is the common case: the referee's browser can only report a share channel the
-- referrer's link carried, and a code dictated over a phone call carries nothing. An unknown channel
-- is recorded as unknown. The same rule as the two signals below -- a fabricated value is worse than
-- an absent one, because a desk that trusts it stops looking.
ALTER TABLE referrals ADD COLUMN share_channel text;
ALTER TABLE referrals ADD CONSTRAINT referrals_share_channel_check
    CHECK (share_channel IS NULL
           OR share_channel IN ('whatsapp', 'sms', 'email', 'copy', 'qr', 'other'));

COMMENT ON COLUMN referrals.share_channel IS
    'How the referral link reached the referee, as reported at redemption. NULL when unknown, which '
    'includes every code passed on by voice. Distinct from `channel`, which records which side of '
    'the marketplace the referred party joined on.';

-- ---------------------------------------------------------------------------
-- 3. Device and network correlation (D55) -- PERSONAL DATA, READ THIS BLOCK
-- ---------------------------------------------------------------------------
-- `same_device` and `same_ip` have been NOT NULL DEFAULT false since V7 and nothing has ever
-- computed them, because the platform captured neither side of the comparison. The two strongest
-- self-referral signals were therefore absent from the one desk that exists to catch self-referral.
--
-- WHAT IS STORED. A salted SHA-256 hex digest of the client address, and a salted SHA-256 hex digest
-- of the User-Agent header. NEVER the raw address and NEVER the raw header. The salt is a
-- deployment secret (`punenest.security.referral-signal-salt`); without it these are 64 hex
-- characters that cannot be walked back to an address, which matters because the IPv4 space is 2^32
-- and an unsalted digest of it is reversible by anybody with a laptop and an afternoon.
--
-- PURPOSE LIMITATION. Referral fraud detection, and nothing else. These columns exist so that
-- `same_device` and `same_ip` can be computed honestly at redemption. They are not an analytics
-- input, not a login signal, and not a general device fingerprint: nothing outside
-- billing/referral may read them, and the only comparison performed is equality between a referrer's
-- stored digest and a referee's freshly computed one.
--
-- RETENTION: 90 DAYS, then cleared in place. Long enough for a fraud desk working a queue to
-- correlate a cluster of referrals; short enough that the platform is not accumulating a permanent
-- record of where every user was when they signed up. Enforced by ReferralSignalRetentionSweep,
-- which blanks both columns once the row is older than the window, and disclosed to the subject
-- through ErasureRetention#knownGaps(). The cleared row keeps `same_device`/`same_ip` -- the
-- *finding* survives the evidence, which is the same shape as `aadhaar_verified` recording an
-- outcome rather than a number.
--
-- WHY A HASH RATHER THAN NOTHING AT ALL. V24 declined to record a client IP on `society_leads` and
-- said why: "the app sits behind proxies whose header policy is not settled, and a wrong client IP
-- recorded as fact is worse than none (see D55 on referrals)." That objection has since been
-- answered -- TrustedProxyConfig makes every deployment declare its topology, and refuses to boot
-- if it does not -- so `getRemoteAddr()` is now either the socket peer or an X-Forwarded-For value
-- from a proxy the deployment explicitly named. The reason to hold off is gone; the reason not to
-- store the raw value is not.
ALTER TABLE referrals ADD COLUMN referred_ip_hash     text;
ALTER TABLE referrals ADD COLUMN referred_device_hash text;

COMMENT ON COLUMN referrals.referred_ip_hash IS
    'Salted SHA-256 of the client address the referee redeemed from (IPv6 collapsed to its /64). '
    'PERSONAL DATA. Purpose: referral fraud detection only. Retention 90 days, then blanked by '
    'ReferralSignalRetentionSweep. Never the raw address.';
COMMENT ON COLUMN referrals.referred_device_hash IS
    'Salted SHA-256 of the User-Agent the referee redeemed with. PERSONAL DATA. Purpose: referral '
    'fraud detection only. Retention 90 days, then blanked by ReferralSignalRetentionSweep. Never '
    'the raw header.';

-- The other half of the comparison. The referrer's digests are stamped on their code row when the
-- code is minted -- which is the moment they opened the referral screen to share it, so it is the
-- device the link is about to be sent from.
--
-- WHY MINT-TIME AND NOT LAST-SEEN. Refreshing these on every read would put a write on a read path
-- for a signal that is advisory. It would also be worse data, not better: a referrer who last opened
-- the screen from an office network would match every colleague who signed up there that afternoon.
-- The cost of stamping once is a false negative for a referrer who has since moved network, and a
-- false negative here is the safe direction -- it sends the referral to a human instead of flagging
-- an honest one.
--
-- Rows minted before this migration have all three NULL, and a NULL never matches: those referrers
-- keep the pre-V64 behaviour of both signals reading false. That is correct rather than unfortunate.
ALTER TABLE referral_codes ADD COLUMN referrer_ip_hash     text;
ALTER TABLE referral_codes ADD COLUMN referrer_device_hash text;
ALTER TABLE referral_codes ADD COLUMN signals_at           timestamptz;

COMMENT ON COLUMN referral_codes.referrer_ip_hash IS
    'Salted SHA-256 of the address the referrer minted their code from (IPv6 collapsed to its /64). '
    'PERSONAL DATA. Purpose: referral fraud detection only. Retention 90 days from signals_at, then '
    'blanked by ReferralSignalRetentionSweep. Never the raw address.';
COMMENT ON COLUMN referral_codes.referrer_device_hash IS
    'Salted SHA-256 of the User-Agent the referrer minted their code with. PERSONAL DATA. Purpose: '
    'referral fraud detection only. Retention 90 days from signals_at, then blanked by '
    'ReferralSignalRetentionSweep. Never the raw header.';
COMMENT ON COLUMN referral_codes.signals_at IS
    'When the two digests above were captured. Drives their 90-day retention window; created_at '
    'cannot, because a row may be re-stamped and because it exists on rows that predate V64.';

-- ---------------------------------------------------------------------------
-- 4. What this migration deliberately does NOT add (D61)
-- ---------------------------------------------------------------------------
-- No new uniqueness constraint. The distinctness D61 asks for -- one credit per referee, ever --
-- is already enforced twice over: `uq_referrals_referred_mobile` (V23) admits one referral row per
-- referred mobile, and `qualified_at` moves from NULL exactly once on that row. A third constraint
-- would restate what the database already refuses and would have to be maintained alongside it.
--
-- No velocity *block*, either. The per-referrer cap D61 asks for is a configuration value
-- (`settings.fees.referralQualifyPerMonth`, default 10 a month) read by ReferralQualification, and
-- exceeding it does not reject anything -- it declines to auto-qualify and leaves the referral
-- pending for a human, exactly as every referral behaved before this migration. That distinction is
-- the whole reason the cap is safe to introduce: D61 records that automated velocity blocks were
-- avoided on purpose because they "would reject genuine roommates and flatmates, which is the
-- platform's most common referral", and a flatshare of four or a building's worth of neighbours must
-- still be able to refer each other. Ten a month is deliberately far above that and the overflow
-- goes to review rather than to refusal, so the reasoning D61 records still holds.
