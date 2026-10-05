-- Functions never carry settings/finance/audit, so a converted admin document would lock the admin out.
DELETE FROM back_office_permissions p
USING users u
WHERE u.id = p.user_id AND u.role = 'admin';

-- Never widen: a function maps only when the old document held every one of its atoms. identity:write was
-- admin-only before this, so no staff document maps to kyc.
WITH old_entries AS (
    SELECT p.user_id, u.team, jsonb_array_elements_text(p.permissions) AS atom
    FROM back_office_permissions p
    JOIN users u ON u.id = p.user_id
),
required(function_name, atom) AS (
    VALUES
        ('kyc', 'identity:read'), ('kyc', 'identity:write'), ('kyc', 'users:read'),
        ('propertyVerification', 'properties:read'), ('propertyVerification', 'properties:write'),
        ('listingModeration', 'properties:read'), ('listingModeration', 'properties:write'),
        ('postOnBehalf', 'postOnBehalf:write'), ('postOnBehalf', 'properties:read'),
        ('support', 'tickets:read'), ('support', 'tickets:write'), ('support', 'enquiries:read'),
        ('support', 'notes:read'), ('support', 'notes:write'),
        ('content', 'content:read'), ('content', 'content:write'),
        ('content', 'societies:read'), ('content', 'societies:write'),
        ('reports', 'reports:read'), ('reports', 'reports:write'),
        ('reports', 'flatmates:read'), ('reports', 'flatmates:write')
),
mapped AS (
    SELECT e.user_id, r.function_name
    FROM old_entries e
    JOIN required r ON r.atom = e.atom
    GROUP BY e.user_id, r.function_name
    HAVING count(DISTINCT e.atom) = (SELECT count(*) FROM required r2 WHERE r2.function_name = r.function_name)
    UNION ALL
    SELECT user_id, 'desk:' || team FROM old_entries
    WHERE atom IN ('services:read', 'services:write')
      AND team IN ('rental', 'legal', 'loans', 'interior', 'packers', 'valuation')
    GROUP BY user_id, team
    HAVING count(DISTINCT atom) = 2
),
ordered(function_name, sort_order) AS (
    VALUES
        ('kyc', 10),
        ('propertyVerification', 20),
        ('listingModeration', 30),
        ('postOnBehalf', 40),
        ('desk:rental', 50),
        ('desk:legal', 60),
        ('desk:loans', 70),
        ('desk:interior', 80),
        ('desk:packers', 90),
        ('desk:valuation', 100),
        ('support', 110),
        ('content', 120),
        ('reports', 130)
),
collapsed AS (
    SELECT p.user_id,
           COALESCE(jsonb_agg(to_jsonb(o.function_name) ORDER BY o.sort_order)
                    FILTER (WHERE o.function_name IS NOT NULL), '[]'::jsonb) AS functions
    FROM back_office_permissions p
    LEFT JOIN (SELECT DISTINCT user_id, function_name FROM mapped) m ON m.user_id = p.user_id
    LEFT JOIN ordered o ON o.function_name = m.function_name
    GROUP BY p.user_id
)
UPDATE back_office_permissions p
SET permissions = collapsed.functions,
    updated_at = now()
FROM collapsed
WHERE collapsed.user_id = p.user_id;

WITH ordered(function_name, sort_order) AS (
    VALUES
        ('kyc', 10),
        ('propertyVerification', 20),
        ('listingModeration', 30),
        ('postOnBehalf', 40),
        ('desk:rental', 50),
        ('desk:legal', 60),
        ('desk:loans', 70),
        ('desk:interior', 80),
        ('desk:packers', 90),
        ('desk:valuation', 100),
        ('support', 110),
        ('content', 120),
        ('reports', 130)
),
staff_functions AS (
    SELECT u.id AS user_id,
           jsonb_agg(to_jsonb(o.function_name) ORDER BY o.sort_order) AS functions
    FROM users u
    JOIN ordered o ON o.function_name IN (
        'propertyVerification',
        'listingModeration',
        'postOnBehalf',
        'support',
        'content',
        'reports',
        'desk:' || u.team
    )
    WHERE u.role = 'staff'
      AND NOT u.archived
      AND NOT EXISTS (
          SELECT 1 FROM back_office_permissions p WHERE p.user_id = u.id
      )
    GROUP BY u.id
)
INSERT INTO back_office_permissions (user_id, permissions, updated_by)
SELECT user_id, functions, NULL
FROM staff_functions;

COMMENT ON COLUMN back_office_permissions.permissions IS
    'JSON array of back-office function names from security/BackOfficeFunctions. Effective atoms are derived per request.';
