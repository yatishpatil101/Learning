-- Listing progress is derived from these facts (ListingProgress); the stage columns that restated
-- them are dropped so no two writers can disagree.
ALTER TABLE properties
    ADD COLUMN claim_link_sent_at timestamptz,
    ADD COLUMN owner_confirmed_at timestamptz,
    ADD COLUMN review_started_at timestamptz,
    ADD COLUMN info_requested_at timestamptz;

UPDATE properties SET claim_link_sent_at = coalesce(claim_link_opened_at, updated_at)
WHERE posted_by_admin
  AND (lifecycle_stage IN ('link_sent', 'opened') OR handback_milestone IN ('claim_sent', 'claimed')
       OR claim_link_opened_at IS NOT NULL);

-- Already-published staff listings are grandfathered so a relist or re-review is not newly blocked.
UPDATE properties SET owner_confirmed_at = coalesce(claim_link_opened_at, updated_at)
WHERE posted_by_admin AND (handback_milestone = 'claimed' OR status IN ('approved', 'paused', 'sold', 'rented', 'flagged'));

-- A listing sent back to pending without reopening its review still carries the old approval, which
-- blocks every desk decision but approve and shows the owner "Live".
WITH reopened AS (
    UPDATE property_reviews r SET status = 'pending', decided_at = NULL, reason_code = NULL
    FROM properties p
    WHERE r.property_id = p.id AND p.status = 'pending' AND NOT p.archived AND r.status = 'approved'
    RETURNING r.id
)
UPDATE property_review_checklist c SET pass = false, checked_by = NULL, checked_at = NULL
WHERE c.review_id IN (SELECT id FROM reopened);

UPDATE properties SET review_started_at = updated_at
WHERE status = 'pending' AND NOT archived AND lifecycle_stage IN ('in_review', 'clarification', 'verified');

UPDATE properties p SET info_requested_at = r.needs_info_at, review_started_at = coalesce(p.review_started_at, r.needs_info_at)
FROM property_reviews r
WHERE r.property_id = p.id AND r.status = 'needs_info' AND r.needs_info_at IS NOT NULL
  AND p.status = 'pending' AND NOT p.archived;

-- Clarifications asked before reviews had a needs_info status live only in lifecycle_stage. A fresh
-- clock keeps the 14-day sweep from archiving them on the first run.
UPDATE properties SET info_requested_at = now()
WHERE status = 'pending' AND NOT archived AND lifecycle_stage = 'clarification' AND info_requested_at IS NULL;

UPDATE property_reviews r SET status = 'needs_info', reason_code = coalesce(r.reason_code, 'other')
FROM properties p
WHERE r.property_id = p.id AND p.info_requested_at IS NOT NULL AND r.status = 'pending';

ALTER TABLE property_reviews DROP COLUMN needs_info_at;

ALTER TABLE properties
    DROP COLUMN lifecycle_track,
    DROP COLUMN lifecycle_stage,
    DROP COLUMN lifecycle_verified_at,
    DROP COLUMN pipeline_stage,
    DROP COLUMN handback_milestone;

ALTER TABLE properties ADD CONSTRAINT properties_owner_confirm_staff_only
    CHECK (owner_confirmed_at IS NULL OR posted_by_admin);

CREATE INDEX idx_properties_info_requested ON properties (info_requested_at)
    WHERE info_requested_at IS NOT NULL;
