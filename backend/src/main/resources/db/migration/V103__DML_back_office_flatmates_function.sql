-- Flatmate moderation left the reports function; current holders keep it.
UPDATE back_office_permissions
SET permissions = permissions || '["flatmates"]'::jsonb,
    updated_at = now()
WHERE permissions @> '["reports"]'::jsonb
  AND NOT permissions @> '["flatmates"]'::jsonb;
