-- DEV-only seed, idempotent; existing local rows and session tokens are untouched. The `zz_` prefix
-- is load-bearing: without it this sorts before the localities its rows reference.

INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('4b59bacd-8a45-4cf7-9ec9-a09d94846f2b', 'Rohan Kulkarni', '9876501070', NULL, NULL, 'buyer', NULL, 'active', NULL, true, false, false, 0, NULL, '2026-07-29 23:16:53.636188+05:30', '2026-07-29 23:16:53.636189+05:30', false, NULL, NULL, '2026-07-29 23:16:53.636188+05:30', '2026-07-29 23:16:53.636188+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('c68b2dc8-89a7-5180-b94c-8daa349ff2fc', 'Neha Bhosale', '9508576263', NULL, NULL, 'buyer', NULL, 'suspended', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('569a14d9-004f-5c1a-b2b5-bc1e35d657e8', 'Aarav Sharma', '9277735599', NULL, NULL, 'buyer', NULL, 'suspended', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('98332c2c-c28c-4438-8bf8-9b66faa3704d', 'Priya Deshpande', '9876558345', NULL, NULL, 'buyer', NULL, 'active', NULL, true, false, false, 0, NULL, '2026-07-29 23:17:46.582544+05:30', '2026-07-29 23:17:46.582545+05:30', false, NULL, NULL, '2026-07-29 23:17:46.582544+05:30', '2026-07-29 23:17:46.582544+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('b05422ba-0a55-5136-ba68-d202e83e29b0', 'Isha Mehta', '9552538370', NULL, NULL, 'owner', NULL, 'active', 'Pune', true, false, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('7f200cc3-b892-4a2c-9ba2-b6627abf4006', 'Karan Joshi', '9876525851', NULL, NULL, 'buyer', NULL, 'active', NULL, true, false, false, 0, NULL, '2026-07-29 23:18:54.176382+05:30', '2026-07-29 23:18:54.176383+05:30', false, NULL, NULL, '2026-07-29 23:18:54.176382+05:30', '2026-07-29 23:18:54.176382+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('a2f1134d-b836-40db-b42c-0fc3df0f409c', 'Ananya Reddy', '9876578025', NULL, NULL, 'buyer', NULL, 'active', NULL, true, false, false, 0, NULL, '2026-07-29 23:19:46.51218+05:30', '2026-07-29 23:19:46.511182+05:30', false, NULL, NULL, '2026-07-29 23:19:46.51218+05:30', '2026-07-29 23:19:46.51218+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('18918424-fc3a-4117-b1e7-e8437ac311d5', 'Vikram Nair', '9876528351', NULL, NULL, 'buyer', NULL, 'active', NULL, true, false, false, 0, NULL, '2026-07-29 23:30:41.320258+05:30', '2026-07-29 23:30:41.319249+05:30', false, NULL, NULL, '2026-07-29 23:30:41.320258+05:30', '2026-07-29 23:30:41.320258+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('74feff4f-f669-5adc-93d5-bd1ad0d0e2a9', 'Sneha Iyer', '9395852523', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, false, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('24daef28-5a4d-58af-af85-ec1cdde8540d', 'Aditya Shah', '9878457666', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('65e66346-62d0-525f-be12-81d3f1868f06', 'Aditya Iyer', '9712728163', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('8d8c7e15-efe0-45e0-81b4-371920583c2d', 'Meera Kapoor', '9876551627', NULL, NULL, 'buyer', NULL, 'active', NULL, true, false, false, 0, NULL, '2026-07-29 23:31:00.370694+05:30', '2026-07-29 23:31:00.370694+05:30', false, NULL, NULL, '2026-07-29 23:31:00.370694+05:30', '2026-07-29 23:31:00.370694+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('758f8534-ee2d-5075-ab65-8e89bb294047', 'Meera Chavan', '9817252766', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('b4cd0c15-882c-4690-be31-82e5671e7e67', 'Parity Renamed', '9876571278', NULL, NULL, 'buyer', NULL, 'active', NULL, true, false, false, 0, NULL, '2026-07-29 23:31:12.078774+05:30', '2026-07-29 23:31:12.077777+05:30', false, NULL, NULL, '2026-07-29 23:31:12.078774+05:30', '2026-07-29 23:31:12.104691+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('3487a033-ec13-5901-9920-cd4d89b2561d', 'Nikhil Nair', '9133973978', NULL, NULL, 'owner', NULL, 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('14ebad35-1376-5f40-8f53-e910ef773a6a', 'Rahul Jain', '9272696131', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('4588d5ce-b4e0-53a0-a181-2c26bbcecf67', 'Vikram Rao', '9318202961', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('9ccc7159-1e42-532f-b036-5f12dbe6000c', 'Pooja Shah', '9253229149', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('7f876da7-2eab-5c63-ba1f-8475a58871e1', 'Neha Sharma', '9808019141', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('f41432f7-f16e-57b3-bbd3-1b581c38b0d4', 'Omkar Gupta', '9207292146', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('e9f29e71-187e-5afc-ba46-be7b199eff2a', 'Aarav Deshpande', '9382625379', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('bec95d4f-6e17-50ce-b253-aaf9cd240dfd', 'Tanvi Deshpande', '9122040348', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('4336aef6-f776-582c-8b26-c53ae58aea73', 'Ananya Reddy', '9650468398', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('505e4c69-7dca-530b-8f0d-6a2150943aa5', 'Diya Deshpande', '9152892152', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('15834543-55fe-5931-87ac-fca594aa0566', 'Aarav Reddy', '9240355264', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('03efa85e-d675-5bc5-9798-7a24eeaee9c7', 'Siddharth Iyer', '9781813747', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('22942abf-8846-5f86-84ca-7dcf63a70dd7', 'Gauri Mehta', '9691884062', NULL, NULL, 'owner', NULL, 'active', 'Pune', true, false, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('d9b4d06c-a0fc-522f-b708-f2ebd16ef1eb', 'Isha Bhosale', '9441541427', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('503aa11e-bf1a-5216-a0ae-69a59b4deda6', 'Kabir Nair', '9697910226', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('a98a8ed4-88ff-58e3-90ec-c9f09855e69f', 'Rahul Joshi', '9641381391', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('dc911757-c841-552e-9509-cbdaaf525491', 'Sneha Jain', '9394055866', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, false, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('b8ec5346-4a95-4181-bf72-85343ed467e8', 'Siddharth Rao', '9876500202', NULL, NULL, 'buyer', NULL, 'active', NULL, true, false, false, 0, NULL, '2026-07-28 22:59:08.427934+05:30', '2026-07-28 22:59:08.426934+05:30', false, NULL, NULL, '2026-07-28 22:59:08.427934+05:30', '2026-07-28 22:59:08.427934+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('35873c08-6403-55cf-9101-d02d37f94a93', 'Nikhil Rao', '9328855615', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('a37b5ebe-8bf3-4481-9850-0bbcdd3b9a81', 'Pooja Gupta', '9876500601', NULL, NULL, 'buyer', NULL, 'active', NULL, true, false, false, 0, NULL, '2026-07-28 22:59:08.697728+05:30', '2026-07-28 22:59:08.697729+05:30', false, NULL, NULL, '2026-07-28 22:59:08.697728+05:30', '2026-07-28 22:59:08.697728+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('ba0655a9-9d0d-4f15-aad9-d32b6968c072', 'Arjun Menon', '9876500401', NULL, NULL, 'buyer', NULL, 'active', NULL, true, false, false, 0, NULL, '2026-07-28 22:59:08.738808+05:30', '2026-07-28 22:59:08.73781+05:30', false, NULL, NULL, '2026-07-28 22:59:08.738808+05:30', '2026-07-28 22:59:08.738808+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('d512c905-496b-454e-8de9-3a4c0a23522d', 'Divya Pillai', '9876500501', NULL, NULL, 'buyer', NULL, 'active', NULL, true, false, false, 0, NULL, '2026-07-28 22:59:08.802253+05:30', '2026-07-28 22:59:08.802254+05:30', false, NULL, NULL, '2026-07-28 22:59:08.802253+05:30', '2026-07-28 22:59:08.802253+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('854d1765-efe9-57c8-99fb-315e3006dd6f', 'Nikhil Nair', '9283184696', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('4825cc29-cf4c-5731-be60-de982e060ac2', 'Isha Deshpande', '9784345146', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('dadc36e0-9648-5f10-b4b8-15fd08e59562', 'Kabir Rao', '9396565787', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('18ed4042-34c2-5377-9a9b-b88dbc9d6d3c', 'Sakshi Iyer', '9239397704', NULL, NULL, 'buyer', NULL, 'suspended', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('a42b4ffe-5238-5b86-b7e2-51ee8cc8b336', 'Riya Rao', '9158026750', NULL, NULL, 'buyer', NULL, 'suspended', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('e427a0c0-65a6-5da4-bcba-0e50f64953a9', 'Kabir Iyer', '9711827190', NULL, NULL, 'staff', 'rental', 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('54408cbb-9bc0-5168-b535-67468be09c17', 'Rahul Joshi', '9490074473', NULL, NULL, 'staff', 'rental', 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('da3bdca6-6a72-5059-89f6-9e9c20b9f5c9', 'Isha Mehta', '9733798115', NULL, NULL, 'staff', 'rental', 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('816b88ce-1c71-5326-ba5d-f467c24d529e', 'Isha Iyer', '9223611750', NULL, NULL, 'staff', 'legal', 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('b72c0b47-5dc2-507d-9e45-e664755ba45a', 'Meera Mehta', '9834262782', NULL, NULL, 'staff', 'legal', 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('0073ee7e-fc86-5d28-9744-41641213b1dc', 'Tanvi Rao', '9228948057', NULL, NULL, 'staff', 'interior', 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('95e2cc8f-e901-5d65-9a40-7faad35e1043', 'Nikhil Joshi', '9409479949', NULL, NULL, 'staff', 'interior', 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('32f33fc0-cbf3-5c59-b8c8-6b4dcde64c39', 'Diya Kulkarni', '9710931232', NULL, NULL, 'staff', 'interior', 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('d3f9bd0e-6500-5627-b07a-2ee095e71183', 'Neha Mehta', '9219136301', NULL, NULL, 'staff', 'packers', 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('284d7e40-22bb-53f4-8af3-32401a07569a', 'Diya Jain', '9542346771', NULL, NULL, 'staff', 'packers', 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('a08d2e8e-9757-5b48-a3de-483814c5b129', 'Sakshi Mehta', '9171199048', NULL, NULL, 'staff', 'valuation', 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('b149e49b-b95f-5215-9a2a-2a371206afbf', 'Karan Chavan', '9383334640', NULL, NULL, 'staff', 'valuation', 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('3052d5de-4e04-5709-ab65-23299bb2ea78', 'Meera Iyer', '9743304170', NULL, NULL, 'staff', 'valuation', 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('5bebfff1-5c5b-5df4-a279-1f8fce7dce52', 'Aarav Deshpande', '9812733640', NULL, NULL, 'staff', 'loans', 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('c24b67b7-48eb-5906-9860-ee5f79fd7ef6', 'Priya Nair', '9820511744', NULL, NULL, 'staff', 'loans', 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('e6621d3a-3e31-5022-a6c9-34a90c8f6e9b', 'Admin', '9000000000', NULL, NULL, 'admin', NULL, 'active', 'Pune', true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('7468edfd-f663-5c53-82cb-2d55c757dd2b', 'Tanvi Jain', '9531006179', NULL, NULL, 'owner', NULL, 'suspended', 'Pune', true, false, false, 2, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('6e0d6446-90ad-5b90-89aa-617a89f387a0', 'Sakshi Rao', '9596499088', NULL, NULL, 'owner', NULL, 'active', 'Pune', true, true, false, 4, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('190ca53e-0f1b-52e0-b825-7cd1f9accd91', 'Meera Joshi', '9464709344', NULL, NULL, 'owner', NULL, 'active', 'Pune', true, false, false, 2, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('f619aa88-84ed-50ce-9a07-abb7712afa9d', 'Omkar Kulkarni', '9708919481', NULL, NULL, 'owner', NULL, 'active', 'Pune', true, false, false, 3, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('51a4c85a-d1f6-5602-9d71-78393d8abd3c', 'Aditya Sharma', '9217580334', NULL, NULL, 'owner', NULL, 'active', 'Pune', true, true, false, 2, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('19bdc371-5496-5930-af29-5ef3d8e6bb8b', 'Rohan Kulkarni', '9530047855', NULL, NULL, 'owner', NULL, 'suspended', 'Pune', true, false, false, 2, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('7c92f0c4-3fb9-50f8-ae42-ccb1995660fd', 'Nikhil Jain', '9411618812', NULL, NULL, 'owner', NULL, 'active', 'Pune', true, true, false, 2, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('0505d7d5-3062-5abc-a33b-fc0e45bde6c5', 'Nikhil Sharma', '9646894809', NULL, NULL, 'owner', NULL, 'active', 'Pune', true, true, false, 2, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('8f1caf57-9535-5888-a241-096081e2e621', 'Siddharth Gupta', '9193853276', NULL, NULL, 'owner', NULL, 'active', 'Pune', true, false, false, 1, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('b877af02-d4b6-53e3-9aff-66637281e6d2', 'Tanvi Chavan', '9592138848', NULL, NULL, 'owner', NULL, 'active', 'Pune', true, false, false, 2, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('6f77d348-d008-5e70-aeaa-cc465a73e28a', 'Meera Iyer', '9672137494', NULL, NULL, 'owner', NULL, 'active', 'Pune', true, false, false, 2, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('e1e2d40c-f128-5694-ae78-490b413567ee', 'Sneha Shah', '9124855617', NULL, NULL, 'owner', NULL, 'active', 'Pune', true, false, false, 3, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('de87779e-383b-5916-bc80-b3ee85c4fcab', 'Vivaan Shah', '9657839865', NULL, NULL, 'owner', NULL, 'active', 'Pune', true, true, false, 2, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('6702a32f-999e-550b-ba01-32db68d89707', 'Isha Bhosale', '9180639648', NULL, NULL, 'owner', NULL, 'active', 'Pune', true, true, false, 3, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('c06d8be2-459c-4f9e-b4da-48266130be42', 'Rahul Verma', '9876500001', NULL, NULL, 'buyer', NULL, 'active', NULL, true, false, false, 0, NULL, '2026-07-29 22:46:44.312922+05:30', '2026-07-29 22:46:44.311914+05:30', false, NULL, NULL, '2026-07-29 22:46:44.312922+05:30', '2026-07-29 22:46:44.312922+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('654410e5-02db-49cb-a9b8-9c7807ed69b9', 'Integration Test', '9876500002', 'it@draazy.local', NULL, 'buyer', NULL, 'active', NULL, true, false, false, 0, NULL, '2026-07-29 22:47:00.370325+05:30', '2026-07-29 22:47:00.370326+05:30', false, NULL, NULL, '2026-07-29 22:47:00.370325+05:30', '2026-07-29 22:47:00.401955+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('5a6aac62-45c2-4681-a9ef-bb413d998a89', 'Parity Renamed', '9876551140', NULL, NULL, 'buyer', NULL, 'active', NULL, true, false, false, 0, NULL, '2026-07-29 22:50:51.92822+05:30', '2026-07-29 22:50:51.92822+05:30', false, NULL, NULL, '2026-07-29 22:50:51.92822+05:30', '2026-07-29 22:50:51.949333+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('d98519e2-7fd6-4c66-a200-3102bd159785', 'Parity Renamed', '9876508974', NULL, NULL, 'buyer', NULL, 'active', NULL, true, false, false, 0, NULL, '2026-07-29 22:51:49.775292+05:30', '2026-07-29 22:51:49.775292+05:30', false, NULL, NULL, '2026-07-29 22:51:49.775292+05:30', '2026-07-29 22:51:49.797559+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('3f9ee2e8-aa24-4bf3-aca5-31613643e537', 'Sanjana Patil', '9876573343', NULL, NULL, 'buyer', NULL, 'active', NULL, true, false, false, 0, NULL, '2026-07-29 22:58:02.819849+05:30', '2026-07-29 22:58:02.819849+05:30', false, NULL, NULL, '2026-07-29 22:58:02.819849+05:30', '2026-07-29 22:58:02.819849+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('733a978c-ce5b-504e-ada3-f70d154cfd52', 'Tanvi Mehta', '9108512606', NULL, NULL, 'owner', NULL, 'active', 'Pune', true, true, false, 2, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-30 07:38:37.585096+05:30', false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-30 07:38:37.556707+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('3ad0171b-3206-53e2-b6dc-732bf4e1b44c', 'Meera Deshpande', '9470744469', NULL, NULL, 'owner', NULL, 'active', 'Pune', true, true, false, 4, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-30 13:48:21.407483+05:30', false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-30 13:48:21.405922+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('5b574629-f24f-5c25-9fa0-b29d9c26a41d', 'p5003', 'b877af02-d4b6-53e3-9aff-66637281e6d2', '4 BHK Studio in Viman Nagar', 'rent', 'Studio', 4, 27000, 'per-month', NULL, NULL, NULL, 1998, 'sqft', NULL, NULL, NULL, 'furnished', NULL, NULL, NULL, 'ready-to-move', 'Viman Nagar', 'viman-nagar', NULL, 'Pune', 18.570892273530365, 73.90631948865484, NULL, NULL, NULL, 'Spacious 4 BHK studio in Viman Nagar, Pune. Zero brokerage, deal directly with the verified owner.', '["lift", "parking", "security", "power", "pool", "garden", "club"]', '["https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'rejected', false, NULL, true, true, true, false, false, 4, 476, 60, false, NULL, '{}', false, NULL, NULL, '2026-06-01 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('8d1de836-4df8-5787-9172-45ef78ec02df', 'p5004', '190ca53e-0f1b-52e0-b825-7cd1f9accd91', '3 BHK Penthouse in Pimple Saudagar', 'rent', 'Penthouse', 3, 65000, 'per-month', NULL, NULL, NULL, 641, 'sqft', NULL, NULL, NULL, 'furnished', NULL, NULL, NULL, 'ready-to-move', 'Pimple Saudagar', 'pimple-saudagar', NULL, 'Pune', 18.603891777840442, 73.80123122276738, NULL, NULL, NULL, 'Spacious 3 BHK penthouse in Pimple Saudagar, Pune. Zero brokerage, deal directly with the verified owner.', '["gym", "security", "power", "play"]', '["https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'pending', false, NULL, false, false, true, false, false, 1, 817, 33, false, NULL, '{}', false, NULL, NULL, '2026-05-12 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('c2d88790-14ab-506d-b7cb-a9698fd9549e', 'p5005', '733a978c-ce5b-504e-ada3-f70d154cfd52', '1 BHK Flat in Kothrud', 'buy', 'Flat', 1, 6955200, 'total', NULL, NULL, NULL, 621, 'sqft', NULL, NULL, NULL, 'semi-furnished', NULL, NULL, NULL, 'ready-to-move', 'Kothrud', 'kothrud', NULL, 'Pune', 18.50167249767855, 73.81091974472906, NULL, NULL, NULL, 'Spacious 1 BHK flat in Kothrud, Pune. Zero brokerage, deal directly with the verified owner.', '["lift", "parking", "security", "pool"]', '["https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'rejected', false, NULL, true, true, true, false, false, 5, 2048, 54, false, NULL, '{}', false, NULL, NULL, '2026-05-26 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('8996ddbc-d9ea-5ca3-83bb-fd14c3f430f7', 'p5006', 'de87779e-383b-5916-bc80-b3ee85c4fcab', '4 BHK Penthouse in Hinjawadi', 'rent', 'Penthouse', 4, 33000, 'per-month', NULL, NULL, NULL, 1745, 'sqft', NULL, NULL, NULL, 'semi-furnished', NULL, NULL, NULL, 'ready-to-move', 'Hinjawadi', 'hinjawadi', NULL, 'Pune', 18.598357148630544, 73.74054561661276, NULL, NULL, NULL, 'Spacious 4 BHK penthouse in Hinjawadi, Pune. Zero brokerage, deal directly with the verified owner.', '["gym", "lift", "security", "garden", "play"]', '["https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'approved', false, NULL, false, false, true, false, false, 3, 592, 35, false, NULL, '{}', false, NULL, NULL, '2026-04-13 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('0dcd8871-ffdd-56d6-b989-be6f53aa579e', 'p5007', 'f619aa88-84ed-50ce-9a07-abb7712afa9d', '2 BHK Studio in Balewadi', 'rent', 'Studio', 2, 59000, 'per-month', NULL, NULL, NULL, 1080, 'sqft', NULL, NULL, NULL, 'semi-furnished', NULL, NULL, NULL, 'ready-to-move', 'Balewadi', 'balewadi', NULL, 'Pune', 18.582265049624255, 73.77344717548975, NULL, NULL, NULL, 'Spacious 2 BHK studio in Balewadi, Pune. Zero brokerage, deal directly with the verified owner.', '["lift", "parking", "security", "pool", "play"]', '["https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'approved', false, NULL, true, true, true, false, false, 2, 242, 0, false, NULL, '{}', false, NULL, NULL, '2026-04-26 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('9ecd9412-9bdd-5ecd-8600-0d0b70a4d868', 'p5008', '6e0d6446-90ad-5b90-89aa-617a89f387a0', '2 BHK Penthouse in Baner', 'buy', 'Penthouse', 2, 7624400, 'total', NULL, NULL, NULL, 778, 'sqft', NULL, NULL, NULL, 'unfurnished', NULL, NULL, NULL, 'ready-to-move', 'Baner', 'baner', NULL, 'Pune', 18.553950614469127, 73.77227058119047, NULL, NULL, NULL, 'Spacious 2 BHK penthouse in Baner, Pune. Zero brokerage, deal directly with the verified owner.', '["parking", "security", "pool", "garden", "club", "play"]', '["https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'approved', false, NULL, true, true, false, false, false, 4, 1008, 33, false, NULL, '{}', false, NULL, NULL, '2026-06-13 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('2199b3df-a31a-5596-b37c-211725ff0bb6', 'p5009', 'f619aa88-84ed-50ce-9a07-abb7712afa9d', '3 BHK Studio in Kharadi', 'rent', 'Studio', 3, 52000, 'per-month', NULL, NULL, NULL, 1362, 'sqft', NULL, NULL, NULL, 'semi-furnished', NULL, NULL, NULL, 'ready-to-move', 'Kharadi', 'kharadi', NULL, 'Pune', 18.553097633755765, 73.94954867561721, NULL, NULL, NULL, 'Spacious 3 BHK studio in Kharadi, Pune. Zero brokerage, deal directly with the verified owner.', '["lift", "security", "garden", "club"]', '["https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'pending', false, NULL, true, true, true, false, false, 5, 534, 9, false, NULL, '{}', false, NULL, NULL, '2026-04-05 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('b72f5635-afe1-5c5e-b6d6-381295cd4f0e', 'p5010', '8f1caf57-9535-5888-a241-096081e2e621', '3 BHK Villa in Undri', 'buy', 'Villa', 3, 4501200, 'total', NULL, NULL, NULL, 682, 'sqft', NULL, NULL, NULL, 'unfurnished', NULL, NULL, NULL, 'ready-to-move', 'Undri', 'undri', NULL, 'Pune', 18.45964675389789, 73.9147532455558, NULL, NULL, NULL, 'Spacious 3 BHK villa in Undri, Pune. Zero brokerage, deal directly with the verified owner.', '["lift", "security", "pool", "garden", "club", "play"]', '["https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'approved', false, NULL, true, true, true, false, false, 3, 1202, 57, false, NULL, '{}', false, NULL, NULL, '2026-04-20 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('c8a81a88-d713-50e9-8b43-2ce04931e4bd', 'p5011', '0505d7d5-3062-5abc-a33b-fc0e45bde6c5', '1 BHK Villa in Magarpatta', 'rent', 'Villa', 1, 61000, 'per-month', NULL, NULL, NULL, 1200, 'sqft', NULL, NULL, NULL, 'furnished', NULL, NULL, NULL, 'ready-to-move', 'Magarpatta', 'magarpatta', NULL, 'Pune', 18.513594977617263, 73.93283973547351, NULL, NULL, NULL, 'Spacious 1 BHK villa in Magarpatta, Pune. Zero brokerage, deal directly with the verified owner.', '["parking", "security", "play"]', '["https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'flagged', false, 'User reported', true, true, true, false, false, 5, 668, 32, false, NULL, '{}', false, NULL, NULL, '2026-04-21 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('fcf15613-bf67-5234-b464-3e030a30eea7', 'p5012', '6f77d348-d008-5e70-aeaa-cc465a73e28a', '3 BHK Studio in NIBM Road', 'buy', 'Studio', 3, 14320800, 'total', NULL, NULL, NULL, 1768, 'sqft', NULL, NULL, NULL, 'furnished', NULL, NULL, NULL, 'new-launch', 'NIBM Road', 'nibm-road', NULL, 'Pune', 18.47717355706729, 73.91079879025835, NULL, NULL, NULL, 'Spacious 3 BHK studio in NIBM Road, Pune. Zero brokerage, deal directly with the verified owner.', '["lift", "pool", "garden"]', '["https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'rejected', false, NULL, false, false, false, false, false, 2, 2076, 13, false, NULL, '{}', false, NULL, NULL, '2026-06-03 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('f7140411-1046-5096-a038-126bb676e06b', 'p5013', '7c92f0c4-3fb9-50f8-ae42-ccb1995660fd', '1 BHK Flat in Baner', 'buy', 'Flat', 1, 15415400, 'total', NULL, NULL, NULL, 1573, 'sqft', NULL, NULL, NULL, 'furnished', NULL, NULL, NULL, 'under-construction', 'Baner', 'baner', NULL, 'Pune', 18.55501982851047, 73.7857727506794, NULL, NULL, NULL, 'Spacious 1 BHK flat in Baner, Pune. Zero brokerage, deal directly with the verified owner.', '["lift", "parking", "power", "club", "play"]', '["https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'approved', false, NULL, true, true, true, false, false, 5, 1267, 27, false, NULL, '{}', false, NULL, NULL, '2026-06-19 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('995e2cbb-c454-502c-98d0-cdb0853fb8de', 'p5014', '6e0d6446-90ad-5b90-89aa-617a89f387a0', '2 BHK Penthouse in Balewadi', 'rent', 'Penthouse', 2, 21000, 'per-month', NULL, NULL, NULL, 637, 'sqft', NULL, NULL, NULL, 'unfurnished', NULL, NULL, NULL, 'ready-to-move', 'Balewadi', 'balewadi', NULL, 'Pune', 18.577130611417815, 73.77269159811829, NULL, NULL, NULL, 'Spacious 2 BHK penthouse in Balewadi, Pune. Zero brokerage, deal directly with the verified owner.', '["lift", "parking", "security"]', '["https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'approved', false, NULL, true, true, true, false, false, 4, 1358, 42, false, NULL, '{}', false, NULL, NULL, '2026-04-14 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('1078d711-d3eb-5961-ab3c-30d4bdc5f377', 'p5015', '3ad0171b-3206-53e2-b6dc-732bf4e1b44c', '4 BHK Row House in Wakad', 'rent', 'Row House', 4, 38000, 'per-month', NULL, NULL, NULL, 1184, 'sqft', NULL, NULL, NULL, 'unfurnished', NULL, NULL, NULL, 'ready-to-move', 'Wakad', 'wakad', NULL, 'Pune', 18.591500371458938, 73.75252405190655, NULL, NULL, NULL, 'Spacious 4 BHK row house in Wakad, Pune. Zero brokerage, deal directly with the verified owner.', '["gym", "parking", "garden", "club", "play"]', '["https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'approved', false, NULL, false, false, false, false, false, 4, 349, 48, false, NULL, '{}', false, NULL, NULL, '2026-06-20 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('4a72dfe1-ad8e-5dd1-a83a-718946d65ec3', 'p5016', '6f77d348-d008-5e70-aeaa-cc465a73e28a', '4 BHK Row House in Magarpatta', 'rent', 'Row House', 4, 61000, 'per-month', NULL, NULL, NULL, 1872, 'sqft', NULL, NULL, NULL, 'furnished', NULL, NULL, NULL, 'ready-to-move', 'Magarpatta', 'magarpatta', NULL, 'Pune', 18.50998163117934, 73.92736015067622, NULL, NULL, NULL, 'Spacious 4 BHK row house in Magarpatta, Pune. Zero brokerage, deal directly with the verified owner.', '["gym", "lift", "parking", "power", "pool", "garden", "club"]', '["https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'approved', false, NULL, true, true, false, false, false, 1, 717, 32, false, NULL, '{}', false, NULL, NULL, '2026-05-18 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('3272b9df-34f5-59b7-8190-47678479828c', 'p5017', '51a4c85a-d1f6-5602-9d71-78393d8abd3c', '1 RK Villa in Koregaon Park', 'buy', 'Villa', 1, 8874000, 'total', NULL, NULL, NULL, 612, 'sqft', NULL, NULL, NULL, 'semi-furnished', NULL, NULL, NULL, 'new-launch', 'Koregaon Park', 'koregaon-park', NULL, 'Pune', 18.54439918388054, 73.88927011155243, NULL, NULL, NULL, 'Spacious 1 RK villa in Koregaon Park, Pune. Zero brokerage, deal directly with the verified owner.', '["gym", "lift", "parking", "security", "play"]', '["https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'approved', false, NULL, true, true, true, false, false, 5, 662, 15, false, NULL, '{}', false, NULL, NULL, '2026-06-21 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('75e78160-b695-5517-9d95-c2c09aa187b5', 'p5018', 'e1e2d40c-f128-5694-ae78-490b413567ee', '1 RK Flat in Pimple Saudagar', 'rent', 'Flat', 1, 14000, 'per-month', NULL, NULL, NULL, 1735, 'sqft', NULL, NULL, NULL, 'unfurnished', NULL, NULL, NULL, 'ready-to-move', 'Pimple Saudagar', 'pimple-saudagar', NULL, 'Pune', 18.598009088912047, 73.79844268523158, NULL, NULL, NULL, 'Spacious 1 RK flat in Pimple Saudagar, Pune. Zero brokerage, deal directly with the verified owner.', '["gym", "lift", "parking", "pool", "garden", "club", "play"]', '["https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'pending', false, NULL, true, true, false, false, false, 5, 1665, 33, false, NULL, '{}', false, NULL, NULL, '2026-06-29 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('2b33ff9c-a2c3-54dd-88a9-a37e88294482', 'p5019', 'f619aa88-84ed-50ce-9a07-abb7712afa9d', '4 BHK Studio in Bavdhan', 'buy', 'Studio', 4, 11228800, 'total', NULL, NULL, NULL, 1276, 'sqft', NULL, NULL, NULL, 'semi-furnished', NULL, NULL, NULL, 'under-construction', 'Bavdhan', 'bavdhan', NULL, 'Pune', 18.523776633158324, 73.76702922229003, NULL, NULL, NULL, 'Spacious 4 BHK studio in Bavdhan, Pune. Zero brokerage, deal directly with the verified owner.', '["lift", "parking", "security", "pool", "garden", "club", "play"]', '["https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'pending', false, NULL, true, true, false, false, false, 3, 1108, 17, false, NULL, '{}', false, NULL, NULL, '2026-05-12 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('6a10df11-32fd-52fa-b024-e30f44828453', 'p5020', 'de87779e-383b-5916-bc80-b3ee85c4fcab', '4 BHK Studio in Baner', 'buy', 'Studio', 4, 19854800, 'total', NULL, NULL, NULL, 2026, 'sqft', NULL, NULL, NULL, 'unfurnished', NULL, NULL, NULL, 'ready-to-move', 'Baner', 'baner', NULL, 'Pune', 18.566341496418232, 73.78504691413976, NULL, NULL, NULL, 'Spacious 4 BHK studio in Baner, Pune. Zero brokerage, deal directly with the verified owner.', '["lift", "garden"]', '["https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'pending', false, NULL, true, true, true, false, false, 3, 1211, 2, false, NULL, '{}', false, NULL, NULL, '2026-05-18 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('615287b3-7a3b-530f-84aa-773753e8682b', 'p5021', '3ad0171b-3206-53e2-b6dc-732bf4e1b44c', '1 BHK Penthouse in Kharadi', 'buy', 'Penthouse', 1, 9109100, 'total', NULL, NULL, NULL, 1001, 'sqft', NULL, NULL, NULL, 'semi-furnished', NULL, NULL, NULL, 'new-launch', 'Kharadi', 'kharadi', NULL, 'Pune', 18.55069724860508, 73.94845573015884, NULL, NULL, NULL, 'Spacious 1 BHK penthouse in Kharadi, Pune. Zero brokerage, deal directly with the verified owner.', '["lift", "parking", "security", "garden", "club", "play"]', '["https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'approved', false, NULL, true, true, false, false, false, 5, 846, 16, false, NULL, '{}', false, NULL, NULL, '2026-06-12 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('d87532db-4b22-5356-8795-b48e8dbb0c98', 'p5022', '6702a32f-999e-550b-ba01-32db68d89707', '3 BHK Studio in Aundh', 'buy', 'Studio', 3, 28320000, 'total', NULL, NULL, NULL, 2400, 'sqft', NULL, NULL, NULL, 'semi-furnished', NULL, NULL, NULL, 'under-construction', 'Aundh', 'aundh', NULL, 'Pune', 18.554593301761894, 73.79733657842782, NULL, NULL, NULL, 'Spacious 3 BHK studio in Aundh, Pune. Zero brokerage, deal directly with the verified owner.', '["gym", "security", "power"]', '["https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'pending', false, NULL, false, false, false, false, false, 2, 1947, 56, false, NULL, '{}', false, NULL, NULL, '2026-05-25 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('8c6141a4-9acf-5d2b-8cb7-7795f9aa70c7', 'p5023', '7468edfd-f663-5c53-82cb-2d55c757dd2b', '2 BHK Penthouse in Bavdhan', 'buy', 'Penthouse', 2, 5790400, 'total', NULL, NULL, NULL, 658, 'sqft', NULL, NULL, NULL, 'furnished', NULL, NULL, NULL, 'ready-to-move', 'Bavdhan', 'bavdhan', NULL, 'Pune', 18.52288996669557, 73.76853530220502, NULL, NULL, NULL, 'Spacious 2 BHK penthouse in Bavdhan, Pune. Zero brokerage, deal directly with the verified owner.', '["security", "garden", "club", "play"]', '["https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'approved', true, NULL, true, true, true, false, false, 6, 506, 30, false, NULL, '{}', false, NULL, NULL, '2026-04-07 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('7847ad81-cc55-5db2-bacb-67d085e3ef4e', 'p5024', '6e0d6446-90ad-5b90-89aa-617a89f387a0', '2 BHK Row House in Kothrud', 'buy', 'Row House', 2, 25188800, 'total', NULL, NULL, NULL, 2249, 'sqft', NULL, NULL, NULL, 'semi-furnished', NULL, NULL, NULL, 'ready-to-move', 'Kothrud', 'kothrud', NULL, 'Pune', 18.502311003280806, 73.79945733900462, NULL, NULL, NULL, 'Spacious 2 BHK row house in Kothrud, Pune. Zero brokerage, deal directly with the verified owner.', '["lift", "pool", "garden"]', '["https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'pending', false, NULL, false, false, true, false, false, 6, 70, 9, true, 'docs_submitted', '{"postedByStaff": "e6621d3a-3e31-5022-a6c9-34a90c8f6e9b"}', false, NULL, NULL, '2026-05-30 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('3806a3e6-2bee-5ac0-b7a1-a3348e807471', 'p5025', 'e1e2d40c-f128-5694-ae78-490b413567ee', '1 RK Villa in Kothrud', 'buy', 'Villa', 1, 7459200, 'total', NULL, NULL, NULL, 666, 'sqft', NULL, NULL, NULL, 'semi-furnished', NULL, NULL, NULL, 'new-launch', 'Kothrud', 'kothrud', NULL, 'Pune', 18.514449141130783, 73.8133620754704, NULL, NULL, NULL, 'Spacious 1 RK villa in Kothrud, Pune. Zero brokerage, deal directly with the verified owner.', '["lift", "security", "power", "pool", "garden"]', '["https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'approved', false, NULL, false, false, true, false, false, 6, 1496, 35, false, NULL, '{}', false, NULL, NULL, '2026-05-23 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('91f50379-b8d5-5588-b686-3305ef657c03', 'p5026', '7468edfd-f663-5c53-82cb-2d55c757dd2b', '4 BHK Studio in Baner', 'buy', 'Studio', 4, 4949000, 'total', NULL, NULL, NULL, 505, 'sqft', NULL, NULL, NULL, 'unfurnished', NULL, NULL, NULL, 'new-launch', 'Baner', 'baner', NULL, 'Pune', 18.555368437223137, 73.77369020061474, NULL, NULL, NULL, 'Spacious 4 BHK studio in Baner, Pune. Zero brokerage, deal directly with the verified owner.', '["gym", "security", "garden", "club"]', '["https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'pending', false, NULL, true, true, true, false, false, 4, 1794, 25, false, NULL, '{}', false, NULL, NULL, '2026-04-19 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('886059e2-7b1e-5cd3-8139-f0e1605eb67b', 'p5027', '6702a32f-999e-550b-ba01-32db68d89707', '1 RK Studio in Magarpatta', 'rent', 'Studio', 1, 45000, 'per-month', NULL, NULL, NULL, 2386, 'sqft', NULL, NULL, NULL, 'semi-furnished', NULL, NULL, NULL, 'ready-to-move', 'Magarpatta', 'magarpatta', NULL, 'Pune', 18.508209526197984, 73.93431606013048, NULL, NULL, NULL, 'Spacious 1 RK studio in Magarpatta, Pune. Zero brokerage, deal directly with the verified owner.', '["gym", "security"]', '["https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'pending', false, NULL, true, true, false, false, false, 6, 527, 24, false, NULL, '{}', false, NULL, NULL, '2026-04-25 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('9fd5a65b-0607-50e4-8f1c-3d1de0090017', 'p5028', '733a978c-ce5b-504e-ada3-f70d154cfd52', '1 BHK Plot in Viman Nagar', 'rent', 'Plot', 1, 54000, 'per-month', NULL, NULL, NULL, 864, 'sqft', NULL, NULL, NULL, 'semi-furnished', NULL, NULL, NULL, NULL, 'Viman Nagar', 'viman-nagar', NULL, 'Pune', 18.576468404329383, 73.91543772383594, NULL, NULL, NULL, 'Spacious 1 BHK plot in Viman Nagar, Pune. Zero brokerage, deal directly with the verified owner.', '["gym", "security", "pool", "play"]', '["https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'pending', false, NULL, true, true, false, false, false, 1, 1443, 51, true, 'docs_submitted', '{"postedByStaff": "e6621d3a-3e31-5022-a6c9-34a90c8f6e9b"}', false, NULL, NULL, '2026-04-14 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('76c86c78-795d-59a9-9a4d-d80f4ede25d3', 'p5029', '190ca53e-0f1b-52e0-b825-7cd1f9accd91', '1 RK Studio in Kharadi', 'rent', 'Studio', 1, 37000, 'per-month', NULL, NULL, NULL, 2232, 'sqft', NULL, NULL, NULL, 'semi-furnished', NULL, NULL, NULL, 'ready-to-move', 'Kharadi', 'kharadi', NULL, 'Pune', 18.546773974508046, 73.94063936656248, NULL, NULL, NULL, 'Spacious 1 RK studio in Kharadi, Pune. Zero brokerage, deal directly with the verified owner.', '["gym", "parking", "garden", "club"]', '["https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'rejected', false, NULL, true, true, true, false, false, 5, 1288, 28, false, NULL, '{}', false, NULL, NULL, '2026-05-10 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('42ba0880-ee4f-5a78-9a8d-e70200409791', 'p5030', '7c92f0c4-3fb9-50f8-ae42-ccb1995660fd', '1 BHK Flat in Kharadi', 'rent', 'Flat', 1, 65000, 'per-month', NULL, NULL, NULL, 1994, 'sqft', NULL, NULL, NULL, 'unfurnished', NULL, NULL, NULL, 'ready-to-move', 'Kharadi', 'kharadi', NULL, 'Pune', 18.560128029835408, 73.9395831459798, NULL, NULL, NULL, 'Spacious 1 BHK flat in Kharadi, Pune. Zero brokerage, deal directly with the verified owner.', '["gym", "power"]', '["https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'pending', false, NULL, true, true, true, false, false, 4, 65, 43, true, 'listed', '{"postedByStaff": "e6621d3a-3e31-5022-a6c9-34a90c8f6e9b"}', false, NULL, NULL, '2026-06-04 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('d2bbb508-9b79-59b7-9657-d617ad57b74e', 'p5031', '6e0d6446-90ad-5b90-89aa-617a89f387a0', '1 RK Studio in Undri', 'buy', 'Studio', 1, 14790600, 'total', NULL, NULL, NULL, 2241, 'sqft', NULL, NULL, NULL, 'semi-furnished', NULL, NULL, NULL, 'ready-to-move', 'Undri', 'undri', NULL, 'Pune', 18.464952824745325, 73.92233057527152, NULL, NULL, NULL, 'Spacious 1 RK studio in Undri, Pune. Zero brokerage, deal directly with the verified owner.', '["lift", "parking", "security", "club"]', '["https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'flagged', false, 'Price looks off', true, true, false, false, false, 4, 561, 42, false, NULL, '{}', false, NULL, NULL, '2026-05-14 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('65684789-52c5-5212-b2d9-70e344b464fa', 'p5032', '51a4c85a-d1f6-5602-9d71-78393d8abd3c', '1 RK Plot in Pimple Saudagar', 'rent', 'Plot', 1, 35000, 'per-month', NULL, NULL, NULL, 1049, 'sqft', NULL, NULL, NULL, 'furnished', NULL, NULL, NULL, NULL, 'Pimple Saudagar', 'pimple-saudagar', NULL, 'Pune', 18.60430274582654, 73.80771828490776, NULL, NULL, NULL, 'Spacious 1 RK plot in Pimple Saudagar, Pune. Zero brokerage, deal directly with the verified owner.', '["gym", "lift", "pool", "club"]', '["https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'approved', false, NULL, false, false, true, false, false, 2, 2364, 1, false, NULL, '{}', false, NULL, NULL, '2026-05-26 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('5fdcd76e-966b-59ee-9320-f23f7348a5a3', 'p5033', '6702a32f-999e-550b-ba01-32db68d89707', '1 BHK Penthouse in Balewadi', 'rent', 'Penthouse', 1, 16000, 'per-month', NULL, NULL, NULL, 1119, 'sqft', NULL, NULL, NULL, 'semi-furnished', NULL, NULL, NULL, 'ready-to-move', 'Balewadi', 'balewadi', NULL, 'Pune', 18.583123434265143, 73.77614154855534, NULL, NULL, NULL, 'Spacious 1 BHK penthouse in Balewadi, Pune. Zero brokerage, deal directly with the verified owner.', '["power", "pool"]', '["https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'approved', false, NULL, true, true, true, false, false, 2, 797, 5, false, NULL, '{}', false, NULL, NULL, '2026-06-04 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('291e5cb6-b46b-5f83-aae4-a1c5e27761bf', 'p5034', '3ad0171b-3206-53e2-b6dc-732bf4e1b44c', '2 BHK Penthouse in Pimple Saudagar', 'rent', 'Penthouse', 2, 34000, 'per-month', NULL, NULL, NULL, 821, 'sqft', NULL, NULL, NULL, 'furnished', NULL, NULL, NULL, 'ready-to-move', 'Pimple Saudagar', 'pimple-saudagar', NULL, 'Pune', 18.595861288702114, 73.8112982481206, NULL, NULL, NULL, 'Spacious 2 BHK penthouse in Pimple Saudagar, Pune. Zero brokerage, deal directly with the verified owner.', '["lift", "parking", "security", "power", "pool"]', '["https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'approved', false, NULL, true, true, false, false, false, 6, 1038, 34, false, NULL, '{}', false, NULL, NULL, '2026-06-02 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('d92efc2e-a501-589d-b6ea-6d3173c5c59d', 'p5035', '0505d7d5-3062-5abc-a33b-fc0e45bde6c5', '2 BHK Studio in Magarpatta', 'rent', 'Studio', 2, 36000, 'per-month', NULL, NULL, NULL, 1442, 'sqft', NULL, NULL, NULL, 'furnished', NULL, NULL, NULL, 'ready-to-move', 'Magarpatta', 'magarpatta', NULL, 'Pune', 18.51398133961856, 73.9220499491198, NULL, NULL, NULL, 'Spacious 2 BHK studio in Magarpatta, Pune. Zero brokerage, deal directly with the verified owner.', '["lift", "garden", "club", "play"]', '["https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'pending', false, NULL, true, true, true, false, false, 3, 1972, 55, false, NULL, '{}', false, NULL, NULL, '2026-06-02 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('e3b80978-d91f-5b92-b082-f321598591da', 'p5036', '19bdc371-5496-5930-af29-5ef3d8e6bb8b', '2 BHK Plot in Undri', 'buy', 'Plot', 2, 6910200, 'total', NULL, NULL, NULL, 1047, 'sqft', NULL, NULL, NULL, 'semi-furnished', NULL, NULL, NULL, NULL, 'Undri', 'undri', NULL, 'Pune', 18.454200743298045, 73.91395953995921, NULL, NULL, NULL, 'Spacious 2 BHK plot in Undri, Pune. Zero brokerage, deal directly with the verified owner.', '["gym", "parking", "security", "power", "pool", "garden", "club"]', '["https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'flagged', false, 'Suspected duplicate', true, true, true, false, false, 5, 748, 4, false, NULL, '{}', false, NULL, NULL, '2026-05-02 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('11d1c69c-2e33-55a8-ac83-af36deb1b31c', 'p5037', 'b877af02-d4b6-53e3-9aff-66637281e6d2', '4 BHK Penthouse in Undri', 'buy', 'Penthouse', 4, 15001800, 'total', NULL, NULL, NULL, 2273, 'sqft', NULL, NULL, NULL, 'semi-furnished', NULL, NULL, NULL, 'under-construction', 'Undri', 'undri', NULL, 'Pune', 18.46414387708623, 73.90872831581906, NULL, NULL, NULL, 'Spacious 4 BHK penthouse in Undri, Pune. Zero brokerage, deal directly with the verified owner.', '["power", "pool", "club", "play"]', '["https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'pending', false, NULL, true, true, false, false, false, 3, 570, 44, true, 'docs_submitted', '{"postedByStaff": "e6621d3a-3e31-5022-a6c9-34a90c8f6e9b"}', false, NULL, NULL, '2026-05-18 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('3b7a0839-a64a-5686-b459-6589e78fbd8e', 'p5000', '19bdc371-5496-5930-af29-5ef3d8e6bb8b', '4 BHK Villa in Magarpatta', 'rent', 'Villa', 4, 64000, 'per-month', NULL, NULL, NULL, 2098, 'sqft', NULL, NULL, NULL, 'semi-furnished', NULL, NULL, NULL, 'ready-to-move', 'Magarpatta', 'magarpatta', NULL, 'Pune', 18.518354770423844, 73.92696110915114, NULL, NULL, NULL, 'Spacious 4 BHK villa in Magarpatta, Pune. Zero brokerage, deal directly with the verified owner.', '["parking", "security", "power", "garden", "play"]', '["https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'approved', false, NULL, false, false, false, false, false, 5, 2064, 35, false, NULL, '{}', false, NULL, NULL, '2026-04-24 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('2b49c102-4f97-5ef1-bd2a-1559640f071a', 'p5001', 'e1e2d40c-f128-5694-ae78-490b413567ee', '3 BHK Plot in Bavdhan', 'buy', 'Plot', 3, 15611200, 'total', NULL, NULL, NULL, 1774, 'sqft', NULL, NULL, NULL, 'furnished', NULL, NULL, NULL, NULL, 'Bavdhan', 'bavdhan', NULL, 'Pune', 18.52215542258788, 73.78150444875286, NULL, NULL, NULL, 'Spacious 3 BHK plot in Bavdhan, Pune. Zero brokerage, deal directly with the verified owner.', '["gym", "security", "pool", "play"]', '["https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'pending', false, NULL, true, true, false, false, false, 4, 2141, 15, false, NULL, '{}', false, NULL, NULL, '2026-05-28 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, built_up_area, super_built_up_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, society_id, city, lat, lng, address, pincode, rera_id, description, amenities, images, cover_image, floor_plan, video, posted_by_type, status, featured, flag_reason, verified, owner_verified, ownership_verified, society_verified, conveyance_done, docs_count, views, enquiries, posted_by_admin, pipeline_stage, admin_pipeline, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('51897b51-f1a2-56ce-9687-2be847ff4dee', 'p5002', '3ad0171b-3206-53e2-b6dc-732bf4e1b44c', '3 BHK Penthouse in Kothrud', 'buy', 'Penthouse', 3, 14761600, 'total', NULL, NULL, NULL, 1318, 'sqft', NULL, NULL, NULL, 'semi-furnished', NULL, NULL, NULL, 'under-construction', 'Kothrud', 'kothrud', NULL, 'Pune', 18.513393518578262, 73.80323283957597, NULL, NULL, NULL, 'Spacious 3 BHK penthouse in Kothrud, Pune. Zero brokerage, deal directly with the verified owner.', '["gym", "power", "garden", "play"]', '["https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70', NULL, NULL, 'owner', 'flagged', false, 'Photos mismatch', true, true, true, false, false, 1, 153, 45, false, NULL, '{}', false, NULL, NULL, '2026-06-21 00:00:00+05:30', '2026-07-30 10:57:54.798311+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.contact_requests (id, property_id, requester_id, status, message, created_at, updated_at) VALUES ('2f941a03-28ca-5cdd-820c-2e8b47db87b2', '3b7a0839-a64a-5686-b459-6589e78fbd8e', 'c68b2dc8-89a7-5180-b94c-8daa349ff2fc', 'approved', 'Hi, is this still available? Looking to move in next month.', '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.contact_requests (id, property_id, requester_id, status, message, created_at, updated_at) VALUES ('d9b96dff-b035-594c-aa91-2d27350c8bf9', '8996ddbc-d9ea-5ca3-83bb-fd14c3f430f7', '569a14d9-004f-5c1a-b2b5-bc1e35d657e8', 'pending', 'Interested — can we schedule a visit this weekend?', '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.contact_requests (id, property_id, requester_id, status, message, created_at, updated_at) VALUES ('f4ff12f6-3b6a-515f-8018-14ede383022a', '0dcd8871-ffdd-56d6-b989-be6f53aa579e', '74feff4f-f669-5adc-93d5-bd1ad0d0e2a9', 'approved', 'Is the price negotiable? Zero brokerage confirmed?', '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.contact_requests (id, property_id, requester_id, status, message, created_at, updated_at) VALUES ('e5067922-9ad1-55ad-9315-6c7b5ff353ad', '9ecd9412-9bdd-5ecd-8600-0d0b70a4d868', '24daef28-5a4d-58af-af85-ec1cdde8540d', 'declined', 'Please share the exact society and floor details.', '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.contact_requests (id, property_id, requester_id, status, message, created_at, updated_at) VALUES ('ea696ae7-0787-5add-87f2-1de7923f1a20', 'b72f5635-afe1-5c5e-b6d6-381295cd4f0e', '65e66346-62d0-525f-be12-81d3f1868f06', 'pending', 'Family of three, no pets. When can I see the flat?', '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.contact_requests (id, property_id, requester_id, status, message, created_at, updated_at) VALUES ('672238ae-a58f-534f-bff7-b6ebd5fccd10', 'f7140411-1046-5096-a038-126bb676e06b', '758f8534-ee2d-5075-ab65-8e89bb294047', 'approved', 'Do you accept company lease? Need it by month-end.', '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.contact_requests (id, property_id, requester_id, status, message, created_at, updated_at) VALUES ('169014d9-59d0-5c29-ac3e-61be93cf9401', '995e2cbb-c454-502c-98d0-cdb0853fb8de', '14ebad35-1376-5f40-8f53-e910ef773a6a', 'pending', 'Are documents verified? Keen to proceed quickly.', '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.contact_requests (id, property_id, requester_id, status, message, created_at, updated_at) VALUES ('01887d2d-383b-5134-8dc5-25ceee8661bc', '1078d711-d3eb-5961-ab3c-30d4bdc5f377', '4588d5ce-b4e0-53a0-a181-2c26bbcecf67', 'approved', 'Can I get a video walkthrough before visiting?', '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.conversations (id, user_a_id, user_b_id, property_id, last_message, created_at, updated_at) VALUES ('60547b23-b982-53e5-a5de-625bd964aa20', '74feff4f-f669-5adc-93d5-bd1ad0d0e2a9', 'de87779e-383b-5916-bc80-b3ee85c4fcab', '8996ddbc-d9ea-5ca3-83bb-fd14c3f430f7', 'Sure, evening works. See you then.', '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.conversations (id, user_a_id, user_b_id, property_id, last_message, created_at, updated_at) VALUES ('0c9cdc1b-0793-56b8-801e-831a15348a28', '24daef28-5a4d-58af-af85-ec1cdde8540d', 'f619aa88-84ed-50ce-9a07-abb7712afa9d', '0dcd8871-ffdd-56d6-b989-be6f53aa579e', 'Sure, evening works. See you then.', '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.conversations (id, user_a_id, user_b_id, property_id, last_message, created_at, updated_at) VALUES ('fdff056a-eb12-5caa-a37d-220a639bf365', '65e66346-62d0-525f-be12-81d3f1868f06', '6e0d6446-90ad-5b90-89aa-617a89f387a0', '9ecd9412-9bdd-5ecd-8600-0d0b70a4d868', 'Sure, evening works. See you then.', '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.conversations (id, user_a_id, user_b_id, property_id, last_message, created_at, updated_at) VALUES ('bb010b61-0294-5b19-954f-23a4e5bcaef1', '19bdc371-5496-5930-af29-5ef3d8e6bb8b', '569a14d9-004f-5c1a-b2b5-bc1e35d657e8', '3b7a0839-a64a-5686-b459-6589e78fbd8e', 'Sure, evening works. See you then.', '2026-07-29 22:33:54.213947+05:30', '2026-08-04 18:59:18.151657+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.messages (id, conversation_id, author_id, author_role, body, attachments, read, created_at) VALUES ('7e14d00b-af31-54a4-8f43-5945ab1a2f27', 'bb010b61-0294-5b19-954f-23a4e5bcaef1', '569a14d9-004f-5c1a-b2b5-bc1e35d657e8', 'buyer', 'Hi, I saw your listing on Draazy. Is it available?', '[]', true, '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.messages (id, conversation_id, author_id, author_role, body, attachments, read, created_at) VALUES ('85bc4b3e-0f25-5725-aef1-f766f3619484', 'bb010b61-0294-5b19-954f-23a4e5bcaef1', '19bdc371-5496-5930-af29-5ef3d8e6bb8b', 'owner', 'Yes it is. Would you like to schedule a visit?', '[]', true, '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.messages (id, conversation_id, author_id, author_role, body, attachments, read, created_at) VALUES ('560fe46b-1774-5fe3-994c-9ac4e9e01ccf', 'bb010b61-0294-5b19-954f-23a4e5bcaef1', '569a14d9-004f-5c1a-b2b5-bc1e35d657e8', 'buyer', 'Great — can I come this Saturday evening?', '[]', false, '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.messages (id, conversation_id, author_id, author_role, body, attachments, read, created_at) VALUES ('63a30090-835e-59b7-934f-7457cdfcafdb', 'bb010b61-0294-5b19-954f-23a4e5bcaef1', '19bdc371-5496-5930-af29-5ef3d8e6bb8b', 'owner', 'Sure, evening works. See you then.', '[]', false, '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.messages (id, conversation_id, author_id, author_role, body, attachments, read, created_at) VALUES ('b0b286fb-f5fb-5a46-aeff-b272114b4cf4', '60547b23-b982-53e5-a5de-625bd964aa20', '74feff4f-f669-5adc-93d5-bd1ad0d0e2a9', 'buyer', 'Hi, I saw your listing on Draazy. Is it available?', '[]', true, '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.messages (id, conversation_id, author_id, author_role, body, attachments, read, created_at) VALUES ('f625e133-7909-5808-b9dc-d08d18fe0378', '60547b23-b982-53e5-a5de-625bd964aa20', 'de87779e-383b-5916-bc80-b3ee85c4fcab', 'owner', 'Yes it is. Would you like to schedule a visit?', '[]', true, '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.messages (id, conversation_id, author_id, author_role, body, attachments, read, created_at) VALUES ('d6711a4e-b087-5837-b4e1-4b8ac0dce40a', '60547b23-b982-53e5-a5de-625bd964aa20', '74feff4f-f669-5adc-93d5-bd1ad0d0e2a9', 'buyer', 'Great — can I come this Saturday evening?', '[]', false, '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.messages (id, conversation_id, author_id, author_role, body, attachments, read, created_at) VALUES ('39b678e9-eff9-5114-b11d-b41f1e6d2561', '60547b23-b982-53e5-a5de-625bd964aa20', 'de87779e-383b-5916-bc80-b3ee85c4fcab', 'owner', 'Sure, evening works. See you then.', '[]', false, '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.messages (id, conversation_id, author_id, author_role, body, attachments, read, created_at) VALUES ('b0d7686a-61a4-5912-931e-421509a411fd', '0c9cdc1b-0793-56b8-801e-831a15348a28', '24daef28-5a4d-58af-af85-ec1cdde8540d', 'buyer', 'Hi, I saw your listing on Draazy. Is it available?', '[]', true, '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.messages (id, conversation_id, author_id, author_role, body, attachments, read, created_at) VALUES ('800921a2-b927-53ec-85f9-94e131fa074a', '0c9cdc1b-0793-56b8-801e-831a15348a28', 'f619aa88-84ed-50ce-9a07-abb7712afa9d', 'owner', 'Yes it is. Would you like to schedule a visit?', '[]', true, '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.messages (id, conversation_id, author_id, author_role, body, attachments, read, created_at) VALUES ('5de5968d-26a9-5d96-bb5f-193687626891', '0c9cdc1b-0793-56b8-801e-831a15348a28', '24daef28-5a4d-58af-af85-ec1cdde8540d', 'buyer', 'Great — can I come this Saturday evening?', '[]', false, '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.messages (id, conversation_id, author_id, author_role, body, attachments, read, created_at) VALUES ('97382100-5d1d-5377-a96c-ddffb69e6c39', '0c9cdc1b-0793-56b8-801e-831a15348a28', 'f619aa88-84ed-50ce-9a07-abb7712afa9d', 'owner', 'Sure, evening works. See you then.', '[]', false, '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.messages (id, conversation_id, author_id, author_role, body, attachments, read, created_at) VALUES ('76b233d4-c176-5ddb-a94f-11699295e869', 'fdff056a-eb12-5caa-a37d-220a639bf365', '65e66346-62d0-525f-be12-81d3f1868f06', 'buyer', 'Hi, I saw your listing on Draazy. Is it available?', '[]', true, '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.messages (id, conversation_id, author_id, author_role, body, attachments, read, created_at) VALUES ('850a8e4c-d484-505e-8325-f3a48f83306a', 'fdff056a-eb12-5caa-a37d-220a639bf365', '6e0d6446-90ad-5b90-89aa-617a89f387a0', 'owner', 'Yes it is. Would you like to schedule a visit?', '[]', true, '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.messages (id, conversation_id, author_id, author_role, body, attachments, read, created_at) VALUES ('dc921ec3-52e9-5a99-8419-dd7b6cdde872', 'fdff056a-eb12-5caa-a37d-220a639bf365', '65e66346-62d0-525f-be12-81d3f1868f06', 'buyer', 'Great — can I come this Saturday evening?', '[]', false, '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.messages (id, conversation_id, author_id, author_role, body, attachments, read, created_at) VALUES ('cbd6e0a8-50aa-5e5c-b805-09d325062604', 'fdff056a-eb12-5caa-a37d-220a639bf365', '6e0d6446-90ad-5b90-89aa-617a89f387a0', 'owner', 'Sure, evening works. See you then.', '[]', false, '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.visits (id, property_id, visitor_id, slot, mode, status, note, created_at, updated_at) VALUES ('79342d75-8d87-5dc3-8558-51944dedb424', '3b7a0839-a64a-5686-b459-6589e78fbd8e', '24daef28-5a4d-58af-af85-ec1cdde8540d', '2026-08-01 22:33:54.213947+05:30', 'in-person', 'confirmed', 'Prefer evening slot after 6pm.', '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.visits (id, property_id, visitor_id, slot, mode, status, note, created_at, updated_at) VALUES ('0a89e1fc-a4a4-5f33-85d2-fa72e6de904a', '8996ddbc-d9ea-5ca3-83bb-fd14c3f430f7', '65e66346-62d0-525f-be12-81d3f1868f06', '2026-08-02 22:33:54.213947+05:30', 'in-person', 'scheduled', 'Prefer evening slot after 6pm.', '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.visits (id, property_id, visitor_id, slot, mode, status, note, created_at, updated_at) VALUES ('ad72093f-d78c-577a-a2f5-c82f009d4711', '0dcd8871-ffdd-56d6-b989-be6f53aa579e', '758f8534-ee2d-5075-ab65-8e89bb294047', '2026-08-03 22:33:54.213947+05:30', 'in-person', 'completed', 'Prefer evening slot after 6pm.', '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.visits (id, property_id, visitor_id, slot, mode, status, note, created_at, updated_at) VALUES ('e72703f0-0424-5116-8923-74d597470f28', '9ecd9412-9bdd-5ecd-8600-0d0b70a4d868', '14ebad35-1376-5f40-8f53-e910ef773a6a', '2026-08-04 22:33:54.213947+05:30', 'in-person', 'scheduled', 'Prefer evening slot after 6pm.', '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.visits (id, property_id, visitor_id, slot, mode, status, note, created_at, updated_at) VALUES ('9d541fae-eb2d-58ac-87a9-9872e48987f5', 'b72f5635-afe1-5c5e-b6d6-381295cd4f0e', '4588d5ce-b4e0-53a0-a181-2c26bbcecf67', '2026-08-05 22:33:54.213947+05:30', 'in-person', 'confirmed', 'Prefer evening slot after 6pm.', '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;


-- Fixture IDs use `f1c7` prefixes and fixed timestamps for deterministic assertions.
-- Fixture users have no password hashes, credentials, or session tokens.
INSERT INTO public.users (id, name, mobile, role, status, city, mobile_verified, verified, joined_at, created_at, updated_at) VALUES ('f1c70000-0000-4000-8000-000000000001', 'Rahul Mehta', '9700000001', 'buyer', 'active', 'Pune', true, true, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, role, status, city, mobile_verified, verified, joined_at, created_at, updated_at) VALUES ('f1c70000-0000-4000-8000-000000000002', 'Priya Nair', '9700000002', 'buyer', 'active', 'Pune', true, true, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, role, status, city, mobile_verified, verified, joined_at, created_at, updated_at) VALUES ('f1c70000-0000-4000-8000-000000000003', 'Arjun Rao', '9700000003', 'buyer', 'active', 'Pune', true, false, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30')
    ON CONFLICT DO NOTHING;

INSERT INTO public.saved_properties (user_id, property_id, created_at) VALUES ('f1c70000-0000-4000-8000-000000000001', '615287b3-7a3b-530f-84aa-773753e8682b', '2026-08-02 10:00:00+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.saved_properties (user_id, property_id, created_at) VALUES ('f1c70000-0000-4000-8000-000000000001', '291e5cb6-b46b-5f83-aae4-a1c5e27761bf', '2026-08-02 10:05:00+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.saved_properties (user_id, property_id, created_at) VALUES ('f1c70000-0000-4000-8000-000000000001', '8c6141a4-9acf-5d2b-8cb7-7795f9aa70c7', '2026-08-02 10:07:00+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.saved_searches (id, user_id, name, query, filters, alert_frequency, channel, new_count, kind, label, created_at, updated_at) VALUES ('f1c70001-0000-4000-8000-000000000001', 'f1c70000-0000-4000-8000-000000000001', '2 BHK in Kharadi', 'deal=buy&type=flat&bhk=2&locality=kharadi', '{"bhk": [2], "deal": "buy", "locality": ["kharadi"]}', 'daily', 'whatsapp', 0, 'listings', '2 BHK in Kharadi', '2026-08-02 10:10:00+05:30', '2026-08-02 10:10:00+05:30')
    ON CONFLICT DO NOTHING;

INSERT INTO public.notifications (id, user_id, type, title, body, read, link, created_at) VALUES ('f1c70002-0000-4000-8000-000000000001', 'f1c70000-0000-4000-8000-000000000001', 'saved.search.match', 'A new 2 BHK matches your Kharadi alert', 'One new listing matched "2 BHK in Kharadi" since you last looked.', false, '/listings?deal=buy&locality=kharadi', '2026-08-03 09:00:00+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.notifications (id, user_id, type, title, body, read, link, created_at) VALUES ('f1c70002-0000-4000-8000-000000000002', 'f1c70000-0000-4000-8000-000000000001', 'contact.request.approved', 'Meera Deshpande shared her number', 'Your contact request on p5021 was approved.', true, '/property/615287b3-7a3b-530f-84aa-773753e8682b', '2026-08-03 11:00:00+05:30')
    ON CONFLICT DO NOTHING;

INSERT INTO public.reviews (id, target_type, target_id, author_id, rating, title, body, status, context, categories, recommend, created_at, updated_at) VALUES ('f1c70003-0000-4000-8000-000000000001', 'property', '615287b3-7a3b-530f-84aa-773753e8682b', 'f1c70000-0000-4000-8000-000000000001', 4, 'Well kept, honest listing', 'Photos matched the flat. Society is quiet and the owner was upfront about the maintenance dues.', 'published', 'visit', '{"accuracy": 5, "locality": 4, "condition": 4}', true, '2026-08-04 18:00:00+05:30', '2026-08-04 18:00:00+05:30')
    ON CONFLICT DO NOTHING;

INSERT INTO public.reports (id, target_type, target_id, reporter_id, reason, details, status, created_at, updated_at) VALUES ('f1c70004-0000-4000-8000-000000000001', 'property', '51897b51-f1a2-56ce-9687-2be847ff4dee', 'f1c70000-0000-4000-8000-000000000003', 'fake', 'The same photos appear on another listing in Kothrud at a different price.', 'open', '2026-08-04 12:00:00+05:30', '2026-08-04 12:00:00+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.reports (id, target_type, target_id, reporter_id, reason, details, status, created_at, updated_at) VALUES ('f1c70004-0000-4000-8000-000000000002', 'property', '51897b51-f1a2-56ce-9687-2be847ff4dee', 'f1c70000-0000-4000-8000-000000000002', 'pricing', 'Asking price is nearly double what the same society quoted me last month.', 'reviewing', '2026-08-04 13:30:00+05:30', '2026-08-04 13:30:00+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.reports (id, target_type, target_id, reporter_id, reason, details, status, created_at, updated_at) VALUES ('f1c70004-0000-4000-8000-000000000003', 'property', '51897b51-f1a2-56ce-9687-2be847ff4dee', 'f1c70000-0000-4000-8000-000000000001', 'broker', 'Person who answered said he handles several flats in the building.', 'dismissed', '2026-08-03 17:15:00+05:30', '2026-08-03 17:15:00+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.reports (id, target_type, target_id, reporter_id, reason, details, status, created_at, updated_at) VALUES ('f1c70004-0000-4000-8000-000000000004', 'user', 'f1c70000-0000-4000-8000-000000000001', 'f1c70000-0000-4000-8000-000000000002', 'brokerage', 'Asked for a two-month brokerage fee before agreeing to a viewing.', 'open', '2026-08-04 09:45:00+05:30', '2026-08-04 09:45:00+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.reports (id, target_type, target_id, reporter_id, reason, details, status, created_at, updated_at) VALUES ('f1c70004-0000-4000-8000-000000000005', 'user', 'f1c70000-0000-4000-8000-000000000001', 'f1c70000-0000-4000-8000-000000000003', 'abuse', 'Rude and threatening messages after I declined the flat.', 'actioned', '2026-08-02 11:20:00+05:30', '2026-08-02 11:20:00+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.reports (id, target_type, target_id, reporter_id, reason, details, status, created_at, updated_at) VALUES ('f1c70004-0000-4000-8000-000000000006', 'post', 'f1c7000b-0000-4000-8000-000000000002', 'f1c70000-0000-4000-8000-000000000002', 'filled', 'Seat was taken weeks ago — host confirmed on call but the post is still up.', 'open', '2026-08-06 15:10:00+05:30', '2026-08-06 15:10:00+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.reports (id, target_type, target_id, reporter_id, reason, details, status, created_at, updated_at) VALUES ('f1c70004-0000-4000-8000-000000000007', 'post', 'f1c7000d-0000-4000-8000-000000000001', 'f1c70000-0000-4000-8000-000000000003', 'broker', 'Listed as a tenant looking for flatmates, but he is charging a finder fee per seat.', 'reviewing', '2026-08-06 16:40:00+05:30', '2026-08-06 16:40:00+05:30')
    ON CONFLICT DO NOTHING;

INSERT INTO public.support_tickets (id, user_id, subject, category, status, unread, staff_unread, created_at, updated_at) VALUES ('f1c70005-0000-4000-8000-000000000001', 'f1c70000-0000-4000-8000-000000000002', 'Rent receipt for July is missing', 'rent', 'open', false, true, '2026-08-05 09:30:00+05:30', '2026-08-05 09:45:00+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.support_ticket_messages (id, ticket_id, author_id, author_role, body, created_at) VALUES ('f1c70005-1000-4000-8000-000000000001', 'f1c70005-0000-4000-8000-000000000001', 'f1c70000-0000-4000-8000-000000000002', 'buyer', 'I paid July rent on the 3rd but the receipt never arrived by WhatsApp.', '2026-08-05 09:30:00+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.support_ticket_messages (id, ticket_id, author_id, author_role, body, created_at) VALUES ('f1c70005-1000-4000-8000-000000000002', 'f1c70005-0000-4000-8000-000000000001', NULL, 'staff', 'Thanks for flagging — we can see the payment and are re-sending the receipt now.', '2026-08-05 09:45:00+05:30')
    ON CONFLICT DO NOTHING;

INSERT INTO public.deals (id, property_id, deal, counterparty_id, counterparty_mobile, agreed_price, status, note, created_at, updated_at) VALUES ('f1c70006-0000-4000-8000-000000000001', '615287b3-7a3b-530f-84aa-773753e8682b', 'buy', 'f1c70000-0000-4000-8000-000000000001', '9700000001', 8900000, 'active', 'Buyer has arranged a home loan; awaiting sanction letter.', '2026-08-06 10:00:00+05:30', '2026-08-06 10:00:00+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.deal_parties (id, deal_id, name, mobile, note, created_at, updated_at) VALUES ('f1c70006-1000-4000-8000-000000000001', 'f1c70006-0000-4000-8000-000000000001', 'Rahul Mehta', '9700000001', 'Primary buyer', '2026-08-06 10:00:00+05:30', '2026-08-06 10:00:00+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.offers (id, property_id, from_user_id, amount, status, message, move_in, created_at, updated_at) VALUES ('f1c70007-0000-4000-8000-000000000001', '615287b3-7a3b-530f-84aa-773753e8682b', 'f1c70000-0000-4000-8000-000000000001', 8900000, 'pending', 'Can close in 45 days if the society NOC is ready.', '2026-10-01', '2026-08-06 10:05:00+05:30', '2026-08-06 10:05:00+05:30')
    ON CONFLICT DO NOTHING;

INSERT INTO public.conversations (id, user_a_id, user_b_id, property_id, last_message, created_at, updated_at) VALUES ('f1c70006-0000-4000-8000-000000000001', '3ad0171b-3206-53e2-b6dc-732bf4e1b44c', 'f1c70000-0000-4000-8000-000000000001', '615287b3-7a3b-530f-84aa-773753e8682b', 'Thursday after six suits me. I will share the gate code.', '2026-08-06 10:00:00+05:30', '2026-08-06 10:20:00+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.messages (id, conversation_id, author_id, author_role, body, attachments, read, created_at) VALUES ('f1c70007-0000-4000-8000-000000000001', 'f1c70006-0000-4000-8000-000000000001', 'f1c70000-0000-4000-8000-000000000001', 'buyer', 'Hello, is the Baner flat still available for a Thursday viewing?', '[]', true, '2026-08-06 10:00:00+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.messages (id, conversation_id, author_id, author_role, body, attachments, read, created_at) VALUES ('f1c70007-0000-4000-8000-000000000002', 'f1c70006-0000-4000-8000-000000000001', '3ad0171b-3206-53e2-b6dc-732bf4e1b44c', 'owner', 'It is. Thursday after six suits me. I will share the gate code.', '[]', false, '2026-08-06 10:20:00+05:30')
    ON CONFLICT DO NOTHING;

INSERT INTO public.tenancies (id, property_id, tenant_id, owner_id, rent, deposit, start_date, end_date, status, created_at, updated_at) VALUES ('f1c70008-0000-4000-8000-000000000001', '1078d711-d3eb-5961-ab3c-30d4bdc5f377', 'f1c70000-0000-4000-8000-000000000002', '3ad0171b-3206-53e2-b6dc-732bf4e1b44c', 38000, 76000, '2026-06-01', '2027-05-31', 'active', '2026-05-25 10:00:00+05:30', '2026-05-25 10:00:00+05:30')
    ON CONFLICT DO NOTHING;

INSERT INTO public.visits (id, property_id, visitor_id, slot, mode, status, note, created_at, updated_at) VALUES ('f1c7000a-0000-4000-8000-000000000001', '291e5cb6-b46b-5f83-aae4-a1c5e27761bf', 'f619aa88-84ed-50ce-9a07-abb7712afa9d', '2026-08-08 11:00:00+05:30', 'in-person', 'scheduled', 'Weekend morning suits me best.', '2026-08-05 10:00:00+05:30', '2026-08-05 10:00:00+05:30')
    ON CONFLICT DO NOTHING;

INSERT INTO public.flatmate_rooms (id, host_id, room_type, budget, locality, localities, bhk, furnishing, attached_bath, host_role, note, mod_status, created_at, updated_at) VALUES ('f1c7000b-0000-4000-8000-000000000001', '3ad0171b-3206-53e2-b6dc-732bf4e1b44c', 'Private room', 16000, 'Baner', '["Baner"]'::jsonb, '2', 'semi', 'attached', 'owner', 'Quiet corner room, balcony faces the garden.', 'approved', '2026-08-06 09:00:00+05:30', '2026-08-06 09:00:00+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.flatmate_rooms (id, host_id, room_type, budget, locality, localities, bhk, furnishing, attached_bath, host_role, note, mod_status, created_at, updated_at) VALUES ('f1c7000b-0000-4000-8000-000000000002', 'f619aa88-84ed-50ce-9a07-abb7712afa9d', 'Shared room', 9500, 'Wakad', '["Wakad"]'::jsonb, '3', 'furnished', 'shared', 'tenant', 'Sharing with two working professionals.', 'approved', '2026-08-06 09:05:00+05:30', '2026-08-06 09:05:00+05:30')
    ON CONFLICT DO NOTHING;

INSERT INTO public.flatmate_seeker_posts (id, user_id, name, budget, localities, note, mod_status, created_at, updated_at) VALUES ('f1c7000c-0000-4000-8000-000000000001', 'f1c70000-0000-4000-8000-000000000001', 'Rahul Mehta', 15000, '["Baner","Aundh"]'::jsonb, 'Moving for work, looking for a private room near the Hinjewadi line.', 'approved', '2026-08-06 09:10:00+05:30', '2026-08-06 09:10:00+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.flatmate_seeker_posts (id, user_id, name, budget, localities, note, mod_status, created_at, updated_at) VALUES ('f1c7000c-0000-4000-8000-000000000002', 'f1c70000-0000-4000-8000-000000000002', 'Priya Nair', 12000, '["Kharadi"]'::jsonb, 'Happy either way on private or shared.', 'approved', '2026-08-06 09:15:00+05:30', '2026-08-06 09:15:00+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.flatmate_seeker_posts (id, user_id, name, budget, localities, note, verified, mod_status, created_at, updated_at) VALUES ('f1c7000c-0000-4000-8000-000000000003', '3ad0171b-3206-53e2-b6dc-732bf4e1b44c', 'Meera Deshpande', 22000, '["Baner","Balewadi"]'::jsonb, 'Letting out a room in my own flat while I am posted out of the city for a year.', true, 'approved', '2026-08-06 09:20:00+05:30', '2026-08-06 09:20:00+05:30')
    ON CONFLICT DO NOTHING;

INSERT INTO public.flatmate_groups (id, host_id, title, locality, rent, seats_total, seats_open, host_role, note, mod_status, created_at, updated_at) VALUES ('f1c7000d-0000-4000-8000-000000000001', 'f619aa88-84ed-50ce-9a07-abb7712afa9d', 'Two seats in a 3 BHK, Kharadi', 'Kharadi', 42000, 3, 1, 'tenant', 'Lease starts next month, split three ways.', 'approved', '2026-08-06 09:20:00+05:30', '2026-08-06 09:20:00+05:30')
    ON CONFLICT DO NOTHING;

-- `owner_verified` mirrors each owner's identity badge.
UPDATE public.properties p
   SET owner_verified = u.verified
  FROM public.users u
 WHERE u.id = p.owner_id
   AND p.owner_verified IS DISTINCT FROM u.verified;


INSERT INTO public.faqs (id, question, answer, category) VALUES
  ('fa900001-0000-4000-8000-00000000f001',
   'Is Draazy really zero brokerage?',
   'Yes — always. You connect directly with verified owners and pay zero brokerage on any rent or resale deal. We earn only from optional owner plans and add-on services like rent agreements, never a cut of your rent or deposit.',
   'General'),
  ('fa900001-0000-4000-8000-00000000f002',
   'How are owners and listings verified?',
   'Every verified owner has had a government ID and a live selfie reviewed by our trust team, and wherever possible we confirm ownership documents before a listing goes live. Verified listings carry a badge. If something looks off, use ''Report listing'' and our trust team reviews it within 24 hours.',
   'Trust'),
  ('fa900001-0000-4000-8000-00000000f003',
   'How do I contact an owner or schedule a visit?',
   'Open any listing and tap ''Contact owner'' to get their number, or use ''Schedule visit'' to pick a date and time slot. You''ll see the owner''s response in Messages and get an SMS update — no broker sits in between.',
   'Seekers'),
  ('fa900001-0000-4000-8000-00000000f004',
   'Can I list my property for free?',
   'Yes. A basic listing with photos, rent and amenities is free for owners. Paid plans add featured placement, more buyer contacts and priority support — start free and upgrade any time from your dashboard.',
   'Owners'),
  ('fa900001-0000-4000-8000-00000000f005',
   'Is my payment and deposit safe?',
   'Pay a deposit or rent only after you''ve visited the property and signed an agreement. Draazy never asks you to transfer a token to ''block'' a flat before a visit — treat any such request as a red flag and report it.',
   'Payments'),
  ('fa900001-0000-4000-8000-00000000f006',
   'Do you offer rent agreements?',
   'Yes — legally-valid drafting, e-stamping and doorstep biometric registration starting at ₹999. You fill the details online, we prepare the draft, and delivery is usually within 2–3 working days across Pune and PCMC.',
   'Services'),
  ('fa900001-0000-4000-8000-00000000f007',
   'Which areas of Pune do you cover?',
   'We''re Pune-first: Kothrud, Hinjewadi, Baner, Wakad, Kharadi, Viman Nagar, Hadapsar, PCMC and most other localities. Coverage keeps expanding — if your area is thin on listings, set an alert and we''ll notify you when new ones go live.',
   'Coverage'),
  ('fa900001-0000-4000-8000-00000000f008',
   'How do refunds work?',
   'Paid plans and services are refundable as per each plan''s terms. Approved refunds go back to your original payment method, typically within 5–7 working days. Raise a ticket above with your payment reference and we''ll track it for you.',
   'Payments'),
  ('fa900001-0000-4000-8000-00000000f009',
   'How do I report a suspicious listing or user?',
   'Use ''Report'' on any listing or message, or raise a ticket here under ''Technical / Bug'' or ''Something else''. Our trust team investigates within 24 hours and removes anything that breaks our policies.',
   'Trust')
    ON CONFLICT DO NOTHING;

UPDATE public.faqs SET translations = '{"mr": {"question": "पुणेनेस्ट खरंच शून्य दलाली आहे का?", "answer": "होय — नेहमीच. तुम्ही थेट पडताळणी केलेल्या मालकांशी संपर्क साधता आणि कोणत्याही भाडे किंवा पुनर्विक्री व्यवहारावर शून्य दलाली भरता.", "category": "सर्वसाधारण"}}'::jsonb
 WHERE id = 'fa900001-0000-4000-8000-00000000f001';

UPDATE public.faqs SET translations = '{"mr": {"question": "मालक आणि जाहिराती कशा पडताळल्या जातात?"}}'::jsonb
 WHERE id = 'fa900001-0000-4000-8000-00000000f002';

WITH soc AS (
    SELECT id,
           locality_slug,
           row_number() OVER (PARTITION BY locality_slug ORDER BY slug) - 1 AS rn,
           count(*) OVER (PARTITION BY locality_slug) AS n
      FROM public.societies
     WHERE locality_slug IS NOT NULL
), prop AS (
    SELECT id,
           locality_slug,
           row_number() OVER (PARTITION BY locality_slug ORDER BY slug) - 1 AS rn
      FROM public.properties
     WHERE slug ~ '^p50[0-9][0-9]$'
       AND society_id IS NULL
       AND locality_slug IS NOT NULL
       AND property_type IN ('Flat', 'Studio', 'Penthouse')
)
UPDATE public.properties p
   SET society_id = soc.id
  FROM prop, soc
 WHERE p.id = prop.id
   AND soc.locality_slug = prop.locality_slug
   AND soc.rn = prop.rn % soc.n;

UPDATE public.properties SET handback_milestone = 'photos_uploaded' WHERE slug = 'p5024';
UPDATE public.properties SET handback_milestone = 'claim_sent'      WHERE slug = 'p5037';

INSERT INTO public.users (id, name, mobile, role, status, city, mobile_verified, verified, listings_count, joined_at, created_at, updated_at) VALUES ('f1c70000-0000-4000-8000-000000000010', 'Sanjay Pathak', '9700000010', 'owner', 'active', 'Pune', true, true, 12, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30')
    ON CONFLICT DO NOTHING;

INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, price, price_unit, negotiable, area, area_unit, carpet_area, furnishing, total_floors, possession, locality, locality_slug, city, lat, lng, description, amenities, images, cover_image, floor_plan, posted_by_type, status, verified, owner_verified, ownership_verified, docs_count, views, enquiries, created_at, updated_at) VALUES
 ('f1c70000-0000-4000-8000-000000005101', 'p5101', 'f1c70000-0000-4000-8000-000000000010', 'Office Space in Baner', 'buy', 'Office Space', 22500000, 'total', true, 1800, 'sqft', 1520, 'unfurnished', 7, 'ready-to-move', 'Baner', 'baner', 'Pune', 18.559, 73.776, 'Office Space available on sale in Baner, Pune. Zero brokerage - deal directly with the verified owner.', '["parking", "power", "lift", "security"]', '["https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=800&q=70', '/floorplans/office.svg', 'owner', 'approved', true, true, true, 3, 180, 4, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005102', 'p5102', 'f1c70000-0000-4000-8000-000000000010', 'Shop / Showroom in Kharadi', 'buy', 'Shop / Showroom', 9800000, 'total', true, 650, 'sqft', 590, 'unfurnished', 2, 'ready-to-move', 'Kharadi', 'kharadi', 'Pune', 18.551, 73.941, 'Shop / Showroom available on sale in Kharadi, Pune. Zero brokerage - deal directly with the verified owner.', '["parking", "power", "security"]', '["https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1604719312566-8912e9227c6a?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=800&q=70', '/floorplans/shop.svg', 'owner', 'approved', true, true, true, 2, 142, 6, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005103', 'p5103', 'f1c70000-0000-4000-8000-000000000010', 'Retail / Mall Unit in Kalyani Nagar', 'buy', 'Retail / Mall Unit', 18500000, 'total', false, 1200, 'sqft', 1040, 'semi-furnished', 4, 'ready-to-move', 'Kalyani Nagar', 'kalyani-nagar', 'Pune', 18.548, 73.902, 'Retail / Mall Unit available on sale in Kalyani Nagar, Pune. Zero brokerage - deal directly with the verified owner.', '["parking", "power", "lift", "security"]', '["https://images.unsplash.com/photo-1567521464027-f127ff144326?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1519567241046-7f570eee3ce6?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1567521464027-f127ff144326?auto=format&fit=crop&w=800&q=70', '/floorplans/retail.svg', 'owner', 'approved', true, true, true, 3, 96, 2, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005104', 'p5104', 'f1c70000-0000-4000-8000-000000000010', 'Warehouse / Godown in Hadapsar', 'buy', 'Warehouse / Godown', 42000000, 'total', true, 6000, 'sqft', 5800, 'unfurnished', 1, 'ready-to-move', 'Hadapsar', 'hadapsar', 'Pune', 18.5, 73.926, 'Warehouse / Godown available on sale in Hadapsar, Pune. Zero brokerage - deal directly with the verified owner.', '["parking", "power", "security"]', '["https://images.unsplash.com/photo-1553413077-190dd305871c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1553413077-190dd305871c?auto=format&fit=crop&w=800&q=70', '/floorplans/warehouse.svg', 'owner', 'approved', true, true, true, 4, 71, 1, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005105', 'p5105', 'f1c70000-0000-4000-8000-000000000010', 'Industrial / Factory in Pimpri', 'buy', 'Industrial / Factory', 68000000, 'total', true, 12000, 'sqft', 11400, 'unfurnished', 1, 'ready-to-move', 'Pimpri', 'pimpri', 'Pune', 18.627, 73.805, 'Industrial / Factory available on sale in Pimpri, Pune. Zero brokerage - deal directly with the verified owner.', '["parking", "power", "security"]', '["https://images.unsplash.com/photo-1581092160562-40aa08e78837?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1565891741441-64926e441838?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1581092160562-40aa08e78837?auto=format&fit=crop&w=800&q=70', '/floorplans/industrial.svg', 'owner', 'approved', true, true, true, 5, 58, 1, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005106', 'p5106', 'f1c70000-0000-4000-8000-000000000010', 'Co-working Space in Viman Nagar', 'buy', 'Co-working Space', 31000000, 'total', false, 2400, 'sqft', 2050, 'furnished', 6, 'ready-to-move', 'Viman Nagar', 'viman-nagar', 'Pune', 18.567, 73.915, 'Co-working Space available on sale in Viman Nagar, Pune. Zero brokerage - deal directly with the verified owner.', '["parking", "power", "lift", "security", "club"]', '["https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=800&q=70', '/floorplans/coworking.svg', 'owner', 'approved', true, true, true, 3, 214, 9, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30')
    ON CONFLICT DO NOTHING;

INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, price, price_unit, deposit, negotiable, area, area_unit, carpet_area, furnishing, total_floors, possession, locality, locality_slug, city, lat, lng, description, amenities, images, cover_image, floor_plan, posted_by_type, status, verified, owner_verified, ownership_verified, docs_count, views, enquiries, created_at, updated_at) VALUES
 ('f1c70000-0000-4000-8000-000000005107', 'p5107', 'f1c70000-0000-4000-8000-000000000010', 'Office Space in Wakad', 'rent', 'Office Space', 135000, 'per-month', 810000, true, 1500, 'sqft', 1280, 'semi-furnished', 5, 'ready-to-move', 'Wakad', 'wakad', 'Pune', 18.598, 73.762, 'Office Space available on rent in Wakad, Pune. Zero brokerage - deal directly with the verified owner.', '["parking", "power", "lift", "security"]', '["https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=800&q=70', '/floorplans/office.svg', 'owner', 'approved', true, true, true, 3, 163, 5, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005108', 'p5108', 'f1c70000-0000-4000-8000-000000000010', 'Shop / Showroom in Magarpatta', 'rent', 'Shop / Showroom', 95000, 'per-month', 570000, true, 700, 'sqft', 640, 'unfurnished', 2, 'ready-to-move', 'Magarpatta', 'magarpatta', 'Pune', 18.516, 73.928, 'Shop / Showroom available on rent in Magarpatta, Pune. Zero brokerage - deal directly with the verified owner.', '["parking", "power", "security"]', '["https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1604719312566-8912e9227c6a?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=800&q=70', '/floorplans/shop.svg', 'owner', 'approved', true, true, true, 2, 118, 3, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005109', 'p5109', 'f1c70000-0000-4000-8000-000000000010', 'Retail / Mall Unit in Koregaon Park', 'rent', 'Retail / Mall Unit', 175000, 'per-month', 1050000, false, 1100, 'sqft', 960, 'semi-furnished', 3, 'ready-to-move', 'Koregaon Park', 'koregaon-park', 'Pune', 18.536, 73.893, 'Retail / Mall Unit available on rent in Koregaon Park, Pune. Zero brokerage - deal directly with the verified owner.', '["parking", "power", "lift", "security"]', '["https://images.unsplash.com/photo-1567521464027-f127ff144326?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1519567241046-7f570eee3ce6?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1567521464027-f127ff144326?auto=format&fit=crop&w=800&q=70', '/floorplans/retail.svg', 'owner', 'approved', true, true, true, 3, 132, 4, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005110', 'p5110', 'f1c70000-0000-4000-8000-000000000010', 'Warehouse / Godown in Pimpri', 'rent', 'Warehouse / Godown', 220000, 'per-month', 1320000, true, 5500, 'sqft', 5300, 'unfurnished', 1, 'ready-to-move', 'Pimpri', 'pimpri', 'Pune', 18.627, 73.805, 'Warehouse / Godown available on rent in Pimpri, Pune. Zero brokerage - deal directly with the verified owner.', '["parking", "power", "security"]', '["https://images.unsplash.com/photo-1553413077-190dd305871c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1553413077-190dd305871c?auto=format&fit=crop&w=800&q=70', '/floorplans/warehouse.svg', 'owner', 'approved', true, true, true, 4, 87, 2, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005111', 'p5111', 'f1c70000-0000-4000-8000-000000000010', 'Industrial / Factory in Hadapsar', 'rent', 'Industrial / Factory', 310000, 'per-month', 1860000, true, 9000, 'sqft', 8600, 'unfurnished', 1, 'ready-to-move', 'Hadapsar', 'hadapsar', 'Pune', 18.5, 73.926, 'Industrial / Factory available on rent in Hadapsar, Pune. Zero brokerage - deal directly with the verified owner.', '["parking", "power", "security"]', '["https://images.unsplash.com/photo-1581092160562-40aa08e78837?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1565891741441-64926e441838?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1581092160562-40aa08e78837?auto=format&fit=crop&w=800&q=70', '/floorplans/industrial.svg', 'owner', 'approved', true, true, true, 5, 64, 1, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005112', 'p5112', 'f1c70000-0000-4000-8000-000000000010', 'Co-working Space in Baner', 'rent', 'Co-working Space', 160000, 'per-month', 960000, false, 2000, 'sqft', 1750, 'furnished', 6, 'ready-to-move', 'Baner', 'baner', 'Pune', 18.559, 73.776, 'Co-working Space available on rent in Baner, Pune. Zero brokerage - deal directly with the verified owner.', '["parking", "power", "lift", "security", "club"]', '["https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=800&q=70', '/floorplans/coworking.svg', 'owner', 'approved', true, true, true, 3, 241, 11, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30')
    ON CONFLICT DO NOTHING;


INSERT INTO public.properties
    (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, negotiable,
     area, area_unit, carpet_area, furnishing, total_floors, possession, locality, locality_slug, city,
     lat, lng, society_id, society_verified, description, amenities, images, cover_image, floor_plan,
     posted_by_type, status, verified, owner_verified, ownership_verified, docs_count, views, enquiries,
     created_at, updated_at)
SELECT
    'f1c70000-0000-4000-8000-000000005120', 'p5120', '7c92f0c4-3fb9-50f8-ae42-ccb1995660fd', '2 BHK Flat in Skyline Heights, Baner', 'buy', 'Flat', 2, 9800000, 'total', true,
    1080, 'sqft', 890, 'semi-furnished', 14, 'ready-to-move', 'Baner', 'baner', 'Pune',
    s.lat, s.lng, s.id, true, 'Well-kept 2 BHK on a mid floor of Skyline Heights, Baner. Society has a gym, clubhouse and 24x7 security. Zero brokerage - deal directly with the verified owner.', '["parking", "lift", "security", "gym", "club", "garden", "power"]', '["https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=800&q=70', '/floorplans/2bhk.svg',
    'owner', 'approved', true, true, true, 3, 164, 7, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'
  FROM public.societies s
 WHERE s.slug = 'skyline-heights-baner'
    ON CONFLICT DO NOTHING;

UPDATE public.societies SET listing_count = 1
 WHERE slug = 'skyline-heights-baner' AND listing_count = 0;


UPDATE public.flatmate_seeker_posts SET move_in = '30', tags = '["Vegetarian", "Student"]'
 WHERE id = 'f1c7000c-0000-4000-8000-000000000001' AND move_in IS NULL;
UPDATE public.flatmate_seeker_posts SET move_in = '60', tags = '["Night owl", "Fitness"]'
 WHERE id = 'f1c7000c-0000-4000-8000-000000000002' AND move_in IS NULL;
UPDATE public.flatmate_seeker_posts SET move_in = 'now', tags = '["Non-smoker", "Working professional"]'
 WHERE id = 'f1c7000c-0000-4000-8000-000000000003' AND move_in IS NULL;

INSERT INTO public.users
    (id, name, mobile, role, status, city, mobile_verified, verified,
     listings_count, joined_at, created_at, updated_at)
VALUES
 ('f1c70000-0000-4000-8000-000000000021', 'Sneha Joshi', '9700000021', 'buyer', 'active', 'Pune', true, true, 0, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000000022', 'Aditi Rao', '9700000022', 'buyer', 'active', 'Pune', true, true, 0, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000000023', 'Pooja Shah', '9700000023', 'buyer', 'active', 'Pune', true, false, 0, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000000024', 'Karan Malhotra', '9700000024', 'buyer', 'active', 'Pune', true, false, 0, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000000025', 'Nikhil Rane', '9700000025', 'buyer', 'active', 'Pune', true, true, 0, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30')
    ON CONFLICT DO NOTHING;

INSERT INTO public.flatmate_seeker_posts
    (id, user_id, name, gender, age, occupation, budget, localities, move_in, flat_pref, room_pref,
     tags, note, verified_contact_only, verified, mod_status, archived, created_at, updated_at)
VALUES
 ('f1c7000c-0000-4000-8000-000000000004', 'f1c70000-0000-4000-8000-000000000021', 'Sneha Joshi', 'female', 26, 'Data Analyst', 18000, '["Hinjawadi", "Wakad"]', '15', 'women', 'private', '["Non-smoker", "Early riser", "Fitness"]', 'WFO at Hinjawadi. Want to split a 2BHK with a like-minded girl. Gym buddy a bonus.', false, true, 'approved', false, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c7000c-0000-4000-8000-000000000005', 'f1c70000-0000-4000-8000-000000000022', 'Aditi Rao', 'female', 24, 'UX Designer', 16000, '["Kharadi"]', 'now', 'women', 'private', '["Non-smoker", "Working professional"]', 'Starting at a Kharadi studio next week - can move in immediately. Clean and quiet.', false, true, 'approved', false, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c7000c-0000-4000-8000-000000000006', 'f1c70000-0000-4000-8000-000000000023', 'Pooja Shah', 'female', 25, 'Marketing Lead', 17000, '["Wakad"]', '15', 'women', 'any', '["Non-smoker", "Night owl"]', 'Relocating to Pune this month. Need a 2BHK flatmate - easy-going and tidy.', false, false, 'approved', false, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c7000c-0000-4000-8000-000000000007', 'f1c70000-0000-4000-8000-000000000024', 'Karan Malhotra', 'male', 23, 'QA Engineer', 14000, '["Hadapsar"]', '30', 'any', 'shared', '["Vegetarian", "Student"]', 'Fresh grad sharing a 2BHK to keep rent low. Open to a shared room.', false, false, 'approved', false, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c7000c-0000-4000-8000-000000000008', 'f1c70000-0000-4000-8000-000000000025', 'Nikhil Rane', 'male', 29, 'Product Manager', 21000, '["Kothrud"]', '60', 'men', 'private', '["Fitness"]', 'Lease ends in two months, planning ahead. Private room in Kothrud preferred.', false, true, 'approved', false, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30')
    ON CONFLICT DO NOTHING;


INSERT INTO public.flatmate_groups
    (id, host_id, title, locality, policy, rent, seats_total, seats_open, host_role, verification_tier,
     agreement_declared, owner_consent, flag_for_review, mod_status, tags, note, archived, created_at, updated_at)
VALUES
 ('f1c7000d-0000-4000-8000-000000000002', 'f619aa88-84ed-50ce-9a07-abb7712afa9d', '2 girls need 1 more for a 2 BHK, Baner', 'Baner', 'women', 34000, 3, 1, 'tenant', 'identity', false, false, false, 'approved', '["Non-smoker", "Working professional"]', 'Working professionals, non-smokers. Move-in within a month.', false, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c7000d-0000-4000-8000-000000000003', 'f619aa88-84ed-50ce-9a07-abb7712afa9d', 'Two seats open in a 3 BHK, Hinjawadi', 'Hinjawadi', 'any', 45000, 4, 2, 'tenant', 'identity', false, false, false, 'approved', '["Working professional"]', 'Walkable to Phase 1. Two rooms free from next month.', false, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c7000d-0000-4000-8000-000000000004', 'f619aa88-84ed-50ce-9a07-abb7712afa9d', 'One seat in a 2 BHK, Wakad', 'Wakad', 'men', 28000, 3, 1, 'tenant', 'identity', false, false, false, 'approved', '["Non-smoker", "Early riser"]', 'Quiet flat, two of us work early shifts.', false, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c7000d-0000-4000-8000-000000000005', 'f619aa88-84ed-50ce-9a07-abb7712afa9d', 'Sharing a 3 BHK near Magarpatta, Hadapsar', 'Hadapsar', 'any', 39000, 4, 2, 'tenant', 'identity', false, false, false, 'approved', '["Vegetarian"]', 'Veg kitchen. Close to the Magarpatta gate.', false, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c7000d-0000-4000-8000-000000000006', 'f619aa88-84ed-50ce-9a07-abb7712afa9d', 'Last seat in a 2 BHK, Kothrud', 'Kothrud', 'any', 26000, 3, 1, 'tenant', 'identity', false, false, false, 'approved', '["Fitness", "Night owl"]', 'Long-term flat, one room opening up.', false, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c7000d-0000-4000-8000-000000000007', 'f619aa88-84ed-50ce-9a07-abb7712afa9d', 'One seat in a 2 BHK, Aundh', 'Aundh', 'any', 31000, 3, 1, 'tenant', 'identity', false, false, false, 'approved', '["Working professional"]', 'Near ITI Road. One room free from the 1st.', false, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c7000d-0000-4000-8000-000000000008', 'f619aa88-84ed-50ce-9a07-abb7712afa9d', 'Two seats in a 3 BHK, Balewadi', 'Balewadi', 'women', 36000, 4, 2, 'tenant', 'identity', false, false, false, 'approved', '["Non-smoker", "Fitness"]', 'Close to the sports complex. Two rooms open.', false, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30')
    ON CONFLICT DO NOTHING;

-- Residential rent/plot anchors. Every locality here is load-bearing against
-- `frontend/src/data/localityIntel.js` — see `rentStock` in docs/system/fixture-registry.md.
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, city, lat, lng, description, amenities, images, cover_image, floor_plan, posted_by_type, status, verified, owner_verified, ownership_verified, docs_count, views, enquiries, created_at, updated_at) VALUES
 ('f1c70000-0000-4000-8000-000000005121', 'p5121', 'f1c70000-0000-4000-8000-000000000010', '2 BHK Flat for rent in Wakad', 'rent', 'Flat', 2, 24000, 'per-month', 72000, 1800, true, 950, 'sqft', 780, 'semi-furnished', 4, 11, 'East', 'ready-to-move', 'Wakad', 'wakad', 'Pune', 18.598, 73.762, '2 BHK Flat available on rent in Wakad, Pune. Zero brokerage - deal directly with the verified owner.', '["parking", "lift", "security", "power", "gym"]', '["https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=800&q=70', '/floorplans/2bhk.svg', 'owner', 'approved', true, true, true, 3, 208, 7, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005122', 'p5122', 'f1c70000-0000-4000-8000-000000000010', '1 BHK Flat for rent in Hinjawadi', 'rent', 'Flat', 1, 15000, 'per-month', 45000, 1000, true, 560, 'sqft', 450, 'unfurnished', 2, 7, 'North', 'ready-to-move', 'Hinjawadi', 'hinjawadi', 'Pune', 18.591, 73.738, '1 BHK Flat available on rent in Hinjawadi, Pune. Zero brokerage - deal directly with the verified owner.', '["parking", "lift", "security"]', '["https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1493809842364-78817add7ffb?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70', '/floorplans/1bhk.svg', 'owner', 'approved', true, true, true, 2, 141, 4, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005123', 'p5123', 'f1c70000-0000-4000-8000-000000000010', '3 BHK Flat for rent in Balewadi', 'rent', 'Flat', 3, 42000, 'per-month', 126000, 2600, false, 1450, 'sqft', 1180, 'furnished', 8, 14, 'West', 'ready-to-move', 'Balewadi', 'balewadi', 'Pune', 18.575, 73.769, '3 BHK Flat available on rent in Balewadi, Pune. Zero brokerage - deal directly with the verified owner.', '["parking", "lift", "security", "power", "gym", "pool", "club"]', '["https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1484154218962-a197022b5858?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70', '/floorplans/3bhk.svg', 'owner', 'approved', true, true, true, 4, 176, 6, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30')
    ON CONFLICT DO NOTHING;

-- The land sale. `bhk` stays NULL and Wagholi is benchmarked on purpose — `rentStock` in
-- docs/system/fixture-registry.md explains what each fact proves.
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, price, price_unit, negotiable, area, area_unit, possession, land_use, locality, locality_slug, city, lat, lng, description, amenities, images, cover_image, posted_by_type, status, verified, owner_verified, ownership_verified, docs_count, views, enquiries, created_at, updated_at) VALUES
 ('f1c70000-0000-4000-8000-000000005124', 'p5124', 'f1c70000-0000-4000-8000-000000000010', 'Open Plot for sale in Wagholi', 'buy', 'Plot', 8500000, 'total', true, 2400, 'sqft', 'ready-to-move', 'residential', 'Wagholi', 'wagholi', 'Pune', 18.58, 74.001, 'Open Plot available on sale in Wagholi, Pune. Clear title, zero brokerage - deal directly with the verified owner.', '["power", "security"]', '["https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=800&q=70', 'owner', 'approved', true, true, true, 3, 94, 2, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30')
    ON CONFLICT DO NOTHING;

-- Sub-type-specific fit-out, copied verbatim from COMMERCIAL_FIXTURES so product drift fails an
-- assertion. Profiles and why a generic list proved nothing: `commercialFitout` in the registry.

UPDATE public.properties SET amenities =
  '["parking", "power", "security", "Server / UPS Room", "Meeting Cabins", "Reception Area", "Conference Room", "False Ceiling", "Central AC"]'
WHERE slug IN ('p5101', 'p5106', 'p5107', 'p5112');

UPDATE public.properties SET amenities =
  '["parking", "power", "security", "Main-Road Frontage", "Display Windows", "Rolling Shutter", "Signage Space", "Mezzanine Floor", "Customer Washroom"]'
WHERE slug IN ('p5102', 'p5103', 'p5108', 'p5109');

UPDATE public.properties SET amenities =
  '["parking", "power", "security", "Loading Bay / Dock", "High Ceiling", "3-Phase Power", "Wide Truck Access", "Crane / Gantry Support", "Covered Yard"]'
WHERE slug IN ('p5104', 'p5105', 'p5110', 'p5111');

-- Asymmetric on rating, categories and `recommend` so the summary block is falsifiable — see
-- `propertyReview` in docs/system/fixture-registry.md. `target_id` resolves from the slug.

INSERT INTO public.reviews (id, target_type, target_id, author_id, rating, title, body, status, created_at, updated_at, context, categories, recommend)
SELECT 'f1c70003-0000-4000-8000-000000005013'::uuid, 'property', p.id::text,
       'f1c70000-0000-4000-8000-000000000001'::uuid, 5, NULL, 'Great locality.', 'published',
       '2026-01-05 10:00:00+05:30', '2026-01-05 10:00:00+05:30', 'visit',
       '{"locality": 5, "condition": 4}'::jsonb, true
FROM public.properties p WHERE p.slug = 'p5013'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.reviews (id, target_type, target_id, author_id, rating, title, body, status, created_at, updated_at, context, categories, recommend)
SELECT 'f1c70003-0000-4000-8000-000000005014'::uuid, 'property', p.id::text,
       'f1c70000-0000-4000-8000-000000000002'::uuid, 4, NULL, 'Fair value.', 'published',
       '2026-01-04 10:00:00+05:30', '2026-01-04 10:00:00+05:30', 'tenant',
       '{"locality": 4}'::jsonb, true
FROM public.properties p WHERE p.slug = 'p5013'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.reviews (id, target_type, target_id, author_id, rating, title, body, status, created_at, updated_at, context, categories, recommend)
SELECT 'f1c70003-0000-4000-8000-000000005015'::uuid, 'property', p.id::text,
       'f1c70000-0000-4000-8000-000000000003'::uuid, 3, NULL, 'Average.', 'published',
       '2026-01-03 10:00:00+05:30', '2026-01-03 10:00:00+05:30', NULL,
       '{}'::jsonb, NULL
FROM public.properties p WHERE p.slug = 'p5013'
ON CONFLICT (id) DO NOTHING;

-- Society reviews. Two societies at 5+4 (average 4.5), a third left unreviewed on purpose, and
-- `target_id` joined on slug because `societies.id` regenerates — `societyReview` in the registry.

INSERT INTO public.reviews (id, target_type, target_id, author_id, rating, title, body, status, created_at, updated_at, context, categories, recommend)
SELECT 'f1c70004-0000-4000-8000-000000000001'::uuid, 'society', s.id::text,
       'f1c70000-0000-4000-8000-000000000001'::uuid, 5, NULL, 'Well run, water never fails.', 'published',
       '2026-01-05 10:00:00+05:30', '2026-01-05 10:00:00+05:30', 'tenant',
       '{"Safety": 5, "Maintenance": 4}'::jsonb, true
FROM public.societies s WHERE s.slug = 'palm-court-panchshil-undri'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.reviews (id, target_type, target_id, author_id, rating, title, body, status, created_at, updated_at, context, categories, recommend)
SELECT 'f1c70004-0000-4000-8000-000000000002'::uuid, 'society', s.id::text,
       'f1c70000-0000-4000-8000-000000000002'::uuid, 4, NULL, 'Good security, parking is tight.', 'published',
       '2026-01-04 10:00:00+05:30', '2026-01-04 10:00:00+05:30', NULL,
       '{}'::jsonb, NULL
FROM public.societies s WHERE s.slug = 'palm-court-panchshil-undri'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.reviews (id, target_type, target_id, author_id, rating, title, body, status, created_at, updated_at, context, categories, recommend)
SELECT 'f1c70004-0000-4000-8000-000000000003'::uuid, 'society', s.id::text,
       'f1c70000-0000-4000-8000-000000000001'::uuid, 5, NULL, 'Clean and quiet.', 'published',
       '2026-01-05 10:00:00+05:30', '2026-01-05 10:00:00+05:30', 'tenant',
       '{"Maintenance": 5}'::jsonb, true
FROM public.societies s WHERE s.slug = 'golden-springs-panchshil-baner'
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.reviews (id, target_type, target_id, author_id, rating, title, body, status, created_at, updated_at, context, categories, recommend)
SELECT 'f1c70004-0000-4000-8000-000000000004'::uuid, 'society', s.id::text,
       'f1c70000-0000-4000-8000-000000000002'::uuid, 4, NULL, 'Lifts are slow at peak hours.', 'published',
       '2026-01-04 10:00:00+05:30', '2026-01-04 10:00:00+05:30', NULL,
       '{}'::jsonb, NULL
FROM public.societies s WHERE s.slug = 'golden-springs-panchshil-baner'
ON CONFLICT (id) DO NOTHING;

-- Stock for the three Buy types the taxonomy offered and Postgres never held, plus the zero-photo
-- and land-use fixtures — see `postedTypes` and `landUse` in docs/system/fixture-registry.md.
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, negotiable, area, area_unit, carpet_area, furnishing, possession, land_use, locality, locality_slug, city, lat, lng, description, amenities, images, cover_image, posted_by_type, status, featured, verified, owner_verified, ownership_verified, docs_count, views, enquiries, created_at, updated_at) VALUES
 ('f1c70000-0000-4000-8000-000000005130', 'p5130', 'f1c70000-0000-4000-8000-000000000010', '3 BHK Independent House for sale in Baner', 'buy', 'Independent House', 3, 12500000, 'total', true, 1850, 'sqft', 1520, 'semi-furnished', 'ready-to-move', NULL, 'Baner', 'baner', 'Pune', 18.5602, 73.7861, '3 BHK Independent House available on sale in Baner, Pune. Zero brokerage - deal directly with the verified owner.', '["parking", "security", "power", "garden"]', '["https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1570129477492-45c003edd2be?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=70', 'owner', 'approved', true, true, true, true, 3, 132, 5, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005131', 'p5131', 'f1c70000-0000-4000-8000-000000000010', 'Open Plot for sale in Baner', 'buy', 'Open Plot', NULL, 9800000, 'total', true, 2600, 'sqft', NULL, NULL, 'ready-to-move', 'commercial', 'Baner', 'baner', 'Pune', 18.5595, 73.7802, 'Commercially zoned open plot on sale in Baner, Pune. Clear title, zero brokerage - deal directly with the verified owner.', '["power", "security"]', '["https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=800&q=70', 'owner', 'approved', true, true, true, true, 3, 88, 3, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005132', 'p5132', 'f1c70000-0000-4000-8000-000000000010', 'Farm Land for sale in Baner', 'buy', 'Farm Land', NULL, 6400000, 'total', true, 21780, 'sqft', NULL, NULL, 'ready-to-move', 'agricultural', 'Baner', 'baner', 'Pune', 18.5641, 73.7745, 'Farm Land available on sale near Baner, Pune. Clear title, zero brokerage - deal directly with the verified owner.', '["power"]', '["https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=800&q=70', 'owner', 'approved', true, true, true, true, 2, 61, 1, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005133', 'p5133', 'f1c70000-0000-4000-8000-000000000010', '2 BHK Flat for sale in Baner', 'buy', 'Flat', 2, 7200000, 'total', true, 910, 'sqft', 760, 'unfurnished', 'ready-to-move', NULL, 'Baner', 'baner', 'Pune', 18.5588, 73.7890, '2 BHK Flat available on sale in Baner, Pune. Photos coming soon. Zero brokerage - deal directly with the verified owner.', '["parking", "lift", "security"]', '[]', NULL, 'owner', 'approved', true, true, true, true, 2, 44, 1, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30')
    ON CONFLICT DO NOTHING;

-- Card-level attributes stated as UPDATEs so no count assertion moves.
-- See `listingAttributes` in docs/system/fixture-registry.md.

-- Buy: age / floor / facing / overlooking plus the two society trust flags. Only p5133 states an
-- overlooking, so the tile is exercised in both stated and unstated forms.
UPDATE public.properties SET age_years = 9,  floor = 11, total_floors = 14, facing = 'East',       society_verified = true,  conveyance_done = true  WHERE slug = 'p5120';
UPDATE public.properties SET age_years = 1,  floor = 3,  total_floors = 12, facing = 'North',      overlooking = 'Garden',    society_verified = true,  conveyance_done = false WHERE slug = 'p5133';
UPDATE public.properties SET age_years = 3,  floor = 5,  total_floors = 8,  facing = 'North',      society_verified = true,  conveyance_done = true  WHERE slug = 'p5023';
UPDATE public.properties SET age_years = 6,  floor = 9,  total_floors = 9,  facing = 'West',       society_verified = false, conveyance_done = true  WHERE slug = 'p5008';
UPDATE public.properties SET age_years = 18, floor = 2,  total_floors = 5,  facing = 'South',      society_verified = false, conveyance_done = false WHERE slug = 'p5013';
-- Independent house: an age, but no society and no floor in a building it does not sit in.
UPDATE public.properties SET age_years = 2 WHERE slug = 'p5130';
-- p5010 (villa) is left entirely unstated on purpose. Do not fill it in.

-- Rent: letting policy, availability and the flat-share distinction. p5033 and p5122 invert the
-- old coin flip so neither chip can pass by accident.
UPDATE public.properties SET age_years = 5,  tenants = '["family"]'::jsonb, available_from = 'now', pets = false WHERE slug = 'p5121';
UPDATE public.properties SET age_years = 12, tenants = '["bachelor-male"]'::jsonb, available_from = '15', pets = true, room = 'single' WHERE slug = 'p5122';
UPDATE public.properties SET age_years = 7,  tenants = '["family", "company"]'::jsonb, available_from = '30', pets = false WHERE slug = 'p5123';
UPDATE public.properties SET age_years = 4,  floor = 1,  total_floors = 6,  facing = 'South', room = 'shared', tenants = '["bachelor-female"]'::jsonb, available_from = 'now', pets = false WHERE slug = 'p5007';
UPDATE public.properties SET age_years = 15, floor = 12, total_floors = 12, facing = 'East',  room = 'shared', tenants = '["bachelor-male", "bachelor-female"]'::jsonb, available_from = '15', pets = true WHERE slug = 'p5033';
UPDATE public.properties SET age_years = 8,  floor = 6,  total_floors = 10, room = 'single', tenants = '["company"]'::jsonb, available_from = '30', pets = false WHERE slug = 'p5014';
-- p5000 (villa, rent) states no tenant policy, no availability and no share type. Do not fill it in.


-- Ten Wagholi flats, the oldest in the catalogue and carrying no trust badge, so a regression from
-- server-side search to browser slicing goes red — `serverSideSearch` in the fixture registry.
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, negotiable, area, area_unit, carpet_area, furnishing, possession, land_use, locality, locality_slug, city, lat, lng, description, amenities, images, cover_image, posted_by_type, status, featured, verified, owner_verified, ownership_verified, docs_count, views, enquiries, created_at, updated_at) VALUES
 ('f1c70000-0000-4000-8000-000000005140', 'p5140', 'b05422ba-0a55-5136-ba68-d202e83e29b0', '1 BHK Flat for sale in Wagholi', 'buy', 'Flat', 1, 5400000, 'total', true,  620, 'sqft', 520, 'unfurnished',    'ready-to-move', NULL, 'Wagholi', 'wagholi', 'Pune', 18.5746, 73.9771, '1 BHK Flat available on sale in Wagholi, Pune. Zero brokerage - deal directly with the owner.', '["lift", "security"]', '[]', NULL, 'owner', 'approved', false, true, false, false, 1, 12, 0, '2026-01-05 10:00:00+05:30', '2026-01-05 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005141', 'p5141', 'b05422ba-0a55-5136-ba68-d202e83e29b0', '2 BHK Flat for sale in Wagholi', 'buy', 'Flat', 2, 7300000, 'total', false, 880, 'sqft', 730, 'unfurnished',    'ready-to-move', NULL, 'Wagholi', 'wagholi', 'Pune', 18.5752, 73.9784, '2 BHK Flat available on sale in Wagholi, Pune. Zero brokerage - deal directly with the owner.', '["lift", "parking", "security"]', '[]', NULL, 'owner', 'approved', false, true, false, false, 1, 31, 1, '2026-01-06 10:00:00+05:30', '2026-01-06 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005142', 'p5142', 'b05422ba-0a55-5136-ba68-d202e83e29b0', '2 BHK Flat for sale in Wagholi', 'buy', 'Flat', 2, 7850000, 'total', true,  940, 'sqft', 780, 'semi-furnished', 'ready-to-move', NULL, 'Wagholi', 'wagholi', 'Pune', 18.5738, 73.9796, '2 BHK Flat available on sale in Wagholi, Pune. Zero brokerage - deal directly with the owner.', '["lift", "parking", "power"]', '[]', NULL, 'owner', 'approved', false, true, false, false, 2, 18, 0, '2026-01-07 10:00:00+05:30', '2026-01-07 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005143', 'p5143', 'b05422ba-0a55-5136-ba68-d202e83e29b0', '3 BHK Flat for sale in Wagholi', 'buy', 'Flat', 3, 11200000, 'total', false, 1310, 'sqft', 1090, 'unfurnished',   'ready-to-move', NULL, 'Wagholi', 'wagholi', 'Pune', 18.5761, 73.9763, '3 BHK Flat available on sale in Wagholi, Pune. Zero brokerage - deal directly with the owner.', '["lift", "parking", "security", "garden"]', '[]', NULL, 'owner', 'approved', false, true, false, false, 2, 27, 2, '2026-01-08 10:00:00+05:30', '2026-01-08 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005144', 'p5144', 'b05422ba-0a55-5136-ba68-d202e83e29b0', '1 BHK Flat for sale in Wagholi', 'buy', 'Flat', 1, 5750000, 'total', true,  655, 'sqft', 545, 'semi-furnished', 'ready-to-move', NULL, 'Wagholi', 'wagholi', 'Pune', 18.5729, 73.9758, '1 BHK Flat available on sale in Wagholi, Pune. Zero brokerage - deal directly with the owner.', '["lift", "security"]', '[]', NULL, 'owner', 'approved', false, true, false, false, 1, 9, 0, '2026-01-09 10:00:00+05:30', '2026-01-09 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005145', 'p5145', 'b05422ba-0a55-5136-ba68-d202e83e29b0', '2 BHK Flat for sale in Wagholi', 'buy', 'Flat', 2, 6980000, 'total', false, 845, 'sqft', 705, 'unfurnished',    'ready-to-move', NULL, 'Wagholi', 'wagholi', 'Pune', 18.5773, 73.9789, '2 BHK Flat available on sale in Wagholi, Pune. Zero brokerage - deal directly with the owner.', '["parking", "security"]', '[]', NULL, 'owner', 'approved', false, true, false, false, 1, 22, 0, '2026-01-10 10:00:00+05:30', '2026-01-10 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005146', 'p5146', 'b05422ba-0a55-5136-ba68-d202e83e29b0', '3 BHK Flat for sale in Wagholi', 'buy', 'Flat', 3, 10450000, 'total', true,  1240, 'sqft', 1030, 'semi-furnished', 'ready-to-move', NULL, 'Wagholi', 'wagholi', 'Pune', 18.5717, 73.9802, '3 BHK Flat available on sale in Wagholi, Pune. Zero brokerage - deal directly with the owner.', '["lift", "parking", "power", "play"]', '[]', NULL, 'owner', 'approved', false, true, false, false, 3, 40, 1, '2026-01-11 10:00:00+05:30', '2026-01-11 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005147', 'p5147', 'b05422ba-0a55-5136-ba68-d202e83e29b0', '2 BHK Flat for sale in Wagholi', 'buy', 'Flat', 2, 8100000, 'total', false, 965, 'sqft', 800, 'unfurnished',    'ready-to-move', NULL, 'Wagholi', 'wagholi', 'Pune', 18.5785, 73.9775, '2 BHK Flat available on sale in Wagholi, Pune. Zero brokerage - deal directly with the owner.', '["lift", "parking"]', '[]', NULL, 'owner', 'approved', false, true, false, false, 1, 15, 0, '2026-01-12 10:00:00+05:30', '2026-01-12 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005148', 'p5148', 'b05422ba-0a55-5136-ba68-d202e83e29b0', '1 BHK Flat for sale in Wagholi', 'buy', 'Flat', 1, 5150000, 'total', true,  590, 'sqft', 495, 'unfurnished',    'ready-to-move', NULL, 'Wagholi', 'wagholi', 'Pune', 18.5704, 73.9781, '1 BHK Flat available on sale in Wagholi, Pune. Zero brokerage - deal directly with the owner.', '["security"]', '[]', NULL, 'owner', 'approved', false, true, false, false, 1, 7, 0, '2026-01-13 10:00:00+05:30', '2026-01-13 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005149', 'p5149', 'b05422ba-0a55-5136-ba68-d202e83e29b0', '3 BHK Flat for sale in Wagholi', 'buy', 'Flat', 3, 11900000, 'total', false, 1385, 'sqft', 1155, 'furnished',      'ready-to-move', NULL, 'Wagholi', 'wagholi', 'Pune', 18.5759, 73.9810, '3 BHK Flat available on sale in Wagholi, Pune. Zero brokerage - deal directly with the owner.', '["lift", "parking", "security", "club"]', '[]', NULL, 'owner', 'approved', false, true, false, false, 2, 35, 1, '2026-01-14 10:00:00+05:30', '2026-01-14 10:00:00+05:30')
    ON CONFLICT DO NOTHING;

-- The map-drawer fixture: `price` makes its marker label unique, `lat`/`lng` put it inside Baner and
-- it is the oldest row so no first-card assertion moves — `mapDrawer` in the fixture registry.
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, negotiable, area, area_unit, carpet_area, bathrooms, furnishing, possession, land_use, locality, locality_slug, city, lat, lng, description, amenities, images, cover_image, posted_by_type, status, featured, verified, owner_verified, ownership_verified, docs_count, views, enquiries, created_at, updated_at) VALUES
 ('f1c70000-0000-4000-8000-000000005150', 'p5150', 'b05422ba-0a55-5136-ba68-d202e83e29b0', '3 BHK Villa for sale in Baner', 'buy', 'Villa', 3, 27300000, 'total', true, 1885, 'sqft', 1560, 3, 'semi-furnished', 'ready-to-move', NULL, 'Baner', 'baner', 'Pune', 18.5590, 73.7868, '3 BHK Villa available on sale in Baner, Pune. Zero brokerage - deal directly with the owner.', '["lift", "parking", "security", "garden"]', '["https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70', 'owner', 'approved', false, true, false, false, 1, 5, 0, '2026-01-04 10:00:00+05:30', '2026-01-04 10:00:00+05:30')
    ON CONFLICT DO NOTHING;

-- The boost fixture: p5145 is surrounded by nine siblings the ranker cannot tell it from, and the
-- window is relative so it never expires — `boost` in docs/system/fixture-registry.md.
UPDATE public.properties SET boosted_until = now() + interval '7 days' WHERE slug = 'p5145';

-- Society residency the hub spec can only read, never create. Two societies, so the ops branch of
-- the queue rule has a fixture at all — `societyMembership` in docs/system/fixture-registry.md.

-- Blue Ridge Towers — an approved claim, so Meera Joshi is this society's committee.
INSERT INTO public.society_claims (society_id, claimed_by, name, role, email, note, status, decided_at, decided_by, created_at, updated_at)
SELECT s.id, '190ca53e-0f1b-52e0-b825-7cd1f9accd91', 'Meera Joshi', 'Hon. Secretary', 'secretary.blueridge@example.com',
       'Registered society, MahaRERA listed.', 'approved', '2026-02-02 11:00:00+05:30', 'b72c0b47-5dc2-507d-9e45-e664755ba45a',
       '2026-02-01 10:00:00+05:30', '2026-02-02 11:00:00+05:30'
  FROM public.societies s WHERE s.slug = 'blue-ridge-towers-hinjawadi'
    ON CONFLICT DO NOTHING;

-- Kumar Palaash — still with ops, which is what keeps an unresolved claim in the queue a staff
-- spec can open. Its residents therefore queue to ops too.
INSERT INTO public.society_claims (society_id, claimed_by, name, role, email, note, status, created_at, updated_at)
SELECT s.id, '758f8534-ee2d-5075-ab65-8e89bb294047', 'Meera Chavan', 'Treasurer', NULL,
       'Committee formed last month, papers attached.', 'pending',
       '2026-02-14 09:30:00+05:30', '2026-02-14 09:30:00+05:30'
  FROM public.societies s WHERE s.slug = 'kumar-palaash-hinjawadi'
    ON CONFLICT DO NOTHING;

-- `claim_status` is a second copy of a fact the claim row holds, and the directory card reads the
-- copy — so the seed keeps it in step exactly as the service does on every decision.
UPDATE public.societies SET claim_status = 'claimed' WHERE slug = 'blue-ridge-towers-hinjawadi';
UPDATE public.societies SET claim_status = 'pending' WHERE slug = 'kumar-palaash-hinjawadi';

-- Verified, in a claimed society: the state the hub's resident-only gate must open for. Its
-- neighbour is pending, so the committee console has something in its inbox on first open.
INSERT INTO public.society_residents (society_id, user_id, wing, flat, unit_key, relation, status, assigned_to, flagged, note, decided_at, decided_by, created_at, updated_at)
SELECT s.id, v.user_id, v.wing, v.flat, v.unit_key, v.relation, v.status, v.assigned_to, NULL, v.note, v.decided_at, v.decided_by, v.created_at, v.updated_at
  FROM public.societies s
  CROSS JOIN (VALUES
    ('8d8c7e15-efe0-45e0-81b4-371920583c2d'::uuid, 'B', '704',  'B704',  'owner',  'verified', 'committee', NULL::text,
     '2026-02-05 12:00:00+05:30'::timestamptz, '190ca53e-0f1b-52e0-b825-7cd1f9accd91'::uuid,
     '2026-02-03 18:00:00+05:30'::timestamptz, '2026-02-05 12:00:00+05:30'::timestamptz),
    ('6f77d348-d008-5e70-aeaa-cc465a73e28a'::uuid, 'A', '1203', 'A1203', 'tenant', 'pending',  'committee',
     'Moved in this month, rent agreement attached.',
     NULL::timestamptz, NULL::uuid,
     '2026-02-16 20:15:00+05:30'::timestamptz, '2026-02-16 20:15:00+05:30'::timestamptz)
  ) AS v(user_id, wing, flat, unit_key, relation, status, assigned_to, note, decided_at, decided_by, created_at, updated_at)
 WHERE s.slug = 'blue-ridge-towers-hinjawadi'
    ON CONFLICT DO NOTHING;

-- Pending with OPS, because Kumar Palaash has no approved claim yet. This is the row that makes
-- "assigned_to is always committee" falsifiable.
INSERT INTO public.society_residents (society_id, user_id, wing, flat, unit_key, relation, status, assigned_to, created_at, updated_at)
SELECT s.id, '3ad0171b-3206-53e2-b6dc-732bf4e1b44c', 'C', '502', 'C502', 'resident', 'pending', 'ops',
       '2026-02-15 08:45:00+05:30', '2026-02-15 08:45:00+05:30'
  FROM public.societies s WHERE s.slug = 'kumar-palaash-hinjawadi'
    ON CONFLICT DO NOTHING;

-- Q&A and noticeboard for the hub: seeded because a board that only shows you your own writes
-- proves nothing — `societyCommunity` in docs/system/fixture-registry.md.

insert into public.society_questions (id, society_id, author_id, body, created_at, updated_at)
select
    'f1c7a201-0000-4000-8000-000000000001'::uuid,
    s.id,
    '758f8534-ee2d-5075-ab65-8e89bb294047'::uuid,  -- Meera Chavan, buyer, lives elsewhere
    'How reliable is the water supply in summer? Any tanker dependency?',
    now() - interval '6 days',
    now() - interval '6 days'
from public.societies s
where s.slug = 'blue-ridge-towers-hinjawadi'
on conflict do nothing;

insert into public.society_answers (id, question_id, author_id, body, created_at, updated_at)
values (
    'f1c7a202-0000-4000-8000-000000000001'::uuid,
    'f1c7a201-0000-4000-8000-000000000001'::uuid,
    '8d8c7e15-efe0-45e0-81b4-371920583c2d'::uuid,  -- Meera Kapoor, verified resident of B/704
    'Borewell plus corporation line. We booked two tankers in five years, both in May.',
    now() - interval '5 days',
    now() - interval '5 days'
)
on conflict do nothing;

insert into public.society_board_items
    (id, society_id, author_id, kind, title, body, category, event_date, event_time,
     created_at, updated_at)
select v.id, s.id, v.author_id, v.kind, v.title, v.body, v.category, v.event_date, v.event_time,
       v.created_at, v.created_at
from public.societies s
cross join (values
    -- Posted by the committee: an AGM is exactly the kind of assertion about the building that
    -- the resident gate exists to protect.
    ('f1c7a203-0000-4000-8000-000000000001'::uuid,
     '190ca53e-0f1b-52e0-b825-7cd1f9accd91'::uuid,
     'event', 'Annual general meeting',
     'Clubhouse, ground floor. Agenda circulated on the group.',
     'meeting', date '2027-02-14', time '18:30',
     now() - interval '3 days'),
    -- Posted by the verified resident, and undated, so the board has one of each and the
    -- ordering rule is observable.
    ('f1c7a204-0000-4000-8000-000000000001'::uuid,
     '8d8c7e15-efe0-45e0-81b4-371920583c2d'::uuid,
     'notice', 'Visitor parking is now on the B-wing side',
     'The old bays are being resurfaced. Expect it to last a month.',
     'parking', null, null,
     now() - interval '2 days')
) as v(id, author_id, kind, title, body, category, event_date, event_time, created_at)
where s.slug = 'blue-ridge-towers-hinjawadi'
on conflict do nothing;

-- All three contribution kinds, with the vote cast by somebody other than the author so
-- `helpfulByMe` is falsifiable — `societyContributions` in docs/system/fixture-registry.md.

insert into public.society_contributions
    (id, society_id, author_id, kind, category, body, referral_name, referral_contact,
     photo_url, created_at, updated_at)
select v.id, s.id, v.author_id, v.kind, v.category, v.body, v.referral_name, v.referral_contact,
       v.photo_url, v.created_at, v.created_at
from public.societies s
cross join (values
    -- A tip from the verified resident of B/704. Prose only: a tip has no person attached, and
    -- the two-sided check constraint refuses a referral name or number on this row.
    ('f1c7a301-0000-4000-8000-000000000001'::uuid,
     '8d8c7e15-efe0-45e0-81b4-371920583c2d'::uuid,
     'tip', 'parking',
     'Visitor parking fills up by 8pm on weekends. The far end of the B wing is usually free.',
     null::text, null::text, null::text,
     now() - interval '9 days'),
    -- A trusted pick, with a number. This is the single most useful thing on the page and was
    ('f1c7a302-0000-4000-8000-000000000001'::uuid,
     '190ca53e-0f1b-52e0-b825-7cd1f9accd91'::uuid,
     'pick', 'services',
     'Turns up the same day and charges what he quotes. Used him three times.',
     'Vishal Kadam (electrician)', '9822014477', null::text,
     now() - interval '7 days'),
    -- A photo, as a URL. The caption is the same `body` column the tip uses: a caption and a
    -- tip are the author's prose wearing two different names.
    ('f1c7a303-0000-4000-8000-000000000001'::uuid,
     '758f8534-ee2d-5075-ab65-8e89bb294047'::uuid,
     'photo', 'common areas',
     'The clubhouse lawn on a weekday morning.',
     null::text, null::text, 'https://cdn.draazy.example/society/blue-ridge-lawn.jpg',
     now() - interval '4 days')
) as v(id, author_id, kind, category, body, referral_name, referral_contact, photo_url, created_at)
where s.slug = 'blue-ridge-towers-hinjawadi'
on conflict do nothing;

-- One vote, by somebody other than the author, so the electrician outranks the newer photo.
insert into public.society_contribution_helpful (contribution_id, user_id, created_at)
values (
    'f1c7a302-0000-4000-8000-000000000001'::uuid,
    '8d8c7e15-efe0-45e0-81b4-371920583c2d'::uuid,  -- Meera Kapoor, verified resident of B/704
    now() - interval '6 days'
)
on conflict do nothing;

-- One reply, so the thread renders as a thread rather than as a lone card with a reply count
-- of zero on every fresh database.
insert into public.society_contribution_replies
    (id, contribution_id, author_id, body, created_at, updated_at)
values (
    'f1c7a304-0000-4000-8000-000000000001'::uuid,
    'f1c7a302-0000-4000-8000-000000000001'::uuid,
    '758f8534-ee2d-5075-ab65-8e89bb294047'::uuid,  -- Meera Chavan, a buyer, not a resident
    'Does he do fan installation as well?',
    now() - interval '5 days',
    now() - interval '5 days'
)
on conflict do nothing;

-- Both halves of the proposal lifecycle across three kinds; the pending row sits on a different
-- society so `uq_society_proposal_pending` holds — `societyProposals` in the fixture registry.

insert into public.society_proposals
    (id, society_id, author_id, kind, status, builder, build_year, towers, units,
     maintenance_per_sqft, amenities, invite_url, lat, lng, place_id, label,
     decided_by, decided_at, created_at, updated_at)
select v.id, s.id, v.author_id, v.kind, v.status, v.builder, v.build_year, v.towers, v.units,
       v.maintenance_per_sqft, v.amenities, v.invite_url, v.lat, v.lng, v.place_id, v.label,
       v.decided_by, v.decided_at, v.created_at, v.created_at
from public.societies s
cross join (values
    -- An approved resident group; the invite is real-shaped so it survives the anchored regex
    -- the service validates against.
    ('a9c05001-0000-4000-8000-000000000001'::uuid,
     '8d8c7e15-efe0-45e0-81b4-371920583c2d'::uuid,  -- Meera Kapoor, verified resident of B/704
     'whatsapp', 'approved',
     null::text, null::int, null::int, null::int, null::numeric, null::jsonb,
     'https://chat.whatsapp.com/BlueRidge2026Aa',
     null::double precision, null::double precision, null::text, null::text,
     'e6621d3a-3e31-5022-a6c9-34a90c8f6e9b'::uuid,  -- Admin
     now() - interval '11 days',
     now() - interval '12 days'),
    -- An approved pin correction; the statement below applies it to the society, because an
    -- approved fix that never reached the catalogue looks exactly like one that did.
    ('a9c05002-0000-4000-8000-000000000001'::uuid,
     '190ca53e-0f1b-52e0-b825-7cd1f9accd91'::uuid,  -- Meera Joshi, owner
     'location', 'approved',
     null::text, null::int, null::int, null::int, null::numeric, null::jsonb, null::text,
     18.5912, 73.7389,
     'ChIJseedBlueRidgeHinjawadi01', 'Main gate, off Hinjawadi Phase 1 Road',
     'e6621d3a-3e31-5022-a6c9-34a90c8f6e9b'::uuid,  -- Admin
     now() - interval '8 days',
     now() - interval '9 days')
) as v(id, author_id, kind, status, builder, build_year, towers, units, maintenance_per_sqft,
       amenities, invite_url, lat, lng, place_id, label, decided_by, decided_at, created_at)
where s.slug = 'blue-ridge-towers-hinjawadi'
on conflict do nothing;

-- Approval writes the value onto the society itself, coalesced so a fix missing a field cannot
-- blank what the catalogue already knows.
update public.societies
   set lat = coalesce(18.5912, lat),
       lng = coalesce(73.7389, lng),
       place_id = 'ChIJseedBlueRidgeHinjawadi01',
       loc_source = 'community'
 where slug = 'blue-ridge-towers-hinjawadi';

-- One pending detail suggestion, deliberately partial and on a different society so the partial
-- unique index holds. Its author is a non-resident: detail suggestions are not resident-gated.
insert into public.society_proposals
    (id, society_id, author_id, kind, status, builder, build_year, towers, units,
     maintenance_per_sqft, amenities, created_at, updated_at)
select 'a9c05003-0000-4000-8000-000000000001'::uuid, s.id,
       '758f8534-ee2d-5075-ab65-8e89bb294047'::uuid,  -- Meera Chavan, buyer
       'details', 'pending',
       'Shagun Developers', null::int, 4, null::int, null::numeric, null::jsonb,
       now() - interval '2 days', now() - interval '2 days'
from public.societies s
where s.slug = 'aditya-shagun-kothrud'
on conflict do nothing;

-- The catalogue's first two `source = 'community'` rows — one candidate, one confirmed, because the
-- ops queue is the difference between them. `communitySocieties` in the fixture registry.

-- The candidate. Thin on purpose: a name, an area and a pin is everything the mint form asks for.
insert into public.societies
    (id, slug, name, locality_slug, lat, lng, registration, conveyance, amenities,
     source, claim_status, created_by, created_at, updated_at)
select 'c5a11000-0000-4000-8000-000000000001'::uuid,
       'sunview-heights-wakad', 'Sunview Heights', 'wakad',
       18.5989, 73.7629, false, false, '[]'::jsonb,
       'community', 'unclaimed', u.id,
       now() - interval '3 days', now() - interval '3 days'
from public.users u
where u.mobile = '9708919481'  -- Omkar Kulkarni, owner
on conflict (slug) do nothing;

-- The confirmed one. `registration` and `conveyance` stay false: they describe the building's legal
-- paperwork, not our confidence in the record, and promoting them would misinform every buyer.
insert into public.societies
    (id, slug, name, locality_slug, lat, lng, registration, conveyance, amenities,
     source, claim_status, created_by, verified_at, verified_by, created_at, updated_at)
select 'c5a11000-0000-4000-8000-000000000002'::uuid,
       'greenfield-residency-baner', 'Greenfield Residency', 'baner',
       18.5642, 73.7769, false, false, '[]'::jsonb,
       'community', 'unclaimed', author.id,
       now() - interval '11 days', ops.id,
       now() - interval '20 days', now() - interval '11 days'
from public.users author, public.users ops
where author.mobile = '9464709344'   -- Meera Joshi, owner
  and ops.mobile = '9000000000'      -- Admin
on conflict (slug) do nothing;

-- The duplicate-guard fixture (V115): a dedicated owner with a paid allowance of 2, because every
-- other seeded owner hits the paywall first — `duplicateGuard` in docs/system/fixture-registry.md.

insert into public.users
    (id, name, mobile, role, status, city, mobile_verified, verified,
     listings_count, joined_at, created_at, updated_at)
values ('d0000000-0000-4000-8000-000000000090', 'Kunal Bhosale', '9700000090', 'owner',
        'active', 'Pune', true, true, 1,
        '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30')
on conflict (mobile) do nothing;

-- Owner Plus (limit 2), so exactly one slot stays free and the listing below is the only thing
-- between him and the ceiling. Seeded `active`, since a paid plan bought through the API is not.
insert into public.subscriptions (id, user_id, plan_id, status, started_at, renews_at)
select 'd0000000-0000-4000-8000-000000000091'::uuid, u.id,
       'b1000000-0000-4000-8000-000000000002'::uuid,  -- Owner Plus, listing_limit 2
       'active', now() - interval '30 days', now() + interval '335 days'
from public.users u
where u.mobile = '9700000090'
on conflict (id) do nothing;

-- The listing the guard collides with. The raw meter number is spaced and `electricity_meter_key`
-- is not, on purpose: nothing re-derives the key for a seeded row, and that gap is what V115 fixes.
insert into public.properties
    (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit,
     area, area_unit, furnishing, locality, locality_slug, city, address, pincode,
     electricity_meter_no, electricity_meter_key,
     posted_by_type, status, description)
select 'd0000000-0000-4000-8000-0000000000d1'::uuid,
       'zz-dup-guard-anchor-baner', u.id,
       '2 BHK Flat for Rent in Baner', 'rent', 'Flat', 2, 32000, 'per-month',
       900, 'sqft', 'semi-furnished', 'Baner', 'baner', 'Pune',
       'C-701, Dup Guard Residency, Baner', '411045',
       '1700 4455 6677', '170044556677',
       'owner', 'pending',
       'Fixture listing for the duplicate-guard spec. Pending on purpose: it occupies a listing slot without appearing in public search.'
from public.users u
where u.mobile = '9700000090'
on conflict (id) do nothing;


-- Flatmate fixtures remain server-reachable and preserve map, search, and moderation states.

INSERT INTO public.users
    (id, name, mobile, role, status, city, mobile_verified, verified,
     listings_count, joined_at, created_at, updated_at)
VALUES
 ('f1c70000-0000-4000-8000-000000000031', 'Ritu Ganguly',    '9700000031', 'buyer', 'active', 'Pune', true, true, 0, '2026-08-20 10:00:00+05:30', '2026-08-20 10:00:00+05:30', '2026-08-20 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000000032', 'Omkar Bhosale',   '9700000032', 'buyer', 'active', 'Pune', true, true, 0, '2026-08-20 10:05:00+05:30', '2026-08-20 10:05:00+05:30', '2026-08-20 10:05:00+05:30'),
 ('f1c70000-0000-4000-8000-000000000033', 'Farhan Sheikh',   '9700000033', 'buyer', 'active', 'Pune', true, true, 0, '2026-08-20 10:10:00+05:30', '2026-08-20 10:10:00+05:30', '2026-08-20 10:10:00+05:30'),
 ('f1c70000-0000-4000-8000-000000000034', 'Anjali Kulkarni', '9700000034', 'buyer', 'active', 'Pune', true, true, 0, '2026-08-20 10:15:00+05:30', '2026-08-20 10:15:00+05:30', '2026-08-20 10:15:00+05:30'),
 ('f1c70000-0000-4000-8000-000000000035', 'Vikram Sethi',    '9700000035', 'buyer', 'active', 'Pune', true, true, 0, '2026-08-20 10:20:00+05:30', '2026-08-20 10:20:00+05:30', '2026-08-20 10:20:00+05:30'),
 ('f1c70000-0000-4000-8000-000000000036', 'Divya Menon',     '9700000036', 'buyer', 'active', 'Pune', true, true, 0, '2026-08-20 10:25:00+05:30', '2026-08-20 10:25:00+05:30', '2026-08-20 10:25:00+05:30'),
 ('f1c70000-0000-4000-8000-000000000037', 'Ishaan Kulkarni', '9700000037', 'buyer', 'active', 'Pune', true, true, 0, '2026-08-20 10:30:00+05:30', '2026-08-20 10:30:00+05:30', '2026-08-20 10:30:00+05:30'),
 ('f1c70000-0000-4000-8000-000000000038', 'Tanvi Deshmukh',  '9700000038', 'buyer', 'active', 'Pune', true, true, 0, '2026-08-20 10:35:00+05:30', '2026-08-20 10:35:00+05:30', '2026-08-20 10:35:00+05:30')
    ON CONFLICT DO NOTHING;

-- Preserve manual room edits and compute relative availability at seed time.
UPDATE public.flatmate_rooms
   SET society = 'Nyati Elan', flat_type = '2 BHK', home_type_label = 'Flat',
       deposit = 32000, available_from = current_date + 5, food = 'veg',
       tags = '["Non-smoker", "Working professional"]',
       photos = '["https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70"]',
       seats_total = 1, seats_open = 1, updated_at = now()
 WHERE id = 'f1c7000b-0000-4000-8000-000000000001' AND society IS NULL;

UPDATE public.flatmate_rooms
   SET society = 'Rohan Abhilasha', flat_type = '3 BHK', home_type_label = 'Flat',
       deposit = 19000, available_from = current_date + 21, food = 'nonveg',
       tags = '["Non-veg ok", "Fitness"]',
       photos = '["https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70"]',
       seats_total = 1, seats_open = 1, updated_at = now()
 WHERE id = 'f1c7000b-0000-4000-8000-000000000002' AND society IS NULL;

INSERT INTO public.flatmate_rooms
    (id, host_id, room_type, attached_bath, budget, deposit, seats_total, seats_open,
     host_role, verification_tier, verified, agreement_declared, mod_status,
     society, locality, localities, lat, lng, bhk, flat_type, home_type_label,
     gated_community, furnishing, move_in, available_from, gender, food, tags, note, photos,
     created_at, updated_at)
VALUES
 ('f1c7000b-0000-4000-8000-000000000003', 'f1c70000-0000-4000-8000-000000000031',
  'Private room', 'attached', 14000, 28000, 1, 1,
  'tenant', 'identity', false, false, 'approved',
  'Skyline Heights', 'Baner', '["Baner"]', 18.5590, 73.7770, '2', '2 BHK', 'Flat',
  true, 'semi', 'now', DATE '2026-09-10', 'female', 'veg',
  '["Non-smoker", "Working professional", "Vegetarian"]',
  'One private room with attached bathroom in a 2 BHK. Society has a gym and 24x7 security. Looking for a working woman, veg preferred.',
  '["https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70"]',
  '2026-09-05 09:00:00+05:30', '2026-09-05 09:00:00+05:30'),

 ('f1c7000b-0000-4000-8000-000000000004', 'f1c70000-0000-4000-8000-000000000032',
  'Private room', 'shared', 16000, 32000, 1, 1,
  'tenant', 'tenant', false, true, 'live',
  'Lodha Belmondo', 'Hinjawadi', '["Hinjawadi"]', 18.5913, 73.7389, '3', '3 BHK', 'Flat',
  true, 'furnished', '15', DATE '2026-09-25', 'male', 'any',
  '["Non-veg ok", "Working professional", "Fitness"]',
  'Spare room in a fully furnished 3 BHK near Phase 1. Two working guys already here, relaxed crowd.',
  '["https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=70"]',
  '2026-09-04 11:30:00+05:30', '2026-09-04 11:30:00+05:30'),

 ('f1c7000b-0000-4000-8000-000000000005', 'f1c70000-0000-4000-8000-000000000033',
  'Shared room', 'shared', 9000, 18000, 1, 0,
  'tenant', 'identity', false, false, 'approved',
  'Gera World of Joy', 'Kharadi', '["Kharadi"]', 18.5515, 73.9435, '2', '2 BHK', 'Flat',
  false, 'semi', '30', DATE '2026-10-05', 'any', 'any',
  '["Student", "Non-smoker"]',
  'Twin-sharing room in a 2 BHK near EON IT Park. Budget-friendly and walkable to work.',
  '["https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70"]',
  '2026-09-01 18:45:00+05:30', '2026-09-01 18:45:00+05:30'),

 ('f1c7000b-0000-4000-8000-000000000006', 'f1c70000-0000-4000-8000-000000000034',
  'Private room', 'attached', 15000, 30000, 1, 1,
  'tenant', 'tenant', false, true, 'live',
  'Rohan Iris', 'Wakad', '["Wakad"]', 18.5980, 73.7620, '2', '2 BHK', 'Flat',
  true, 'furnished', 'now', DATE '2026-09-12', 'female', 'veg',
  '["Vegetarian", "Early riser", "Pet-friendly"]',
  'Bright private room with attached bathroom and a balcony. Quiet, family-friendly society. Cat-friendly home.',
  '["https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=70"]',
  '2026-09-03 08:15:00+05:30', '2026-09-03 08:15:00+05:30'),

 ('f1c7000b-0000-4000-8000-000000000007', 'f1c70000-0000-4000-8000-000000000035',
  'Private room', 'shared', 18000, 36000, 1, 1,
  'tenant', 'identity', false, false, 'approved',
  'Kumar Princeville', 'Viman Nagar', '["Viman Nagar"]', 18.5679, 73.9143, '3', '3 BHK', 'Flat',
  false, 'semi', '15', DATE '2026-09-28', 'any', 'nonveg',
  '["Non-veg ok", "Night owl", "Working professional"]',
  'Premium 3 BHK near Phoenix Mall with one room free. Suits IT and aviation schedules.',
  '["https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=70"]',
  '2026-08-31 16:00:00+05:30', '2026-08-31 16:00:00+05:30'),

 ('f1c7000b-0000-4000-8000-000000000008', 'f1c70000-0000-4000-8000-000000000036',
  'Private room', 'attached', 13000, 26000, 1, 1,
  'tenant', 'identity', false, false, 'approved',
  'Green Meadows Bungalow', 'Kothrud', '["Kothrud"]', 18.5074, 73.8077, '3', '3 BHK', 'Independent House',
  true, 'furnished', '30', DATE '2026-10-08', 'female', 'veg',
  '["Vegetarian", "Non-smoker", "Working professional"]',
  'Private room with attached bath on the first floor of an independent house in a gated lane. Terrace access, parking, quiet street.',
  '["https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=800&q=70"]',
  '2026-09-02 12:00:00+05:30', '2026-09-02 12:00:00+05:30'),

 -- Keep Aundh free of rooms so the empty move-in state remains available.
 ('f1c7000b-0000-4000-8000-000000000009', 'f1c70000-0000-4000-8000-000000000031',
  'Shared room', 'shared', 7500, 15000, 1, 1,
  'tenant', 'identity', false, false, 'approved',
  'Sai Sankul', 'Hadapsar', '["Hadapsar"]', 18.5018, 73.9364, '1', '1 BHK', 'Flat',
  false, 'unfurnished', 'now', DATE '2026-09-09', 'any', 'any',
  '["Student", "Early riser"]',
  'Cheapest way into Hadapsar -- a shared room in a 1 BHK, five minutes from the bus depot. Bring your own mattress.',
  '["https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70"]',
  '2026-09-06 07:30:00+05:30', '2026-09-06 07:30:00+05:30'),

 ('f1c7000b-0000-4000-8000-000000000010', 'f1c70000-0000-4000-8000-000000000035',
  'Private room', 'attached', 12000, 24000, 1, 1,
  'tenant', 'identity', false, false, 'pending',
  'Nyati Elysia', 'Hadapsar', '["Hadapsar"]', 18.5089, 73.9260, '4', '4 BHK', 'Flat',
  true, 'semi', '60', DATE '2026-11-01', 'male', 'nonveg',
  '["Non-veg ok", "Fitness", "Night owl"]',
  'Room in a 4 BHK behind Amanora. Posted just now, still waiting on the listing check.',
  '["https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=800&q=70"]',
  '2026-09-07 21:10:00+05:30', '2026-09-07 21:10:00+05:30')
    ON CONFLICT DO NOTHING;

-- Split rooms use the occupancy model; a partially occupied room keeps its filling state covered.
INSERT INTO public.flatmate_rooms
    (id, host_id, property_id, room_kind, room_type, attached_bath, price_basis,
     budget, deposit, occupants, max_occupants, seats_total, seats_open,
     host_role, verification_tier, verified, agreement_declared, mod_status,
     society, locality, localities, lat, lng, bhk, flat_type, home_type_label,
     gated_community, furnishing, move_in, available_from, gender, food, tags, note, photos,
     created_at, updated_at)
VALUES
 ('f1c7000b-0000-4000-8000-000000000011', 'f1c70000-0000-4000-8000-000000000010',
  'f1c70000-0000-4000-8000-000000005123', 'master', 'Private room', 'attached', 'room',
  18000, 36000, 1, 4, NULL, NULL,
  'owner', 'owner', true, true, 'approved',
  'Balewadi Highstreet Residences', 'Balewadi', '["Balewadi"]', 18.575, 73.769, '3', '3 BHK', 'Flat',
  true, 'furnished', 'now', DATE '2026-09-10', 'any', 'any',
  '["Working professional", "Non-smoker"]',
  'Master bedroom with attached bathroom and balcony. Take it on your own or split it with someone.',
  '["https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=800&q=70"]',
  '2026-09-05 10:00:00+05:30', '2026-09-05 10:00:00+05:30'),

 ('f1c7000b-0000-4000-8000-000000000012', 'f1c70000-0000-4000-8000-000000000010',
  'f1c70000-0000-4000-8000-000000005123', 'bedroom', 'Private room', 'shared', 'room',
  14000, 28000, 0, 4, NULL, NULL,
  'owner', 'owner', true, true, 'approved',
  'Balewadi Highstreet Residences', 'Balewadi', '["Balewadi"]', 18.575, 73.769, '3', '3 BHK', 'Flat',
  true, 'furnished', 'now', DATE '2026-09-10', 'any', 'any',
  '["Working professional"]',
  'Second bedroom in the same flat, shares the common bathroom. Walkable to the stadium side.',
  '["https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70"]',
  '2026-09-05 10:00:00+05:30', '2026-09-05 10:00:00+05:30'),

 ('f1c7000b-0000-4000-8000-000000000013', 'f1c70000-0000-4000-8000-000000000010',
  'f1c70000-0000-4000-8000-000000005123', 'living', 'Shared room', 'shared', 'room',
  10000, 20000, 0, 4, NULL, NULL,
  'owner', 'owner', true, true, 'approved',
  'Balewadi Highstreet Residences', 'Balewadi', '["Balewadi"]', 18.575, 73.769, '3', '3 BHK', 'Flat',
  true, 'furnished', 'now', DATE '2026-09-10', 'any', 'any',
  '["Student", "Working professional"]',
  'Partitioned living room -- the cheapest way into this society, and lower still if you split it.',
  '["https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=800&q=70"]',
  '2026-09-05 10:00:00+05:30', '2026-09-05 10:00:00+05:30')
    ON CONFLICT DO NOTHING;

-- Groups have no property or society because move-in supply is represented by rooms.
INSERT INTO public.flatmate_groups
    (id, host_id, property_id, title, locality, policy, rent, seats_total, seats_open,
     host_role, verification_tier, agreement_declared, owner_consent, owner_consent_mobile,
     mod_status, tags, note, created_at, updated_at)
VALUES
 ('f1c7000d-0000-4000-8000-000000000009', 'f1c70000-0000-4000-8000-000000000010',
  NULL,
  'Owner-let 2 BHK in Wakad, one seat left', 'Wakad', 'any', 24000, 2, 1,
  'owner', 'owner', true, false, NULL, 'live',
  '["Working professional", "Non-smoker"]',
  'I own the flat and live in Mumbai. One tenant already in, looking for one more on the same agreement.',
  '2026-09-05 11:00:00+05:30', '2026-09-05 11:00:00+05:30'),

 ('f1c7000d-0000-4000-8000-000000000010', 'f1c70000-0000-4000-8000-000000000031',
  NULL, 'Full 3 BHK in Kharadi, waitlist only', 'Kharadi', 'women', 39000, 3, 0,
  'tenant', 'identity', false, false, NULL, 'approved',
  '["Vegetarian", "Non-smoker"]',
  'All three of us are settled in. Leaving this up so people can put their name down for March.',
  '2026-09-04 15:20:00+05:30', '2026-09-04 15:20:00+05:30'),

 -- Keep the Baner women-only group above the ₹10,000 per-head search ceiling.
 ('f1c7000d-0000-4000-8000-000000000011', 'f1c70000-0000-4000-8000-000000000032',
  NULL, 'Non-smokers 3 BHK in Baner, one seat', 'Baner', 'women', 33000, 3, 1,
  'tenant', 'tenant', true, true, '9820011223', 'live',
  '["Non-smoker", "Early riser", "Fitness"]',
  'Landlord has agreed in writing to a replacement on the existing agreement, so no fresh deposit.',
  '2026-09-03 09:40:00+05:30', '2026-09-03 09:40:00+05:30'),

 ('f1c7000d-0000-4000-8000-000000000012', 'f1c70000-0000-4000-8000-000000000033',
  NULL, 'Two seats in a 3 BHK, Kothrud', 'Kothrud', 'men', 30000, 3, 2,
  'tenant', 'identity', false, false, NULL, 'pending',
  '["Non-veg ok", "Night owl"]',
  'Two of us moving out at the end of the month, so two seats going together or separately.',
  '2026-09-07 20:00:00+05:30', '2026-09-07 20:00:00+05:30'),

 ('f1c7000d-0000-4000-8000-000000000013', 'f1c70000-0000-4000-8000-000000000034',
  NULL, 'Girls 3 BHK share in Viman Nagar', 'Viman Nagar', 'women', 32000, 3, 1,
  'tenant', 'identity', false, false, NULL, 'approved',
  '["Vegetarian", "Working professional"]',
  'Two of us here already, both in aviation. Looking for one more, preferably veg.',
  '2026-09-02 17:00:00+05:30', '2026-09-02 17:00:00+05:30')
    ON CONFLICT DO NOTHING;

-- Consent rows retain the landlord approval audit trail for tenant-hosted groups.
INSERT INTO public.flatmate_owner_consents (id, owner_mobile, granted_by, group_id, granted_at, created_at, updated_at)
VALUES
 ('f1c70012-0000-4000-8000-000000000001', '9820011223', 'f1c70000-0000-4000-8000-000000000032',
  'f1c7000d-0000-4000-8000-000000000011',
  '2026-09-03 09:35:00+05:30', '2026-09-03 09:35:00+05:30', '2026-09-03 09:35:00+05:30')
    ON CONFLICT DO NOTHING;

-- Members cover named, linked, and unnamed occupied seats without placeholder identities.
INSERT INTO public.flatmate_group_members (id, group_id, user_id, name, initials, verified, created_at, updated_at)
VALUES
 ('f1c7000e-0000-4000-8000-000000000001', 'f1c7000d-0000-4000-8000-000000000001', 'f1c70000-0000-4000-8000-000000000021', 'Sneha Joshi',    'SJ', true,  '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c7000e-0000-4000-8000-000000000002', 'f1c7000d-0000-4000-8000-000000000001', NULL,                                   'Riya',           'R',  false, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c7000e-0000-4000-8000-000000000003', 'f1c7000d-0000-4000-8000-000000000002', 'f1c70000-0000-4000-8000-000000000022', 'Aditi Rao',      'AR', true,  '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c7000e-0000-4000-8000-000000000004', 'f1c7000d-0000-4000-8000-000000000003', 'f1c70000-0000-4000-8000-000000000024', 'Karan Malhotra', 'KM', false, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c7000e-0000-4000-8000-000000000005', 'f1c7000d-0000-4000-8000-000000000003', NULL,                                   'Aditya',         'A',  false, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c7000e-0000-4000-8000-000000000006', 'f1c7000d-0000-4000-8000-000000000004', 'f1c70000-0000-4000-8000-000000000025', 'Nikhil Rane',    'NR', true,  '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c7000e-0000-4000-8000-000000000007', 'f1c7000d-0000-4000-8000-000000000005', 'f1c70000-0000-4000-8000-000000000001', 'Rahul Mehta',    'RM', false, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c7000e-0000-4000-8000-000000000008', 'f1c7000d-0000-4000-8000-000000000006', NULL,                                   'Ananya',         'A',  false, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c7000e-0000-4000-8000-000000000009', 'f1c7000d-0000-4000-8000-000000000007', '3ad0171b-3206-53e2-b6dc-732bf4e1b44c', 'Meera Deshpande','MD', true,  '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c7000e-0000-4000-8000-000000000010', 'f1c7000d-0000-4000-8000-000000000008', NULL,                                   NULL,             NULL, false, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c7000e-0000-4000-8000-000000000011', 'f1c7000d-0000-4000-8000-000000000009', 'f1c70000-0000-4000-8000-000000000003', 'Arjun Rao',      'AR', false, '2026-09-05 11:00:00+05:30', '2026-09-05 11:00:00+05:30'),
 ('f1c7000e-0000-4000-8000-000000000012', 'f1c7000d-0000-4000-8000-000000000010', 'f1c70000-0000-4000-8000-000000000023', 'Pooja Shah',     'PS', false, '2026-09-04 15:20:00+05:30', '2026-09-04 15:20:00+05:30'),
 ('f1c7000e-0000-4000-8000-000000000013', 'f1c7000d-0000-4000-8000-000000000010', NULL,                                   'Sanika',         'S',  false, '2026-09-04 15:20:00+05:30', '2026-09-04 15:20:00+05:30'),
 ('f1c7000e-0000-4000-8000-000000000014', 'f1c7000d-0000-4000-8000-000000000011', 'f1c70000-0000-4000-8000-000000000002', 'Priya Nair',     'PN', false, '2026-09-03 09:40:00+05:30', '2026-09-03 09:40:00+05:30'),
 ('f1c7000e-0000-4000-8000-000000000015', 'f1c7000d-0000-4000-8000-000000000013', NULL,                                   'Kavya',          'K',  false, '2026-09-02 17:00:00+05:30', '2026-09-02 17:00:00+05:30')
    ON CONFLICT DO NOTHING;

-- Review rows cover each moderation state available to tenant-tier posts.
INSERT INTO public.flatmate_reviews
    (id, kind, room_id, group_id, host_id, address, tier, flag_for_review, owner_consent,
     agreement_doc, status, reason, decided_by, created_at, updated_at)
VALUES
 ('f1c70010-0000-4000-8000-000000000001', 'room', 'f1c7000b-0000-4000-8000-000000000004', NULL,
  'f1c70000-0000-4000-8000-000000000032', 'Lodha Belmondo, Hinjawadi', 'tenant', false, false,
  '{"kind": "rent_agreement", "pages": 4}', 'approved', NULL,
  'e6621d3a-3e31-5022-a6c9-34a90c8f6e9b',
  '2026-09-04 11:35:00+05:30', '2026-09-04 14:00:00+05:30'),

 ('f1c70010-0000-4000-8000-000000000002', 'room', 'f1c7000b-0000-4000-8000-000000000006', NULL,
  'f1c70000-0000-4000-8000-000000000034', 'Rohan Iris, Wakad', 'tenant', false, false,
  '{"kind": "rent_agreement", "pages": 3}', 'pending', NULL, NULL,
  '2026-09-03 08:20:00+05:30', '2026-09-03 08:20:00+05:30'),

 ('f1c70010-0000-4000-8000-000000000003', 'group', NULL, 'f1c7000d-0000-4000-8000-000000000011',
  'f1c70000-0000-4000-8000-000000000032', 'Sr 42, Baner', 'tenant', false, true,
  '{"kind": "owner_consent_note", "pages": 1}', 'pending', NULL, NULL,
  '2026-09-03 09:45:00+05:30', '2026-09-03 09:45:00+05:30')
    ON CONFLICT DO NOTHING;

-- Requests cover each host decision state and preserve its timestamp constraint.
INSERT INTO public.flatmate_requests
    (id, kind, target_id, host_id, requester_id, action, share, message, status,
     requested_at, decided_at, created_at, updated_at)
VALUES
 ('f1c7000f-0000-4000-8000-000000000001', 'room', 'f1c7000b-0000-4000-8000-000000000003',
  'f1c70000-0000-4000-8000-000000000031', 'f1c70000-0000-4000-8000-000000000001',
  'request', 'solo', 'Hi -- is the room still free from the 10th? I work in Baner so this is walking distance.',
  'pending', '2026-09-06 10:00:00+05:30', NULL, '2026-09-06 10:00:00+05:30', '2026-09-06 10:00:00+05:30'),

 ('f1c7000f-0000-4000-8000-000000000002', 'group', 'f1c7000d-0000-4000-8000-000000000002',
  'f619aa88-84ed-50ce-9a07-abb7712afa9d', 'f1c70000-0000-4000-8000-000000000002',
  'join', 'match', 'Happy to be matched with whoever else joins.',
  'accepted', '2026-09-02 12:00:00+05:30', '2026-09-02 18:30:00+05:30', '2026-09-02 12:00:00+05:30', '2026-09-02 18:30:00+05:30'),

 ('f1c7000f-0000-4000-8000-000000000003', 'flatmate', 'f1c7000c-0000-4000-8000-000000000004',
  'f1c70000-0000-4000-8000-000000000021', 'f1c70000-0000-4000-8000-000000000025',
  'request', 'solo', 'I have a spare room in Hinjawadi if you are still looking.',
  'declined', '2026-09-01 09:00:00+05:30', '2026-09-01 20:15:00+05:30', '2026-09-01 09:00:00+05:30', '2026-09-01 20:15:00+05:30'),

 ('f1c7000f-0000-4000-8000-000000000004', 'room', 'f1c7000b-0000-4000-8000-000000000005',
  'f1c70000-0000-4000-8000-000000000033', 'f1c70000-0000-4000-8000-000000000003',
  'request', 'bring', 'Two of us, we would take the shared room together.',
  'pending', '2026-09-06 14:45:00+05:30', NULL, '2026-09-06 14:45:00+05:30', '2026-09-06 14:45:00+05:30')
    ON CONFLICT DO NOTHING;

INSERT INTO public.flatmate_group_applications
    (id, listing_id, group_id, applicant_id, status, mod_status, note, decided_at, created_at, updated_at)
VALUES
 ('f1c70011-0000-4000-8000-000000000001', 'f1c70000-0000-4000-8000-000000005121',
  'f1c7000d-0000-4000-8000-000000000004', 'f1c70000-0000-4000-8000-000000000010',
  'pending', 'live', 'My 2 BHK in Wakad is free from October if the four of you want to move together.',
  NULL, '2026-09-06 09:00:00+05:30', '2026-09-06 09:00:00+05:30'),

 ('f1c70011-0000-4000-8000-000000000002', 'f1c70000-0000-4000-8000-000000005122',
  'f1c7000d-0000-4000-8000-000000000003', 'f1c70000-0000-4000-8000-000000000010',
  'accepted', 'live', 'Smaller place, but it is in Hinjawadi and available now.',
  '2026-09-06 19:00:00+05:30', '2026-09-05 09:00:00+05:30', '2026-09-06 19:00:00+05:30')
    ON CONFLICT DO NOTHING;

-- Saved rows cover all flatmate kinds; their polymorphic targets must remain valid.
INSERT INTO public.flatmate_saves (user_id, kind, post_id, created_at)
VALUES
 ('f1c70000-0000-4000-8000-000000000001', 'room',  'f1c7000b-0000-4000-8000-000000000003', '2026-09-06 10:05:00+05:30'),
 ('f1c70000-0000-4000-8000-000000000001', 'room',  'f1c7000b-0000-4000-8000-000000000011', '2026-09-06 10:06:00+05:30'),
 ('f1c70000-0000-4000-8000-000000000001', 'group', 'f1c7000d-0000-4000-8000-000000000002', '2026-09-06 10:07:00+05:30'),
 ('f1c70000-0000-4000-8000-000000000001', 'post',  'f1c7000c-0000-4000-8000-000000000004', '2026-09-06 10:08:00+05:30')
    ON CONFLICT DO NOTHING;

-- Seeker localities preserve the map cap and ensure move-in and habit filters narrow results.
INSERT INTO public.flatmate_seeker_posts
    (id, user_id, name, gender, age, occupation, budget, localities, move_in,
     flat_pref, room_pref, tags, note, verified_contact_only, verified, mod_status,
     created_at, updated_at)
VALUES
 ('f1c7000c-0000-4000-8000-000000000009', 'f1c70000-0000-4000-8000-000000000037',
  'Ishaan Kulkarni', 'male', 27, 'Backend Engineer', 20000, '["Balewadi"]', '30',
  'any', 'private', '["Non-veg ok", "Working professional", "Fitness"]',
  'Moving from Bangalore in October. Would rather pay more for a private room than share.',
  true, false, 'approved',
  '2026-09-06 08:00:00+05:30', '2026-09-06 08:00:00+05:30'),

 ('f1c7000c-0000-4000-8000-000000000010', 'f1c70000-0000-4000-8000-000000000038',
  'Tanvi Deshmukh', 'female', 22, 'Student', 11000, '["Viman Nagar"]', 'now',
  'women', 'shared', '["Vegetarian", "Student", "Non-smoker"]',
  'Second-year student at Symbiosis, looking for a women-only flat close to campus.',
  false, false, 'approved',
  '2026-09-07 13:00:00+05:30', '2026-09-07 13:00:00+05:30')
    ON CONFLICT DO NOTHING;

-- Dynamic move-in dates keep relative-date fixtures meaningful.
UPDATE public.flatmate_seeker_posts
SET move_in_at = CASE
        WHEN lower(btrim(move_in)) = 'now' THEN current_date
        WHEN btrim(move_in) IN ('15', '30', '60') THEN current_date + btrim(move_in)::integer
        WHEN btrim(move_in) ~ '^\d{4}-\d{2}-\d{2}$' THEN btrim(move_in)::date
        ELSE NULL
    END
WHERE move_in IS NOT NULL AND btrim(move_in) <> '';

-- Apply the same translation to room availability.
UPDATE public.flatmate_rooms
SET available_from = CASE
        WHEN lower(btrim(move_in)) = 'now' THEN current_date
        WHEN btrim(move_in) IN ('15', '30', '60') THEN current_date + btrim(move_in)::integer
        WHEN btrim(move_in) ~ '^\d{4}-\d{2}-\d{2}$' THEN btrim(move_in)::date
        ELSE available_from
    END
WHERE move_in IS NOT NULL AND btrim(move_in) <> '';

-- Keep the lifetime listing count derived from all property rows after fixture inserts.
update public.users u
   set listings_count = c.n
  from (select owner_id, count(*) as n from public.properties group by owner_id) c
 where c.owner_id = u.id
   and u.listings_count is distinct from c.n;

update public.users u
   set listings_count = 0
 where u.listings_count <> 0
   and not exists (select 1 from public.properties p where p.owner_id = u.id);

-- Fixture inserts run after versioned migrations; repair only contradictions, never a valid staff correction.
UPDATE public.properties p
SET lifecycle_track = CASE WHEN posted_by_admin THEN 'staff' ELSE 'owner' END,
     lifecycle_stage = CASE
          WHEN status = 'approved' AND NOT archived THEN 'live'
          WHEN status <> 'pending' OR archived THEN NULL
          WHEN NOT posted_by_admin THEN 'submitted'
          WHEN jsonb_array_length(coalesce(images, '[]'::jsonb)) > 0
                 OR EXISTS (SELECT 1 FROM public.documents d WHERE d.property_id = p.id
                                AND d.service_request_id IS NULL) THEN 'photos_docs'
          ELSE NULL END
WHERE lifecycle_track <> CASE WHEN posted_by_admin THEN 'staff' ELSE 'owner' END
    OR (status = 'approved' AND NOT archived AND lifecycle_stage IS DISTINCT FROM 'live')
    OR ((status NOT IN ('pending', 'approved') OR archived) AND lifecycle_stage IS NOT NULL);
