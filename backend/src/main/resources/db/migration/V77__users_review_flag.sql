-- An internal review flag on a user account, and the provenance to make it accountable.
--
-- WHAT THIS ADDS, AND WHY IT DID NOT EXIST. The admin console has offered "Flag user for review"
-- since it was written. There was no column behind it: the mock stored the flag in the browser's
-- own copy of the database, so the button worked perfectly for exactly as long as one operator sat
-- at one machine and never reloaded. Converting `/admin/users` onto the API forced the question of
-- whether the capability is real, and the answer is yes -- it is how a moderator parks an account
-- that looks wrong but is not yet actionable, so the next person to look at the directory inherits
-- the suspicion instead of rediscovering it.
--
-- WHY A REASON IS MANDATORY, ENFORCED HERE AND NOT ONLY IN JAVA. A flag with no reason is worse
-- than no flag: the next moderator sees a marked account, cannot tell what was noticed, and either
-- clears it (losing whatever was seen) or leaves it (a permanent smear nobody can act on). The
-- CHECK is phrased `flagged = false OR reason present` so that clearing a flag is not obliged to
-- invent a reason, and so that the invariant survives any future write path that forgets it -- the
-- application check is the good error message, this is the guarantee.
--
-- WHY `flagged_by` IS `ON DELETE SET NULL` AND NOT `CASCADE`. Users are never hard-deleted on this
-- platform (`SoftDeleteEntity`; DPDP erasure pseudonymises and archives rather than DELETEs), so in
-- practice neither branch fires. It is SET NULL because the two facts are independent: that an
-- account was flagged is a moderation fact about the flagged account, and it must not evaporate
-- because the colleague who raised it later left. CASCADE would delete the flag along with the
-- flagger, which is exactly backwards.
--
-- WHY THERE IS NO CORRESPONDING COLUMN FOR THE VERIFIED BADGE. `PATCH /users/{id}/badge` grants the
-- L2 badge by hand, and the obvious instinct is to record who granted it and why, next to it. That
-- would duplicate `audit_log`, which already carries actor, action, entity, entity_id, timestamp and
-- metadata for every back-office write, and which V77's sibling change makes queryable by
-- entity_id. The flag columns are here because they are *state the product reads* -- the directory
-- renders them, the filter selects on them. Provenance that only an auditor reads belongs in the
-- audit log, and having it in two places means having it disagree with itself.
--
-- WHY THE INDEX IS PARTIAL. Flagged accounts are meant to be rare; a full index on a boolean that
-- is false for essentially every row is bytes the planner will not use. `WHERE flagged = true`
-- indexes only the rows the "show me flagged accounts" filter is looking for.

ALTER TABLE users ADD COLUMN flagged     boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN flag_reason text;
ALTER TABLE users ADD COLUMN flagged_at  timestamptz;
ALTER TABLE users ADD COLUMN flagged_by  uuid REFERENCES users (id) ON DELETE SET NULL;

ALTER TABLE users ADD CONSTRAINT users_flag_reason_check
    CHECK (flagged = false OR (flag_reason IS NOT NULL AND length(trim(flag_reason)) > 0));

CREATE INDEX idx_users_flagged ON users (flagged) WHERE flagged = true;

COMMENT ON COLUMN users.flagged IS
    'Internal moderation marker. Never rendered to the account holder or to any consumer surface; '
    'it is a note between back-office colleagues, not a status the platform acts on.';
COMMENT ON COLUMN users.flag_reason IS
    'What was noticed. Mandatory whenever flagged is true (users_flag_reason_check).';

-- The `suspended` state has been in users_status_check since V2 and nothing has ever written it.
-- `PATCH /users/{id}/suspend` does now, so record what the three values mean, because the
-- distinction between the two non-active ones is not self-evident from the names.
COMMENT ON COLUMN users.status IS
    'active | suspended | archived. suspended: the account still exists and still appears in the '
    'directory, but cannot obtain a session -- a reversible moderation state. archived: soft '
    'deleted, hidden from the default directory, and set by PATCH /users/{id}/archive, which also '
    'sets the archived flag that every read path filters on. The two are independent columns and a '
    'row may legitimately be both.';
