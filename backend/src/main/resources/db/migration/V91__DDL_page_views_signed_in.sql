-- Whether a page view came from a signed-in session, held apart from who it was. `user_id` is now
-- written only for visitors who accepted analytics cookies, so it can no longer stand in for
-- "signed in" in the anonymous-vs-signed-in reports; this column can, and an erasure leaves it alone.
ALTER TABLE page_views ADD COLUMN signed_in boolean NOT NULL DEFAULT false;

UPDATE page_views SET signed_in = true WHERE user_id IS NOT NULL;

COMMENT ON COLUMN page_views.signed_in IS
    'True when the viewer was signed in. Feeds the signed-in/anonymous splits; names nobody.';
