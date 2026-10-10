-- Each new function was split out of a broader one; current holders keep the access they had.
WITH carry(from_fn, to_fn) AS (
    VALUES
        ('reports', 'referrals'),
        ('listingModeration', 'localities'),
        ('listingModeration', 'reviews'),
        ('support', 'enquiries'),
        ('content', 'societies')
),
added AS (
    SELECT p.user_id, jsonb_agg(DISTINCT to_jsonb(c.to_fn)) AS extra
    FROM back_office_permissions p
    JOIN carry c
      ON p.permissions @> jsonb_build_array(c.from_fn)
     AND NOT p.permissions @> jsonb_build_array(c.to_fn)
    GROUP BY p.user_id
)
UPDATE back_office_permissions p
SET permissions = p.permissions || added.extra,
    updated_at = now()
FROM added
WHERE added.user_id = p.user_id;
