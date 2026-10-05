-- A flatmate post stays on the board for 30 days from its last host write, then drops to `expired`
-- (owner dashboard only) until renewed. `active_until` is its own column because `updated_at` is
-- bumped by every write, including the sweep's own reminder flag.
-- `expired_from` remembers `live` vs `approved`, so a renew does not invent or erase a moderator's read.
-- Existing posts start a full 30 days from this migration (the column default): backfilling from
-- updated_at would need an UPDATE, which the set_updated_at trigger turns into a fresh edit anyway.
ALTER TABLE flatmate_rooms
    ADD COLUMN active_until timestamptz NOT NULL DEFAULT now() + interval '30 days',
    ADD COLUMN expiry_reminded boolean NOT NULL DEFAULT false,
    ADD COLUMN expired_from text CHECK (expired_from IN ('live', 'approved')),
    DROP CONSTRAINT flatmate_rooms_mod_status_check,
    ADD CONSTRAINT flatmate_rooms_mod_status_check
        CHECK (mod_status IN ('pending','live','approved','flagged','removed','rejected','expired'));

ALTER TABLE flatmate_groups
    ADD COLUMN active_until timestamptz NOT NULL DEFAULT now() + interval '30 days',
    ADD COLUMN expiry_reminded boolean NOT NULL DEFAULT false,
    ADD COLUMN expired_from text CHECK (expired_from IN ('live', 'approved')),
    DROP CONSTRAINT flatmate_groups_mod_status_check,
    ADD CONSTRAINT flatmate_groups_mod_status_check
        CHECK (mod_status IN ('pending','live','approved','flagged','removed','rejected','expired'));

ALTER TABLE flatmate_seeker_posts
    ADD COLUMN active_until timestamptz NOT NULL DEFAULT now() + interval '30 days',
    ADD COLUMN expiry_reminded boolean NOT NULL DEFAULT false,
    ADD COLUMN expired_from text CHECK (expired_from IN ('live', 'approved')),
    DROP CONSTRAINT flatmate_seeker_posts_mod_status_check,
    ADD CONSTRAINT flatmate_seeker_posts_mod_status_check
        CHECK (mod_status IN ('pending','live','approved','flagged','removed','rejected','expired'));

CREATE INDEX idx_flatmate_rooms_active_until ON flatmate_rooms (active_until)
    WHERE archived = false AND mod_status IN ('live','approved');
CREATE INDEX idx_flatmate_groups_active_until ON flatmate_groups (active_until)
    WHERE archived = false AND mod_status IN ('live','approved');
CREATE INDEX idx_flatmate_seeker_posts_active_until ON flatmate_seeker_posts (active_until)
    WHERE archived = false AND mod_status IN ('live','approved');
