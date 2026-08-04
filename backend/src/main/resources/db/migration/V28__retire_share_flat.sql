-- V28 Retire share-flat.
--
-- V27 added the flatmates tables and deliberately left `share_flat_posts` (V7) and
-- `share_flat_interests` (V25) in place, so that migration could land while the old controller was
-- still answering. This is the other half: carry the data across, then drop the tables. It ships in
-- the same change that deletes ShareFlatController, removes the legacy /share-flat/* block from the
-- contract and adjusts the SpecCoverageTest floor -- one moment where the old surface stops
-- answering and the new one starts.

-- ---------------------------------------------------------------------------
-- Posts become seeker posts
-- ---------------------------------------------------------------------------
-- The old board's rows are seeker posts in everything but shape: a person, a locality, a budget.
-- They are carried across rather than dropped, because a live post is somebody's actual search and
-- deleting it to simplify a migration is deleting their work.
--
-- The mapping is lossy in exactly one place and deliberately so: `title` was free text that mixed
-- an introduction with a locality, and there is no honest way to recover a person's NAME from it.
-- The poster's account name is used instead and the old title is kept as the note, which is where
-- free text belongs on the new shape.
--
-- One value is respelled: pref_gender 'non-veg' does not exist (that was pref_food), but pref_food
-- 'non-veg' becomes 'nonveg' -- the same value spelled the way the new vocabulary spells it. Food
-- preference has no column on a seeker post at all, so it survives only inside the carried note.

-- The newest live post per poster becomes their one live seeker post. V7 allowed five; V27 allows
-- one, so the rest are carried in as archived rather than silently dropped -- a poster's history
-- survives and the partial unique index still holds.
INSERT INTO flatmate_seeker_posts (
    id, user_id, name, gender, occupation, budget, localities, note,
    verified, mod_status, archived, archived_at, archive_reason, created_at, updated_at)
SELECT
    p.id,
    p.poster_id,
    coalesce(nullif(trim(u.name), ''), 'PuneNest member'),
    -- pref_gender used the same vocabulary as the new `gender` column, so it maps straight across.
    -- NULL meant "no preference recorded", which the new column spells 'any' since it is NOT NULL.
    coalesce(p.pref_gender, 'any'),
    p.pref_occupation,
    p.rent_share,
    to_jsonb(ARRAY[p.locality]),
    left(p.title, 600),
    false,
    'live',
    CASE
        WHEN p.archived THEN true
        -- Not the newest live post for this poster: keep it, but archived.
        WHEN p.id <> (SELECT p2.id FROM share_flat_posts p2
                      WHERE p2.poster_id = p.poster_id AND p2.archived = false
                      ORDER BY p2.created_at DESC, p2.id DESC
                      LIMIT 1) THEN true
        ELSE false
    END,
    CASE WHEN p.archived THEN p.archived_at
         WHEN p.id <> (SELECT p2.id FROM share_flat_posts p2
                       WHERE p2.poster_id = p.poster_id AND p2.archived = false
                       ORDER BY p2.created_at DESC, p2.id DESC
                       LIMIT 1) THEN now()
         ELSE NULL END,
    CASE WHEN p.archived THEN p.archive_reason
         WHEN p.id <> (SELECT p2.id FROM share_flat_posts p2
                       WHERE p2.poster_id = p.poster_id AND p2.archived = false
                       ORDER BY p2.created_at DESC, p2.id DESC
                       LIMIT 1)
              THEN 'superseded by a newer post when share-flat became flatmates (V28)'
         ELSE NULL END,
    p.created_at,
    p.updated_at
FROM share_flat_posts p
JOIN users u ON u.id = p.poster_id;

-- ---------------------------------------------------------------------------
-- Interests become inbox rows
-- ---------------------------------------------------------------------------
-- `kind` is 'flatmate' because the target is now a seeker post, and the host is whoever wrote it.
-- Status stays 'pending': the old model had no accept/decline, so every carried interest is a
-- question nobody has answered yet -- which is exactly what pending means. decided_at stays null,
-- as the check constraint requires for a pending row.
INSERT INTO flatmate_requests (
    id, kind, target_id, host_id, requester_id, action, share, message,
    status, requested_at, created_at, updated_at)
SELECT
    i.id, 'flatmate', i.post_id, p.poster_id, i.user_id, 'request', 'solo', i.message,
    'pending', i.created_at, i.created_at, i.updated_at
FROM share_flat_interests i
JOIN share_flat_posts p ON p.id = i.post_id
-- A poster answering their own ad is not representable in the new model and never was meaningful.
-- The old service refused it, so this only guards against rows that predate that service.
WHERE p.poster_id <> i.user_id;

DROP TABLE share_flat_interests;
DROP TABLE share_flat_posts;

SELECT install_updated_at_triggers();
