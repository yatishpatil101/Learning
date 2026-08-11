-- V62 Q14: split the owner-edit re-review into two outcomes.
--
-- Until now every foundation-field edit called Property.revertToPending(), so the listing left
-- search until a moderator re-approved it. That is the right answer for an edit that changes what
-- the listing fundamentally *is* — locality, propertyType, bhk, deal — because a stale index entry
-- would then be actively wrong: a 2BHK appearing under 3BHK, or a rental under sale, is a wrong
-- answer rather than a slightly late one.
--
-- It is the wrong answer for price, furnishing and possession. Those change an attribute of a
-- listing that is still the same property, so the worst case is a briefly out-of-date number on a
-- listing that is still genuinely what it claims to be. The fraud risk is handled by the re-check
-- either way; the only difference is whether the listing earns while it waits — and a marketplace
-- that takes a listing dark for a day every time its price moves has taught owners not to move it.
--
-- So those three edits now raise a work item *without* touching `status`. The column pair is
-- deliberately shaped like flag_reason/status: the timestamp is the queue entry (and its age is the
-- SLA), the reason is what the moderator reads. Nullable with no default, so every existing row
-- starts with no pending re-check — correct, since none has been raised yet.

ALTER TABLE properties ADD COLUMN recheck_requested_at timestamptz;
ALTER TABLE properties ADD COLUMN recheck_reason text;

-- Partial index: the queue read is "the rows with one", which on a healthy platform is a small
-- minority of the table. Indexing only those keeps it that size regardless of how big `properties`
-- gets, and costs nothing on the writes that leave the column null.
CREATE INDEX idx_properties_recheck_pending
    ON properties (recheck_requested_at)
 WHERE recheck_requested_at IS NOT NULL;

COMMENT ON COLUMN properties.recheck_requested_at IS
    'Set when an owner edits a stays-live foundation field (price/furnishing/possession) on a '
    'listing that is publicly visible. The listing remains approved and searchable; this is the '
    'moderation work item, and its age is the SLA. Cleared when a moderator sets a status on the '
    'listing, and by revertToPending() — a full re-moderation supersedes a re-check (Q14).';

COMMENT ON COLUMN properties.recheck_reason IS
    'Human-readable list of the fields that raised the pending re-check, e.g. "price, furnishing". '
    'Accumulates across edits until a moderator clears it, so a moderator who arrives after three '
    'edits sees all three rather than only the last (Q14).';
