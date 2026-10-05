-- V75 moved posts back to `pending` without clearing their re-check markers. A post that is not public
-- carries no re-check (ModerationRecheck.settle), otherwise it is queued on both the Publish and the
-- Re-check boards at once.
UPDATE flatmate_rooms  SET recheck_requested_at = NULL, recheck_reason = NULL
 WHERE recheck_requested_at IS NOT NULL AND mod_status NOT IN ('live', 'approved');
UPDATE flatmate_groups SET recheck_requested_at = NULL, recheck_reason = NULL
 WHERE recheck_requested_at IS NOT NULL AND mod_status NOT IN ('live', 'approved');
