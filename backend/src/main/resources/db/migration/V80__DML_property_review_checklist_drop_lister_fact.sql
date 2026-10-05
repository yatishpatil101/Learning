DELETE FROM property_review_checklist c
USING property_reviews r
WHERE c.review_id = r.id
  AND c.item = 'Lister is the owner or family, not a broker'
  AND (r.decided_at IS NULL OR r.status IN ('pending', 'needs_info'));
