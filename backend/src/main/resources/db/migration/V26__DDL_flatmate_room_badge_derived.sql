-- The room trust badge was stored as well as derived, and the two could disagree.
-- `verified` was written once, at post time, from the tier that had just been computed. Nothing
-- wrote it again: `FlatmateReview.reopenAfterEdit` sends an edited post back to pending but had no
-- way to reach the room row, so an edited listing kept a `true` its verdict had already lost --
-- still passing the "Verified only" filter with its card badge gone.
--
-- Every writer set it to exactly `verification_tier = 'owner'` (the split path spelled this
-- `parent.status = 'approved'`, which is the same thing: it derives the tier from that test one
-- line earlier). So the column never carried a fact of its own, and the badge is now read the way
-- flatmate_groups already reads it -- tier, plus the standing review verdict -- which cannot
-- outlive the verdict because it is the verdict.
--
-- flatmate_posts.verified and flatmate_group_members.verified are untouched: those are the
-- person's identity badge from users.verified, a different claim about a different subject.
ALTER TABLE flatmate_rooms DROP COLUMN verified;

COMMENT ON COLUMN flatmate_rooms.verification_tier IS
    'How far the host''s claim on this flat has been checked: identity < tenant < owner. Derived server-side and never accepted from a client. The Verified badge is read from this plus the flatmate_reviews verdict, never stored -- a stored badge outlives the verdict that earned it.';
