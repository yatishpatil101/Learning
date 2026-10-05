-- Dev-only KYC desk fixtures: one case per review state so /ops/kyc-review can be clicked through.
-- Only application-local.properties lists db/seed-local; e2e and sandbox replace the location list.

WITH people(n, name, verified) AS (VALUES
    (1, 'Ananya Kulkarni', false), (2, 'Rohan Deshpande', false), (3, 'Meera Pawar', false),
    (4, 'Vikram Shinde', false), (5, 'Sneha Gokhale', false), (6, 'Arjun Patwardhan', false),
    (7, 'Pooja Bhosale', false), (8, 'Nikhil Jadhav', false), (9, 'Kavya Apte', false),
    (10, 'Siddharth More', false), (11, 'Tanvi Joshi', false), (12, 'Omkar Gaikwad', false),
    (13, 'Riya Sathe', true), (14, 'Aditya Kale', true), (15, 'Shruti Nair', true),
    (16, 'Harsh Mehta', true), (17, 'Neha Karve', true), (18, 'Yash Thakur', false),
    (19, 'Divya Ranade', false), (20, 'Kunal Bapat', false), (21, 'Prachi Mane', false))
INSERT INTO users (id, name, mobile, role, status, city, mobile_verified, verified, joined_at, created_at, updated_at)
SELECT ('f1c7c000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, name,
       '96100000' || lpad(n::text, 2, '0'), 'owner', 'active', 'Pune', true, verified,
       now() - interval '30 days', now() - interval '30 days', now()
  FROM people
ON CONFLICT DO NOTHING;

-- Ages trigger SLA warnings/overdue states while keeping images inside purge windows.
-- Case 12 shares verified case 16's document, so it shows the duplicate warning.
WITH staff(alias, id) AS (VALUES
    ('admin', 'e6621d3a-3e31-5022-a6c9-34a90c8f6e9b'::uuid),
    ('kabir', 'e427a0c0-65a6-5da4-bcba-0e50f64953a9'::uuid),
    ('rahul', '54408cbb-9bc0-5168-b535-67468be09c17'::uuid)),
cases(n, status, doc, last4, dob, age, liveness, pose, attempts, reviewer, decided_age,
      rejection, note, claimer, qa_sampled, qa_by, qa_outcome, revoker, revoke_reason, same_doc_as) AS (VALUES
    (1,  'pending',  'aadhaar',         '4821', '1990-04-12'::date, '76 hours'::interval, 'passed', 'smile', 1, NULL, NULL::interval, NULL, NULL, NULL, false, NULL, NULL, NULL, NULL, NULL::int),
    (2,  'pending',  'pan',             '7310', '1987-11-03', '54 hours',   'passed',      'left',  1, NULL,    NULL,       NULL,         NULL, 'kabir', false, NULL,    NULL,        NULL,    NULL, NULL),
    (3,  'pending',  'passport',        '2209', '1995-02-28', '30 hours',   'bypassed',    NULL,    1, NULL,    NULL,       NULL,         NULL, NULL,    false, NULL,    NULL,        NULL,    NULL, NULL),
    (4,  'pending',  'voter_id',        '6654', '1982-07-19', '27 hours',   'passed',      'right', 1, NULL,    NULL,       NULL,         NULL, NULL,    false, NULL,    NULL,        NULL,    NULL, NULL),
    (5,  'pending',  'driving_licence', '9043', '1998-09-09', '6 hours',    'passed',      'smile', 1, NULL,    NULL,       NULL,         NULL, 'admin', false, NULL,    NULL,        NULL,    NULL, NULL),
    (6,  'pending',  'aadhaar',         '1187', '1979-01-01', '3 hours',    'unavailable', NULL,    1, NULL,    NULL,       NULL,         NULL, NULL,    false, NULL,    NULL,        NULL,    NULL, NULL),
    (7,  'pending',  'pan',             '5532', '1993-05-21', '1 hour',     'passed',      'left',  2, NULL,    NULL,       NULL,         NULL, NULL,    false, NULL,    NULL,        NULL,    NULL, NULL),
    (8,  'pending',  'aadhaar',         '3398', '1988-12-30', '96 hours',   'passed',      'right', 1, NULL,    NULL,       NULL,         NULL, NULL,    false, NULL,    NULL,        NULL,    NULL, NULL),
    (9,  'pending',  'passport',        '7765', '2000-03-14', '12 hours',   'passed',      'smile', 1, NULL,    NULL,       NULL,         NULL, NULL,    false, NULL,    NULL,        NULL,    NULL, NULL),
    (10, 'pending',  'voter_id',        '4410', '1991-08-08', '20 hours',   'passed',      'left',  1, NULL,    NULL,       NULL,         NULL, 'rahul', false, NULL,    NULL,        NULL,    NULL, NULL),
    (11, 'pending',  'driving_licence', '8120', '1996-06-02', '40 minutes', 'passed',      'right', 1, NULL,    NULL,       NULL,         NULL, NULL,    false, NULL,    NULL,        NULL,    NULL, NULL),
    (12, 'pending',  'aadhaar',         '7788', '1985-10-25', '45 hours',   'passed',      'smile', 1, NULL,    NULL,       NULL,         NULL, NULL,    false, NULL,    NULL,        NULL,    NULL, 16),
    (13, 'verified', 'pan',             '6012', '1994-04-04', '30 hours',   'bypassed',    NULL,    1, 'kabir', '20 hours', NULL,         NULL, NULL,    true,  NULL,    NULL,        NULL,    NULL, NULL),
    (14, 'verified', 'aadhaar',         '3141', '1989-09-17', '20 hours',   'passed',      'left',  2, 'admin', '10 hours', NULL,         NULL, NULL,    true,  NULL,    NULL,        NULL,    NULL, NULL),
    (15, 'verified', 'passport',        '5590', '1997-12-12', '9 hours',    'unavailable', NULL,    1, 'rahul', '5 hours',  NULL,         NULL, NULL,    true,  NULL,    NULL,        NULL,    NULL, NULL),
    (16, 'verified', 'aadhaar',         '7788', '1984-02-14', '40 hours',   'passed',      'smile', 1, 'rahul', '26 hours', NULL,         NULL, NULL,    false, NULL,    NULL,        NULL,    NULL, NULL),
    (17, 'verified', 'pan',             '4402', '1992-07-07', '60 hours',   'bypassed',    NULL,    1, 'kabir', '50 hours', NULL,         NULL, NULL,    true,  'admin', 'confirmed', NULL,    NULL, NULL),
    (18, 'rejected', 'driving_licence', '2290', '1999-01-30', '36 hours',   'passed',      'right', 1, 'kabir', '30 hours', 'blurry',     'Licence photo is out of focus; ask for a sharper scan.', NULL, false, NULL, NULL, NULL, NULL, NULL),
    (19, 'rejected', 'voter_id',        '8837', '1986-03-03', '48 hours',   'passed',      'left',  1, 'rahul', '40 hours', 'not_holder', NULL, NULL,    false, NULL,    NULL,        NULL,    NULL, NULL),
    (20, 'revoked',  'aadhaar',         '6620', '1983-05-05', '70 hours',   'passed',      'smile', 1, 'kabir', '60 hours', NULL,         NULL, NULL,    false, NULL,    NULL,        'admin', 'Document reported stolen by the holder; badge pulled.', NULL),
    (21, 'revoked',  'pan',             '1904', '1990-10-10', '50 hours',   'bypassed',    NULL,    1, 'kabir', '44 hours', NULL,         NULL, NULL,    true,  'rahul', 'revoked',   'rahul', 'QA check: selfie does not match the document photo.', NULL))
INSERT INTO identity_verifications (
    id, user_id, status, doc_type, claimed_number_last4, claimed_name, claimed_dob, claimed_hash, identity_hash,
    doc_last4, holder_name, holder_dob, liveness, liveness_challenge, consent_notice_version, consent_language,
    consent_at, submitted_at, attempt_count, attempt_window_start, reviewer_id, decided_at, rejection_reason,
    rejection_note, revoked_at, revoked_by, revocation_reason, claimed_by, claimed_at, qa_sampled_at,
    qa_reviewed_by, qa_reviewed_at, qa_outcome)
SELECT ('f1c7c001-0000-4000-8000-0000000000' || lpad(c.n::text, 2, '0'))::uuid,
       u.id, c.status, c.doc, c.last4, u.name, c.dob,
       encode(sha256(convert_to('devseed-' || coalesce(c.same_doc_as, c.n), 'UTF8')), 'hex'),
       CASE WHEN c.status IN ('verified', 'revoked') THEN encode(sha256(convert_to('devseed-' || c.n, 'UTF8')), 'hex') END,
       CASE WHEN c.status IN ('verified', 'revoked') THEN c.last4 END,
       CASE WHEN c.status IN ('verified', 'revoked') THEN u.name END,
       CASE WHEN c.status IN ('verified', 'revoked') THEN c.dob END,
       c.liveness, c.pose, '2026-09', 'en',
       now() - c.age, now() - c.age, c.attempts, now() - c.age,
       (SELECT id FROM staff WHERE alias = c.reviewer), now() - c.decided_age, c.rejection, c.note,
       CASE WHEN c.revoker IS NOT NULL THEN now() - c.decided_age + interval '3 hours' END,
       (SELECT id FROM staff WHERE alias = c.revoker), c.revoke_reason,
       (SELECT id FROM staff WHERE alias = c.claimer),
       -- A claim goes stale after 30 minutes; dating it ahead keeps the lock visible through a working day.
       CASE WHEN c.claimer IS NOT NULL THEN now() + interval '8 hours' END,
       CASE WHEN c.qa_sampled THEN now() - c.decided_age + interval '1 minute' END,
       (SELECT id FROM staff WHERE alias = c.qa_by),
       CASE WHEN c.qa_by IS NOT NULL THEN now() - c.decided_age + interval '2 hours' END,
       c.qa_outcome
  FROM cases c
  JOIN users u ON u.id = ('f1c7c000-0000-4000-8000-0000000000' || lpad(c.n::text, 2, '0'))::uuid
ON CONFLICT DO NOTHING;

INSERT INTO identity_verification_files (verification_id, kind, storage_key, content_type, size_bytes)
SELECT v.id, k.kind, 'dev-seed/kyc/' || v.id || '/' || k.kind || '.svg', 'image/svg+xml', 2048
  FROM identity_verifications v
 CROSS JOIN (VALUES ('front'), ('back'), ('selfie')) k(kind)
 WHERE v.id::text LIKE 'f1c7c001-%'
   AND (k.kind <> 'back' OR v.doc_type IN ('aadhaar', 'voter_id'))
ON CONFLICT DO NOTHING;
