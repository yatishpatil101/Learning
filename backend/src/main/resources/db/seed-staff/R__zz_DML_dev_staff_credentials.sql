-- Dev-only staff and admin credentials: email <mobile>@staff.draazy.test, password Draazy-dev-pass1,
-- and an authenticator already enrolled with base32 secret JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP
-- (add it to any authenticator app). totp_secret is that secret sealed under the DEV default of
-- draazy.security.staff-totp-key, so it only decrypts on a backend running that default.
-- e2e also sets draazy.staff-totp.fixed-code, so 000000 passes there.

-- Probe account for e2e/tests/admin/staff-two-factor.spec.js, which resets its authenticator.
INSERT INTO public.users (id, name, mobile, role, team, status, city, mobile_verified, verified,
        verified_contact_only, listings_count, archived, joined_at, created_at, updated_at)
VALUES ('5f0c2a7e-2fa0-4c1e-9b7a-000000000101', 'Two-factor Probe', '9000000101', 'staff', 'rental',
        'active', 'Pune', true, false, false, 0, false, now(), now(), now())
ON CONFLICT DO NOTHING;

UPDATE public.users
SET email = mobile || '@staff.draazy.test',
    password_hash = '$2a$10$draazydevseedsaltxxxxu.IHIO355E/GQecxVh1.7kn8soC22rq.'
WHERE role IN ('staff', 'manager', 'admin')
  AND NOT archived
  AND (email IS NULL OR email = mobile || '@staff.draazy.test');

INSERT INTO public.staff_credentials (user_id, totp_secret, totp_confirmed_at, totp_last_step,
        recovery_code_hashes, failed_attempts, locked_until)
SELECT id, 'ZHJhenp5c2VlZGl2kjiW7HhFLGWsDs5pYgMuPIdqgDDibi1BB9R0sIw4wO9S/0My', now(), NULL,
       '[]'::jsonb, 0, NULL
FROM public.users
WHERE email LIKE '%@staff.draazy.test'
ON CONFLICT (user_id) DO UPDATE
SET totp_secret = EXCLUDED.totp_secret,
    totp_confirmed_at = EXCLUDED.totp_confirmed_at,
    totp_last_step = NULL,
    recovery_code_hashes = '[]'::jsonb,
    failed_attempts = 0,
    locked_until = NULL;

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
    FROM public.users u
    JOIN ordered o ON o.function_name IN (
        'kyc',
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
    GROUP BY u.id
)
INSERT INTO public.back_office_permissions (user_id, permissions, updated_by)
SELECT user_id, functions, NULL
FROM staff_functions
ON CONFLICT DO NOTHING;
