-- ---------------------------------------------------------------------------
-- Two corrections to V33's `otp_codes.requested_by` (V34)
-- ---------------------------------------------------------------------------
-- Both were found in review. V33 is applied, so its checksum forbids editing it in place; this
-- file also supersedes the two sentences of its prose that are now wrong.
--
-- 1. THE FOREIGN KEY ACTION. V33 chose ON DELETE SET NULL and justified it as protecting "the
--    recipient's rate-limit evidence", adding that erasure "deletes the subject's own OTP rows".
--    Both halves are wrong. `ErasureService` deletes `where mobile = :mobile OR requested_by = :id`,
--    so it removes rows addressed to THIRD PARTIES' numbers — precisely the evidence the sentence
--    said must survive — and it does so deliberately: a consent code the subject requested is
--    addressed to somebody else's phone and is therefore unreachable from their own number.
--
--    Worse, SET NULL is the one action that could produce a row nobody can reach. Null the
--    requester on a third-party code and it matches NEITHER erasure predicate: not the subject's
--    mobile, because it never carried it, and no longer any account. That is an orphan holding a
--    stranger's number indefinitely.
--
--    It is unreachable today only because nothing hard-deletes a user — V11 records that users are
--    archived and erasure pseudonymises in place. RESTRICT turns that from an assumption the code
--    relies on into one the database enforces: the day something does try to hard-delete a user,
--    it fails loudly here rather than quietly stranding the row. Erasure is unaffected; it removes
--    these rows itself, before it touches the user.
ALTER TABLE otp_codes
    DROP CONSTRAINT otp_codes_requested_by_fkey;

ALTER TABLE otp_codes
    ADD CONSTRAINT otp_codes_requested_by_fkey
        FOREIGN KEY (requested_by) REFERENCES users (id) ON DELETE RESTRICT;

-- 2. THE INDEX COLUMN ORDER. V33 built (requested_by, purpose, created_at) and claimed `created_at`
--    trailing the key made the window read "an index-only range rather than a filter". It does not.
--    The budget matches a purpose FAMILY, not a purpose — `purpose = :family OR purpose LIKE
--    :family || ':%'` — because owner consent appends the flat's fingerprint and a counter keyed on
--    the whole string would re-arm every time the caller named a different flat. That predicate is
--    not an equality, so Postgres cannot use the column after it as a range bound in one scan, and
--    cannot take the ORDER BY from the index either: it reads every row for the caller and sorts.
--
--    Putting `created_at` immediately after the equality column restores both. `purpose` moves to
--    INCLUDE, where it is still available for the recheck without sitting between the key and the
--    range. Harmless at today's volumes; the point is that the index now matches its own comment.
DROP INDEX idx_otp_codes_requested_by;

CREATE INDEX idx_otp_codes_requested_by
    ON otp_codes (requested_by, created_at)
    INCLUDE (purpose)
    WHERE requested_by IS NOT NULL;
