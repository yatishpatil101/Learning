-- V80: staff-only notes in the owner<->ops verification thread (D218).
--
-- WHY THIS EXISTS. V79 gave the platform a duplicate-listing probe, and the finding has to go
-- somewhere a moderator will actually read: the case file. But `review_messages` had exactly two
-- readers -- the owner and ops -- and no way to address one without the other. Posting the finding
-- into that thread would have handed the submitter the answer to the question the probe asks.
--
-- Concretely, and this is a real attack rather than a tidiness argument: submit a throwaway listing
-- carrying a guessed electricity meter number, then read your own verification thread. A note back
-- means the meter is already on the platform; silence means it is not. The note names the other
-- listing, so the probe also confirms the existence of PENDING listings, which no public route will
-- admit to. That is an oracle for `properties.electricity_meter_no` -- the column V79 deliberately
-- withholds from the public response -- reachable by any account that can post a listing.
--
-- WHY A COLUMN AND NOT A SEPARATE TABLE. An internal note is the same shape as every other message
-- (author, body, timestamp, ordering) and belongs in the same chronology; a moderator needs to read
-- "flagged as a possible duplicate" in sequence with the owner's reply to it. A parallel table would
-- have to be merged back into one ordered list at read time by every caller, and the first caller to
-- forget is a moderator deciding on half the record.
--
-- DEFAULT FALSE IS THE SAFE DIRECTION. Every existing row was written to be read by the owner, and
-- stays that way. The flag is set only where the code explicitly asks for a staff-only note, so a
-- future message that forgets the flag is over-shared to the owner rather than silently hidden from
-- them -- an embarrassment rather than a moderator deciding on evidence they never saw.
--
-- NOT NULL is what makes the read filter total: a three-valued `internal` would leave
-- `internal = false` quietly dropping the NULL rows out of the owner's thread.

ALTER TABLE review_messages
    ADD COLUMN internal boolean NOT NULL DEFAULT false;

-- No index. The filter is always applied to the handful of messages of one already-loaded case file,
-- never as a standalone predicate across the table, so an index here would be write cost with no
-- reader.

COMMENT ON COLUMN review_messages.internal IS
    'True for staff-only notes, hidden from the listing owner. See V80.';
