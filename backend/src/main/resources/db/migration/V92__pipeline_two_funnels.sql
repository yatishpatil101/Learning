-- D27 — two funnels, one column.
--
-- V3 gave properties a single `pipeline_stage` holding six values:
--   listed, docs_submitted, photos_uploaded, aadhaar_verified, claim_sent, claimed
-- The admin console shipped a board holding six *different* values:
--   contacted, info_collected, listed, docs_submitted, under_review, live
-- They agree on two. That is not a naming disagreement, it is two different questions sharing one
-- column. The first four console values answer "how far has this owner got towards us having a
-- listing at all"; the server's last four answer "how far have we got towards giving the listing
-- back". A row can be at a point on both axes at once — a listing whose documents are in and whose
-- photographs are up is `docs_submitted` on one and `photos_uploaded` on the other — and one column
-- cannot hold both, so whichever question got written last silently erased the other.
--
-- This migration splits them.
--
--   pipeline_stage      -> the acquisition funnel: contacted, info_collected, listed, docs_submitted
--   handback_milestone  -> the hand-back axis:     photos_uploaded, aadhaar_verified, claim_sent, claimed
--
-- The console's remaining two columns, `under_review` and `live`, are deliberately NOT added to
-- either. They are `status` under different names, and a row that carried both would have two
-- opinions about whether it is public — see PipelineStage's class javadoc, which has argued this
-- since V3. The board keeps showing six columns; it derives the last two from `status`.
--
-- Backfill. Rows already holding one of the four hand-back values are moved to the new column and
-- their acquisition stage set to `docs_submitted`, which is where the acquisition funnel ends and
-- is the only stage from which a hand-back can have started. Nothing is lost: the ordering within
-- each axis is preserved, and a row that had reached `claim_sent` still reports claimLinkSent.

ALTER TABLE properties ADD COLUMN handback_milestone text;

-- Move the four hand-back values off pipeline_stage before the new constraint would refuse them.
UPDATE properties
   SET handback_milestone = pipeline_stage,
       pipeline_stage     = 'docs_submitted'
 WHERE pipeline_stage IN ('photos_uploaded','aadhaar_verified','claim_sent','claimed');

-- V3 declared the CHECK inline and unnamed, so Postgres generated this name for it.
ALTER TABLE properties DROP CONSTRAINT properties_pipeline_stage_check;

ALTER TABLE properties ADD CONSTRAINT properties_pipeline_stage_check
    CHECK (pipeline_stage IN ('contacted','info_collected','listed','docs_submitted'));

ALTER TABLE properties ADD CONSTRAINT properties_handback_milestone_check
    CHECK (handback_milestone IN ('photos_uploaded','aadhaar_verified','claim_sent','claimed'));

-- A hand-back cannot be under way on a listing that does not exist yet. The acquisition funnel must
-- have reached `listed` at minimum before there is anything to give back, so the two axes are not
-- fully independent and the database says so rather than leaving it to the service layer.
ALTER TABLE properties ADD CONSTRAINT properties_handback_needs_listing
    CHECK (handback_milestone IS NULL OR pipeline_stage IN ('listed','docs_submitted'));

-- Mirrors idx_properties_pipeline from V3: the board filters on this column for staff-posted rows
-- only, and every other row has it null.
CREATE INDEX idx_properties_handback ON properties (handback_milestone) WHERE posted_by_admin = true;

COMMENT ON COLUMN properties.pipeline_stage IS
    'D27 acquisition funnel: contacted -> info_collected -> listed -> docs_submitted. Null when the listing was never ours to onboard.';
COMMENT ON COLUMN properties.handback_milestone IS
    'D27 hand-back axis: photos_uploaded -> aadhaar_verified -> claim_sent -> claimed. Null until the hand-back starts.';
