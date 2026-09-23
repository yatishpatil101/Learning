-- The Tenant-verified badge could certify a sub-let the owner had never agreed to, backed by a
-- photograph nobody could check. Two separate holes, closed together because the badge is one claim.
--
-- Hole 1: consent was a fact on groups and a rumour on rooms.
--
-- `flatmate_groups` has carried `owner_consent` since V13 and derives it honestly -- the flag is set
-- from `flatmate_owner_consents`, which only an OTP the owner typed can write. `flatmate_rooms` was
-- given no such column, so the room path had nothing to read and instead asked whether the client
-- had *typed* a number:
--
--     FlatmateVocabulary.blankToNull(body.ownerConsentMobile()) != null
--
-- Ten arbitrary digits therefore set `flatmate_reviews.owner_consent = true`, and Ops read that
-- boolean as corroboration when deciding the badge. The columns below give rooms the same storage
-- groups already have, so both paths can read the same OTP-backed table and the rule "owner_consent
-- is never client-asserted" becomes true of the schema rather than of one of the two writers.
--
-- Hole 2: an agreement was an image and nothing else.
--
-- Maharashtra Rent Control Act 1999 s.55 makes Leave & License registration compulsory, which means
-- a genuine agreement HAS a registration number, a registration date and -- since these run eleven
-- months -- an end date. Storing only a photo left the Ops desk unable to tell a registered
-- agreement from stamp paper with typing on it, and left the platform with no date at which to stop
-- vouching for one. These are real columns rather than keys inside `agreement_doc` because
-- `agreement_valid_till` is *queried*: the expiry sweep asks the whole table for the badges that
-- have run out, and a jsonb probe would make that a full scan of a table that grows with the market.
-- The other two sit beside it because one agreement's identity should not live in two storage shapes.

ALTER TABLE flatmate_rooms
    ADD COLUMN owner_consent        boolean NOT NULL DEFAULT false,
    ADD COLUMN owner_consent_mobile text;

ALTER TABLE flatmate_reviews
    ADD COLUMN agreement_reg_no        text,
    ADD COLUMN agreement_registered_on date,
    ADD COLUMN agreement_valid_till    date;

-- No format check on the number. Maharashtra registration numbers are issued per sub-registrar
-- office and their shape varies by SRO and by year; nothing downstream parses this -- a human at the
-- Ops desk reads it and checks it against the IGR portal. A regex here could only be as good as the
-- guess behind it, and a wrong guess rejects agreements that are perfectly real.
--
-- The dates do get a check, because it is arithmetic rather than a guess: an agreement cannot stop
-- being valid before it started. Both halves tolerate null, since a pre-existing review has neither
-- and a host may supply the number without the dates.
ALTER TABLE flatmate_reviews
    ADD CONSTRAINT ck_flatmate_reviews_agreement_dates
        CHECK (agreement_valid_till IS NULL
            OR agreement_registered_on IS NULL
            OR agreement_valid_till > agreement_registered_on);

-- Partial, on V27's reasoning: the sweep reads "the rows that have an end date", which is the
-- tenant-tier minority of the queue. Indexing only those keeps the index that size however large
-- the table gets, and costs nothing on the owner-tier rows that never populate it.
CREATE INDEX idx_flatmate_reviews_agreement_expiry
    ON flatmate_reviews (agreement_valid_till)
 WHERE agreement_valid_till IS NOT NULL;

-- Retract the rumour. Every `owner_consent = true` on a room-kind review was written by the
-- assertion above, so it is not evidence and must not go on reading like it. Groups are untouched:
-- their flag was derived from the consent table and is exactly as true as it ever was.
--
-- This is deliberately not a backfill from `flatmate_owner_consents`. The only key those rows share
-- with a room review is the host, and "this host once got consent from some owner, for some flat"
-- is not "this host has consent for THIS flat" -- inferring one from the other would relabel a guess
-- as a fact, which is the thing being fixed. The host's next edit re-derives the flag properly
-- against the number they give, and the sweep takes back any badge left standing without one.
UPDATE flatmate_reviews
   SET owner_consent = false
 WHERE kind = 'room'
   AND owner_consent;

COMMENT ON COLUMN flatmate_rooms.owner_consent IS
    'Whether the flat''s owner confirmed, by OTP, that this tenant may offer a room in it. Derived '
    'server-side from flatmate_owner_consents and never accepted from a client -- the API takes a '
    'mobile number to look the consent up by, never the boolean itself. Required for the '
    'tenant-tier badge but not for posting: parting with possession without the owner''s consent is '
    'an eviction ground under the Maharashtra Rent Control Act, so the platform declines to vouch '
    'for such a listing while still letting the host advertise at their own risk.';

COMMENT ON COLUMN flatmate_rooms.owner_consent_mobile IS
    'The number the consent above was looked up by, normalised to ten digits. Stored so an edit can '
    're-derive the flag against the same owner rather than trusting the standing boolean -- without '
    'it, pointing the field at a different number would silently keep a consent granted for someone '
    'else''s flat.';

COMMENT ON COLUMN flatmate_reviews.agreement_reg_no IS
    'The Leave & License registration number as printed on the agreement. Free text by design: the '
    'format varies by sub-registrar office and year, and the value is read by a human at the Ops '
    'desk who checks it against the IGR portal. It is the single field separating a registered '
    'agreement from stamp paper, which is why the tenant tier now asks for it.';

COMMENT ON COLUMN flatmate_reviews.agreement_registered_on IS
    'The date the agreement was registered. Read beside the number when Ops verifies it against IGR.';

COMMENT ON COLUMN flatmate_reviews.agreement_valid_till IS
    'The date the licence period ends -- typically eleven months after registration, the term '
    'Maharashtra Leave & License agreements are written for. Queried, not just displayed: the '
    'expiry sweep demotes a tenant-tier badge once this date has passed, because a badge that '
    'outlives the agreement behind it is exactly the claim the review queue exists to prevent.';
