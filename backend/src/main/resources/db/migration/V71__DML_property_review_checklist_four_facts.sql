WITH target_reviews AS (
    SELECT id
    FROM property_reviews
    WHERE decided_at IS NULL
       OR status IN ('pending', 'needs_info')
),
deleted AS (
    DELETE FROM property_review_checklist c
    USING target_reviews t
    WHERE c.review_id = t.id
)
INSERT INTO property_review_checklist (id, review_id, item, pass)
SELECT gen_random_uuid(), t.id, item, false
FROM target_reviews t
CROSS JOIN (VALUES
    ('Photos are real and match the listing'),
    ('Not a duplicate of another listing'),
    ('Lister is the owner or family, not a broker'),
    ('Details and location look right')
) facts(item);
