-- Flatmate edits re-moderate on WHO the host is; property edits re-moderate on WHAT changed.
--
-- `FlatmatePublication.reapplyAfterEdit` recomputed `stateFor(tier, flagged)` and nothing else, so
-- the edit was judged entirely by the tier ladder. A live tenant-tier room could have its twelve
-- photos, its free-text note and its rent wholly replaced and stay live unchecked, while an
-- identity-tier post went dark for a typo. `properties` settled this argument in V62 and the
-- columns below are the same pair, for the same reason: the timestamp is the queue entry (and its
-- age is the SLA), the reason is what the moderator reads.
--
-- Nullable with no default, so every existing row starts with no pending re-check -- correct, since
-- none has been raised yet, and a backfill would invent a queue out of history nobody reviewed.
ALTER TABLE flatmate_rooms
    ADD COLUMN recheck_requested_at timestamptz,
    ADD COLUMN recheck_reason       text;

ALTER TABLE flatmate_groups
    ADD COLUMN recheck_requested_at timestamptz,
    ADD COLUMN recheck_reason       text;

ALTER TABLE flatmate_seeker_posts
    ADD COLUMN recheck_requested_at timestamptz,
    ADD COLUMN recheck_reason       text;

-- Partial, on V62's reasoning: the queue read is "the rows with one", which on a healthy platform
-- is a small minority of each table. Indexing only those keeps the index that size however large
-- the table gets, and costs nothing on the writes that leave the column null.
CREATE INDEX idx_flatmate_rooms_recheck_pending
    ON flatmate_rooms (recheck_requested_at)
 WHERE recheck_requested_at IS NOT NULL;

CREATE INDEX idx_flatmate_groups_recheck_pending
    ON flatmate_groups (recheck_requested_at)
 WHERE recheck_requested_at IS NOT NULL;

CREATE INDEX idx_flatmate_seeker_posts_recheck_pending
    ON flatmate_seeker_posts (recheck_requested_at)
 WHERE recheck_requested_at IS NOT NULL;

COMMENT ON COLUMN flatmate_rooms.recheck_requested_at IS
    'Set when a host edits a stays-live field -- photos, note, rent, address, furnishing, '
    'availability -- on a room a stranger can already see. The room stays visible; this is the '
    'moderation work item, and its age is the SLA. Cleared when a moderator sets a mod_status, and '
    'whenever an edit sends the room back to pending: a full re-moderation supersedes a re-check.';

COMMENT ON COLUMN flatmate_rooms.recheck_reason IS
    'Human-readable list of the fields that raised the pending re-check, e.g. "photos, note". '
    'Accumulates across edits until a moderator clears it, so a moderator arriving after three '
    'edits sees all three rather than only the last.';

COMMENT ON COLUMN flatmate_groups.recheck_requested_at IS
    'As flatmate_rooms.recheck_requested_at, for a group: raised by an edit to the title, the note, '
    'the rent or the lifestyle tags on a group that is already on the board.';

COMMENT ON COLUMN flatmate_groups.recheck_reason IS
    'As flatmate_rooms.recheck_reason.';

COMMENT ON COLUMN flatmate_seeker_posts.recheck_requested_at IS
    'As flatmate_rooms.recheck_requested_at, for a seeker post: raised by an edit to the name, the '
    'note or the budget. A post has no address and no host tier, so the free text is the whole of '
    'what a moderator re-reads -- and before this column a new note went straight through.';

COMMENT ON COLUMN flatmate_seeker_posts.recheck_reason IS
    'As flatmate_rooms.recheck_reason.';
