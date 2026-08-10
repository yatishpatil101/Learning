-- V41 — flatmate posts are moderated before they are public (D72).
--
-- Until now a seeker post, a room or a group appeared on a `security: []` board the instant it was
-- written. Every other public-facing thing a user writes on this platform — a listing, a review —
-- passes a moderator first. The board is free-text `title`, `note` and `locality`, which is exactly
-- where a broker puts a phone number to route around the contact rules, so the moderation queue was
-- a cleanup crew arriving after the harm rather than a gate in front of it.
--
-- Three changes, in dependency order:
--
--   1. Allow `pending` in the CHECK constraints.
--   2. Make it the column default, so a row inserted by any path — the API, a fixture, a support
--      script — starts unvetted. The application default in the entity says the same thing; this is
--      the guarantee, that one is the message.
--   3. Rewrite the three feed indexes to match the queries, which switched from a blacklist
--      (`NOT IN ('flagged','removed','rejected')`) to a whitelist (`IN ('live','approved')`). The
--      index predicate has to be at least as permissive as the query predicate for PostgreSQL to
--      use it, and — more to the point — a partial index still describing the old rule is a
--      standing invitation to write the old rule back.
--
-- Existing rows are NOT migrated to `pending`. They say `live` and they were published under the
-- rule in force at the time; sweeping the whole board into a queue would take down honest supply to
-- punish people for a policy they could not have known about. Backfilling is a moderation decision,
-- not a schema one.

-- ---------------------------------------------------------------------------------------------
-- 1 + 2. Seeker posts
-- ---------------------------------------------------------------------------------------------
ALTER TABLE flatmate_seeker_posts
    DROP CONSTRAINT flatmate_seeker_posts_mod_status_check;
ALTER TABLE flatmate_seeker_posts
    ADD CONSTRAINT flatmate_seeker_posts_mod_status_check
        CHECK (mod_status IN ('pending','live','approved','flagged','removed','rejected'));
ALTER TABLE flatmate_seeker_posts
    ALTER COLUMN mod_status SET DEFAULT 'pending';

DROP INDEX IF EXISTS idx_flatmate_seeker_posts_feed;
CREATE INDEX idx_flatmate_seeker_posts_feed
    ON flatmate_seeker_posts (created_at DESC)
    WHERE archived = false AND mod_status IN ('live','approved');

-- The moderation queue's own read: oldest first, so the person who has waited longest is served
-- first. Partial on `pending` because the queue is the only caller and the table is dominated by
-- rows that have already been decided.
CREATE INDEX idx_flatmate_seeker_posts_pending
    ON flatmate_seeker_posts (created_at)
    WHERE mod_status = 'pending' AND archived = false;

-- ---------------------------------------------------------------------------------------------
-- Rooms
-- ---------------------------------------------------------------------------------------------
ALTER TABLE flatmate_rooms
    DROP CONSTRAINT flatmate_rooms_mod_status_check;
ALTER TABLE flatmate_rooms
    ADD CONSTRAINT flatmate_rooms_mod_status_check
        CHECK (mod_status IN ('pending','live','approved','flagged','removed','rejected'));
ALTER TABLE flatmate_rooms
    ALTER COLUMN mod_status SET DEFAULT 'pending';

DROP INDEX IF EXISTS idx_flatmate_rooms_feed;
CREATE INDEX idx_flatmate_rooms_feed
    ON flatmate_rooms (created_at DESC)
    WHERE archived = false AND mod_status IN ('live','approved');

CREATE INDEX idx_flatmate_rooms_pending
    ON flatmate_rooms (created_at)
    WHERE mod_status = 'pending' AND archived = false;

-- ---------------------------------------------------------------------------------------------
-- Groups
-- ---------------------------------------------------------------------------------------------
ALTER TABLE flatmate_groups
    DROP CONSTRAINT flatmate_groups_mod_status_check;
ALTER TABLE flatmate_groups
    ADD CONSTRAINT flatmate_groups_mod_status_check
        CHECK (mod_status IN ('pending','live','approved','flagged','removed','rejected'));
ALTER TABLE flatmate_groups
    ALTER COLUMN mod_status SET DEFAULT 'pending';

DROP INDEX IF EXISTS idx_flatmate_groups_feed;
CREATE INDEX idx_flatmate_groups_feed
    ON flatmate_groups (created_at DESC)
    WHERE archived = false AND mod_status IN ('live','approved');

CREATE INDEX idx_flatmate_groups_pending
    ON flatmate_groups (created_at)
    WHERE mod_status = 'pending' AND archived = false;

-- ---------------------------------------------------------------------------------------------
-- Group applications keep `live` as their default.
--
-- Deliberate, not an oversight: an application is a private message from one person to one host,
-- not a public post. `mod_status` there exists so an admin can remove spam, and defaulting it to
-- `pending` would mean a host could not see who had applied until a moderator got round to it —
-- which is a worse outcome than the problem this migration is solving.
-- ---------------------------------------------------------------------------------------------
COMMENT ON COLUMN flatmate_group_applications.mod_status IS
    'Admin spam axis on a private application. Defaults to live, unlike the public flatmate '
    'surfaces (V41/D72), because an application is addressed to one host rather than published.';
