-- ============================================================================================
-- R__zz_dev_demo_data.sql — the local demo catalogue. DEV ONLY.
--
-- WHY THE `zz_` PREFIX — it is not decoration, and removing it breaks the boot.
-- ----------------------------------------------------------------------------
-- Flyway runs repeatable migrations in alphabetical order **by description**, ignoring which
-- location they came from. As `R__dev_demo_data` this file sorted before `R__seed_reference_data`,
-- so the 38 demo listings were inserted before the localities they reference existed, and Flyway
-- died on `properties_locality_slug_fkey`. The prefix forces this to run last, after every table it
-- depends on has been populated. Any future demo seed needs the same treatment.
--
-- WHY THIS FILE EXISTS
-- --------------------
-- Until now the 38 listings and 78 users that make the local app look like a product lived in
-- exactly one place: a single Postgres database on one laptop. No script created them, so
-- `DROP DATABASE` — or a Flyway checksum mismatch severe enough to force a rebuild, which is
-- precisely what happened on 2026-08-04 — destroyed a dataset nothing could regenerate. That is
-- recorded as tech-debt D81. This file closes it: the demo data is now source, versioned with the
-- schema that shapes it, and a rebuilt database comes back identical.
--
-- WHY IT IS REPEATABLE (R__) RATHER THAN VERSIONED (V__)
-- ------------------------------------------------------
-- A repeatable migration re-runs whenever its checksum changes and always runs *after* every
-- pending versioned migration. Both properties are wanted here. Adding a listing to the demo set is
-- an edit to this file rather than a new V-script, so the seed does not inflate the version history
-- with data changes; and because it runs last, it can rely on the whole schema existing.
--
-- Every statement is `ON CONFLICT DO NOTHING` with hard-coded UUIDs, so re-running is a no-op
-- rather than a duplicate-key failure. The conflict target is deliberately left off: scoping it to
-- `(id)` was the first attempt and it failed on `users_mobile_key`, because a seeded mobile can
-- already exist under a *different* id — a developer who signed in as 9876543210 before running the
-- seed. A bare `DO NOTHING` means "if this row already exists in any sense, leave it alone", which
-- is what a seed actually wants.
--
-- It also means **this file does not update existing rows**: to change a seeded listing, change it
-- here and recreate the database, or edit the row directly. Chasing UPSERT semantics here would
-- make the seed a migration tool, which it is not.
--
-- WHY IT IS EXCLUDED FROM THE TEST RUN
-- ------------------------------------
-- It is NOT in `db/migration`. It lives in `db/seed`, and only the `dev` profile lists that
-- location (`spring.flyway.locations` in application-dev.properties). This is load-bearing:
--
--   * `mvn verify` runs 733 tests against `punenest_test`, and 126 of those assertions are exact
--     counts — a test inserts four listings and asserts `totalElements == 2` after the
--     approved/archived filter. Seeding 38 more listings turns every one of those into
--     `expected 2, got 21`. The suite's isolation model is transaction rollback, which protects it
--     from *other tests*, not from data that was already committed before it started.
--   * The `prod` profile must never see it at all.
--
-- So: one database for local development, populated and never truncated (which is what this
-- enables); a separate empty one for the test suite. `docs/LOCAL_DEV.md` §1 has the full rationale.
--
-- WHAT IS AND IS NOT IN HERE
-- --------------------------
-- In:  users, properties, conversations, messages, contact_requests, visits — the data a developer
--      needs to see a populated app.
-- In:  a second, much smaller block at the END of this file (search `NAMED FIXTURE CONTRACT`)
--      covering saved_properties, saved_searches, notifications, reviews, reports,
--      support_tickets, deals, offers, tenancies and rent_payments. Those rows are not dumped
--      demo content — each one exists to guarantee a named invariant listed in
--      `docs/system/fixture-registry.md`, so read that before changing any of them.
-- In:  four of the 38 listings carry `posted_by_admin = true` — the concierge funnel, where staff
--      created the listing and are chasing the owner to take it over. They are ordinary rows with
--      three columns set, not a separate block. Since D27 they are spread across *two* axes rather
--      than one: `pipeline_stage` (how far the acquisition got) and `handback_milestone` (how far
--      giving it back got). The three booleans the board draws are *derived* from the milestone by
--      `PipelineStage.reached`, so one listing per milestone is the only way to exercise all the
--      combinations. The two `contacted` / `info_collected` stages are deliberately unseeded: they
--      describe a conversation with no paperwork behind it, and the funnel is exercised there by
--      the write path (`POST /properties/{id}/pipeline`) rather than by a fixture pretending a
--      phone call happened. Named and explained in `docs/system/fixture-registry.md`; the mock's
--      old client-side `seedConciergeDemo` is what they replace.
-- Out: `otp_codes` and `refresh_tokens`. Both were present in the source database (61 and 30 rows)
--      and both are session residue with short expiries — seeding them would ship a set of
--      pre-issued tokens and already-expired login codes to every developer's machine, which is
--      noise at best and a bad habit at worst.
-- Out: localities, cities, settings, platform_fees. Those are reference data and are already
--      created by `R__seed_reference_data.sql`, which runs for every profile including prod.
--
-- No row here carries a credential: `password_hash` is NULL on all 78 users (verified before
-- committing), so nothing in this file is a secret, and the staff/admin accounts are unusable
-- until someone sets a password deliberately.
--
-- Generated 2026-08-04 by `pg_dump --data-only --column-inserts` from the pre-rebuild dev database,
-- then made idempotent. Backup of the original kept at ~/punenest-db-backup.
--
-- ONE ROW WAS REPAIRED ON THE WAY OUT, and it is worth knowing why.
-- --------------------------------------------------------------
-- The source database was stuck at V10. `conversations_pair_ordered`
-- (`CHECK (user_a_id < user_b_id)`) arrived in a later migration, so one of the four demo
-- conversations had its participants stored the other way round and had never been checked. Loading
-- it into the current V30 schema failed.
--
-- The pair was swapped rather than the row dropped: a conversation is symmetric, the ordering is a
-- storage convention that makes the unique index work, so swapping changes nothing anybody can see.
-- Worth recording because it is the general hazard of reviving old data — **data extracted from an
-- old schema is not automatically valid under the current one**, and the constraints added in
-- between are exactly the ones nothing has ever checked it against.
-- ============================================================================================

INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('4b59bacd-8a45-4cf7-9ec9-a09d94846f2b', 'Rohan Kulkarni', '9876501070', NULL, NULL, 'buyer', NULL, 'active', NULL, true, false, false, false, 0, NULL, '2026-07-29 23:16:53.636188+05:30', '2026-07-29 23:16:53.636189+05:30', false, NULL, NULL, '2026-07-29 23:16:53.636188+05:30', '2026-07-29 23:16:53.636188+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('c68b2dc8-89a7-5180-b94c-8daa349ff2fc', 'Neha Bhosale', '9508576263', NULL, NULL, 'buyer', NULL, 'suspended', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('569a14d9-004f-5c1a-b2b5-bc1e35d657e8', 'Aarav Sharma', '9277735599', NULL, NULL, 'buyer', NULL, 'suspended', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('98332c2c-c28c-4438-8bf8-9b66faa3704d', 'Priya Deshpande', '9876558345', NULL, NULL, 'buyer', NULL, 'active', NULL, true, false, false, false, 0, NULL, '2026-07-29 23:17:46.582544+05:30', '2026-07-29 23:17:46.582545+05:30', false, NULL, NULL, '2026-07-29 23:17:46.582544+05:30', '2026-07-29 23:17:46.582544+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('b05422ba-0a55-5136-ba68-d202e83e29b0', 'Isha Mehta', '9552538370', NULL, NULL, 'owner', NULL, 'active', 'Pune', true, false, false, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('7f200cc3-b892-4a2c-9ba2-b6627abf4006', 'Karan Joshi', '9876525851', NULL, NULL, 'buyer', NULL, 'active', NULL, true, false, false, false, 0, NULL, '2026-07-29 23:18:54.176382+05:30', '2026-07-29 23:18:54.176383+05:30', false, NULL, NULL, '2026-07-29 23:18:54.176382+05:30', '2026-07-29 23:18:54.176382+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('a2f1134d-b836-40db-b42c-0fc3df0f409c', 'Ananya Reddy', '9876578025', NULL, NULL, 'buyer', NULL, 'active', NULL, true, false, false, false, 0, NULL, '2026-07-29 23:19:46.51218+05:30', '2026-07-29 23:19:46.511182+05:30', false, NULL, NULL, '2026-07-29 23:19:46.51218+05:30', '2026-07-29 23:19:46.51218+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('18918424-fc3a-4117-b1e7-e8437ac311d5', 'Vikram Nair', '9876528351', NULL, NULL, 'buyer', NULL, 'active', NULL, true, false, false, false, 0, NULL, '2026-07-29 23:30:41.320258+05:30', '2026-07-29 23:30:41.319249+05:30', false, NULL, NULL, '2026-07-29 23:30:41.320258+05:30', '2026-07-29 23:30:41.320258+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('74feff4f-f669-5adc-93d5-bd1ad0d0e2a9', 'Sneha Iyer', '9395852523', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, false, false, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('24daef28-5a4d-58af-af85-ec1cdde8540d', 'Aditya Shah', '9878457666', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('65e66346-62d0-525f-be12-81d3f1868f06', 'Aditya Iyer', '9712728163', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('8d8c7e15-efe0-45e0-81b4-371920583c2d', 'Meera Kapoor', '9876551627', NULL, NULL, 'buyer', NULL, 'active', NULL, true, false, false, false, 0, NULL, '2026-07-29 23:31:00.370694+05:30', '2026-07-29 23:31:00.370694+05:30', false, NULL, NULL, '2026-07-29 23:31:00.370694+05:30', '2026-07-29 23:31:00.370694+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('758f8534-ee2d-5075-ab65-8e89bb294047', 'Meera Chavan', '9817252766', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('b4cd0c15-882c-4690-be31-82e5671e7e67', 'Parity Renamed', '9876571278', NULL, NULL, 'buyer', NULL, 'active', NULL, true, false, false, false, 0, NULL, '2026-07-29 23:31:12.078774+05:30', '2026-07-29 23:31:12.077777+05:30', false, NULL, NULL, '2026-07-29 23:31:12.078774+05:30', '2026-07-29 23:31:12.104691+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('3487a033-ec13-5901-9920-cd4d89b2561d', 'Nikhil Nair', '9133973978', NULL, NULL, 'owner', NULL, 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('14ebad35-1376-5f40-8f53-e910ef773a6a', 'Rahul Jain', '9272696131', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('4588d5ce-b4e0-53a0-a181-2c26bbcecf67', 'Vikram Rao', '9318202961', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('9ccc7159-1e42-532f-b036-5f12dbe6000c', 'Pooja Shah', '9253229149', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('7f876da7-2eab-5c63-ba1f-8475a58871e1', 'Neha Sharma', '9808019141', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('f41432f7-f16e-57b3-bbd3-1b581c38b0d4', 'Omkar Gupta', '9207292146', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('e9f29e71-187e-5afc-ba46-be7b199eff2a', 'Aarav Deshpande', '9382625379', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('bec95d4f-6e17-50ce-b253-aaf9cd240dfd', 'Tanvi Deshpande', '9122040348', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('4336aef6-f776-582c-8b26-c53ae58aea73', 'Ananya Reddy', '9650468398', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('505e4c69-7dca-530b-8f0d-6a2150943aa5', 'Diya Deshpande', '9152892152', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('15834543-55fe-5931-87ac-fca594aa0566', 'Aarav Reddy', '9240355264', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('03efa85e-d675-5bc5-9798-7a24eeaee9c7', 'Siddharth Iyer', '9781813747', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('22942abf-8846-5f86-84ca-7dcf63a70dd7', 'Gauri Mehta', '9691884062', NULL, NULL, 'owner', NULL, 'active', 'Pune', true, false, false, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('d9b4d06c-a0fc-522f-b708-f2ebd16ef1eb', 'Isha Bhosale', '9441541427', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('503aa11e-bf1a-5216-a0ae-69a59b4deda6', 'Kabir Nair', '9697910226', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('a98a8ed4-88ff-58e3-90ec-c9f09855e69f', 'Rahul Joshi', '9641381391', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('dc911757-c841-552e-9509-cbdaaf525491', 'Sneha Jain', '9394055866', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, false, false, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('b8ec5346-4a95-4181-bf72-85343ed467e8', 'Siddharth Rao', '9876500202', NULL, NULL, 'buyer', NULL, 'active', NULL, true, false, false, false, 0, NULL, '2026-07-28 22:59:08.427934+05:30', '2026-07-28 22:59:08.426934+05:30', false, NULL, NULL, '2026-07-28 22:59:08.427934+05:30', '2026-07-28 22:59:08.427934+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('35873c08-6403-55cf-9101-d02d37f94a93', 'Nikhil Rao', '9328855615', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('a37b5ebe-8bf3-4481-9850-0bbcdd3b9a81', 'Pooja Gupta', '9876500601', NULL, NULL, 'buyer', NULL, 'active', NULL, true, false, false, false, 0, NULL, '2026-07-28 22:59:08.697728+05:30', '2026-07-28 22:59:08.697729+05:30', false, NULL, NULL, '2026-07-28 22:59:08.697728+05:30', '2026-07-28 22:59:08.697728+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('ba0655a9-9d0d-4f15-aad9-d32b6968c072', 'Arjun Menon', '9876500401', NULL, NULL, 'buyer', NULL, 'active', NULL, true, false, false, false, 0, NULL, '2026-07-28 22:59:08.738808+05:30', '2026-07-28 22:59:08.73781+05:30', false, NULL, NULL, '2026-07-28 22:59:08.738808+05:30', '2026-07-28 22:59:08.738808+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('d512c905-496b-454e-8de9-3a4c0a23522d', 'Divya Pillai', '9876500501', NULL, NULL, 'buyer', NULL, 'active', NULL, true, false, false, false, 0, NULL, '2026-07-28 22:59:08.802253+05:30', '2026-07-28 22:59:08.802254+05:30', false, NULL, NULL, '2026-07-28 22:59:08.802253+05:30', '2026-07-28 22:59:08.802253+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('854d1765-efe9-57c8-99fb-315e3006dd6f', 'Nikhil Nair', '9283184696', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('4825cc29-cf4c-5731-be60-de982e060ac2', 'Isha Deshpande', '9784345146', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('dadc36e0-9648-5f10-b4b8-15fd08e59562', 'Kabir Rao', '9396565787', NULL, NULL, 'buyer', NULL, 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('18ed4042-34c2-5377-9a9b-b88dbc9d6d3c', 'Sakshi Iyer', '9239397704', NULL, NULL, 'buyer', NULL, 'suspended', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('a42b4ffe-5238-5b86-b7e2-51ee8cc8b336', 'Riya Rao', '9158026750', NULL, NULL, 'buyer', NULL, 'suspended', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('e427a0c0-65a6-5da4-bcba-0e50f64953a9', 'Kabir Iyer', '9711827190', NULL, NULL, 'staff', 'rental', 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('54408cbb-9bc0-5168-b535-67468be09c17', 'Rahul Joshi', '9490074473', NULL, NULL, 'staff', 'rental', 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('da3bdca6-6a72-5059-89f6-9e9c20b9f5c9', 'Isha Mehta', '9733798115', NULL, NULL, 'staff', 'rental', 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('816b88ce-1c71-5326-ba5d-f467c24d529e', 'Isha Iyer', '9223611750', NULL, NULL, 'staff', 'legal', 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('b72c0b47-5dc2-507d-9e45-e664755ba45a', 'Meera Mehta', '9834262782', NULL, NULL, 'staff', 'legal', 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('0073ee7e-fc86-5d28-9744-41641213b1dc', 'Tanvi Rao', '9228948057', NULL, NULL, 'staff', 'interior', 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('95e2cc8f-e901-5d65-9a40-7faad35e1043', 'Nikhil Joshi', '9409479949', NULL, NULL, 'staff', 'interior', 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('32f33fc0-cbf3-5c59-b8c8-6b4dcde64c39', 'Diya Kulkarni', '9710931232', NULL, NULL, 'staff', 'interior', 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('d3f9bd0e-6500-5627-b07a-2ee095e71183', 'Neha Mehta', '9219136301', NULL, NULL, 'staff', 'packers', 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('284d7e40-22bb-53f4-8af3-32401a07569a', 'Diya Jain', '9542346771', NULL, NULL, 'staff', 'packers', 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('a08d2e8e-9757-5b48-a3de-483814c5b129', 'Sakshi Mehta', '9171199048', NULL, NULL, 'staff', 'valuation', 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('b149e49b-b95f-5215-9a2a-2a371206afbf', 'Karan Chavan', '9383334640', NULL, NULL, 'staff', 'valuation', 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('3052d5de-4e04-5709-ab65-23299bb2ea78', 'Meera Iyer', '9743304170', NULL, NULL, 'staff', 'valuation', 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('5bebfff1-5c5b-5df4-a279-1f8fce7dce52', 'Aarav Deshpande', '9812733640', NULL, NULL, 'staff', 'loans', 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('c24b67b7-48eb-5906-9860-ee5f79fd7ef6', 'Priya Nair', '9820511744', NULL, NULL, 'staff', 'loans', 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('e6621d3a-3e31-5022-a6c9-34a90c8f6e9b', 'Admin', '9000000000', NULL, NULL, 'admin', NULL, 'active', 'Pune', true, true, true, false, 0, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('7468edfd-f663-5c53-82cb-2d55c757dd2b', 'Tanvi Jain', '9531006179', NULL, NULL, 'owner', NULL, 'suspended', 'Pune', true, false, false, false, 2, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('6e0d6446-90ad-5b90-89aa-617a89f387a0', 'Sakshi Rao', '9596499088', NULL, NULL, 'owner', NULL, 'active', 'Pune', true, true, true, false, 4, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('190ca53e-0f1b-52e0-b825-7cd1f9accd91', 'Meera Joshi', '9464709344', NULL, NULL, 'owner', NULL, 'active', 'Pune', true, false, false, false, 2, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('f619aa88-84ed-50ce-9a07-abb7712afa9d', 'Omkar Kulkarni', '9708919481', NULL, NULL, 'owner', NULL, 'active', 'Pune', true, false, false, false, 3, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('51a4c85a-d1f6-5602-9d71-78393d8abd3c', 'Aditya Sharma', '9217580334', NULL, NULL, 'owner', NULL, 'active', 'Pune', true, true, true, false, 2, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('19bdc371-5496-5930-af29-5ef3d8e6bb8b', 'Rohan Kulkarni', '9530047855', NULL, NULL, 'owner', NULL, 'suspended', 'Pune', true, false, false, false, 2, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('7c92f0c4-3fb9-50f8-ae42-ccb1995660fd', 'Nikhil Jain', '9411618812', NULL, NULL, 'owner', NULL, 'active', 'Pune', true, true, true, false, 2, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('0505d7d5-3062-5abc-a33b-fc0e45bde6c5', 'Nikhil Sharma', '9646894809', NULL, NULL, 'owner', NULL, 'active', 'Pune', true, true, true, false, 2, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('8f1caf57-9535-5888-a241-096081e2e621', 'Siddharth Gupta', '9193853276', NULL, NULL, 'owner', NULL, 'active', 'Pune', true, false, false, false, 1, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('b877af02-d4b6-53e3-9aff-66637281e6d2', 'Tanvi Chavan', '9592138848', NULL, NULL, 'owner', NULL, 'active', 'Pune', true, false, false, false, 2, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('6f77d348-d008-5e70-aeaa-cc465a73e28a', 'Meera Iyer', '9672137494', NULL, NULL, 'owner', NULL, 'active', 'Pune', true, false, false, false, 2, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('e1e2d40c-f128-5694-ae78-490b413567ee', 'Sneha Shah', '9124855617', NULL, NULL, 'owner', NULL, 'active', 'Pune', true, false, false, false, 3, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('de87779e-383b-5916-bc80-b3ee85c4fcab', 'Vivaan Shah', '9657839865', NULL, NULL, 'owner', NULL, 'active', 'Pune', true, true, true, false, 2, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('6702a32f-999e-550b-ba01-32db68d89707', 'Isha Bhosale', '9180639648', NULL, NULL, 'owner', NULL, 'active', 'Pune', true, true, true, false, 3, NULL, '2026-07-29 22:33:54.213947+05:30', NULL, false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('c06d8be2-459c-4f9e-b4da-48266130be42', 'Rahul Verma', '9876500001', NULL, NULL, 'buyer', NULL, 'active', NULL, true, false, false, false, 0, NULL, '2026-07-29 22:46:44.312922+05:30', '2026-07-29 22:46:44.311914+05:30', false, NULL, NULL, '2026-07-29 22:46:44.312922+05:30', '2026-07-29 22:46:44.312922+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('654410e5-02db-49cb-a9b8-9c7807ed69b9', 'Integration Test', '9876500002', 'it@punenest.local', NULL, 'buyer', NULL, 'active', NULL, true, false, false, false, 0, NULL, '2026-07-29 22:47:00.370325+05:30', '2026-07-29 22:47:00.370326+05:30', false, NULL, NULL, '2026-07-29 22:47:00.370325+05:30', '2026-07-29 22:47:00.401955+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('5a6aac62-45c2-4681-a9ef-bb413d998a89', 'Parity Renamed', '9876551140', NULL, NULL, 'buyer', NULL, 'active', NULL, true, false, false, false, 0, NULL, '2026-07-29 22:50:51.92822+05:30', '2026-07-29 22:50:51.92822+05:30', false, NULL, NULL, '2026-07-29 22:50:51.92822+05:30', '2026-07-29 22:50:51.949333+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('d98519e2-7fd6-4c66-a200-3102bd159785', 'Parity Renamed', '9876508974', NULL, NULL, 'buyer', NULL, 'active', NULL, true, false, false, false, 0, NULL, '2026-07-29 22:51:49.775292+05:30', '2026-07-29 22:51:49.775292+05:30', false, NULL, NULL, '2026-07-29 22:51:49.775292+05:30', '2026-07-29 22:51:49.797559+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('3f9ee2e8-aa24-4bf3-aca5-31613643e537', 'Sanjana Patil', '9876573343', NULL, NULL, 'buyer', NULL, 'active', NULL, true, false, false, false, 0, NULL, '2026-07-29 22:58:02.819849+05:30', '2026-07-29 22:58:02.819849+05:30', false, NULL, NULL, '2026-07-29 22:58:02.819849+05:30', '2026-07-29 22:58:02.819849+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('733a978c-ce5b-504e-ada3-f70d154cfd52', 'Tanvi Mehta', '9108512606', NULL, NULL, 'owner', NULL, 'active', 'Pune', true, true, true, false, 2, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-30 07:38:37.585096+05:30', false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-30 07:38:37.556707+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, email, password_hash, role, team, status, city, mobile_verified, verified, aadhaar_verified, verified_contact_only, listings_count, avatar, joined_at, last_active, archived, archived_at, archive_reason, created_at, updated_at) VALUES ('3ad0171b-3206-53e2-b6dc-732bf4e1b44c', 'Meera Deshpande', '9470744469', NULL, NULL, 'owner', NULL, 'active', 'Pune', true, true, true, false, 4, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-30 13:48:21.407483+05:30', false, NULL, NULL, '2026-07-29 22:33:54.213947+05:30', '2026-07-30 13:48:21.405922+05:30')
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
INSERT INTO public.messages (id, conversation_id, author_id, author_role, body, attachments, read, created_at) VALUES ('7e14d00b-af31-54a4-8f43-5945ab1a2f27', 'bb010b61-0294-5b19-954f-23a4e5bcaef1', '569a14d9-004f-5c1a-b2b5-bc1e35d657e8', 'buyer', 'Hi, I saw your listing on PuneNest. Is it available?', '[]', true, '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.messages (id, conversation_id, author_id, author_role, body, attachments, read, created_at) VALUES ('85bc4b3e-0f25-5725-aef1-f766f3619484', 'bb010b61-0294-5b19-954f-23a4e5bcaef1', '19bdc371-5496-5930-af29-5ef3d8e6bb8b', 'owner', 'Yes it is. Would you like to schedule a visit?', '[]', true, '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.messages (id, conversation_id, author_id, author_role, body, attachments, read, created_at) VALUES ('560fe46b-1774-5fe3-994c-9ac4e9e01ccf', 'bb010b61-0294-5b19-954f-23a4e5bcaef1', '569a14d9-004f-5c1a-b2b5-bc1e35d657e8', 'buyer', 'Great — can I come this Saturday evening?', '[]', false, '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.messages (id, conversation_id, author_id, author_role, body, attachments, read, created_at) VALUES ('63a30090-835e-59b7-934f-7457cdfcafdb', 'bb010b61-0294-5b19-954f-23a4e5bcaef1', '19bdc371-5496-5930-af29-5ef3d8e6bb8b', 'owner', 'Sure, evening works. See you then.', '[]', false, '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.messages (id, conversation_id, author_id, author_role, body, attachments, read, created_at) VALUES ('b0b286fb-f5fb-5a46-aeff-b272114b4cf4', '60547b23-b982-53e5-a5de-625bd964aa20', '74feff4f-f669-5adc-93d5-bd1ad0d0e2a9', 'buyer', 'Hi, I saw your listing on PuneNest. Is it available?', '[]', true, '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.messages (id, conversation_id, author_id, author_role, body, attachments, read, created_at) VALUES ('f625e133-7909-5808-b9dc-d08d18fe0378', '60547b23-b982-53e5-a5de-625bd964aa20', 'de87779e-383b-5916-bc80-b3ee85c4fcab', 'owner', 'Yes it is. Would you like to schedule a visit?', '[]', true, '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.messages (id, conversation_id, author_id, author_role, body, attachments, read, created_at) VALUES ('d6711a4e-b087-5837-b4e1-4b8ac0dce40a', '60547b23-b982-53e5-a5de-625bd964aa20', '74feff4f-f669-5adc-93d5-bd1ad0d0e2a9', 'buyer', 'Great — can I come this Saturday evening?', '[]', false, '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.messages (id, conversation_id, author_id, author_role, body, attachments, read, created_at) VALUES ('39b678e9-eff9-5114-b11d-b41f1e6d2561', '60547b23-b982-53e5-a5de-625bd964aa20', 'de87779e-383b-5916-bc80-b3ee85c4fcab', 'owner', 'Sure, evening works. See you then.', '[]', false, '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.messages (id, conversation_id, author_id, author_role, body, attachments, read, created_at) VALUES ('b0d7686a-61a4-5912-931e-421509a411fd', '0c9cdc1b-0793-56b8-801e-831a15348a28', '24daef28-5a4d-58af-af85-ec1cdde8540d', 'buyer', 'Hi, I saw your listing on PuneNest. Is it available?', '[]', true, '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.messages (id, conversation_id, author_id, author_role, body, attachments, read, created_at) VALUES ('800921a2-b927-53ec-85f9-94e131fa074a', '0c9cdc1b-0793-56b8-801e-831a15348a28', 'f619aa88-84ed-50ce-9a07-abb7712afa9d', 'owner', 'Yes it is. Would you like to schedule a visit?', '[]', true, '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.messages (id, conversation_id, author_id, author_role, body, attachments, read, created_at) VALUES ('5de5968d-26a9-5d96-bb5f-193687626891', '0c9cdc1b-0793-56b8-801e-831a15348a28', '24daef28-5a4d-58af-af85-ec1cdde8540d', 'buyer', 'Great — can I come this Saturday evening?', '[]', false, '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.messages (id, conversation_id, author_id, author_role, body, attachments, read, created_at) VALUES ('97382100-5d1d-5377-a96c-ddffb69e6c39', '0c9cdc1b-0793-56b8-801e-831a15348a28', 'f619aa88-84ed-50ce-9a07-abb7712afa9d', 'owner', 'Sure, evening works. See you then.', '[]', false, '2026-07-29 22:33:54.213947+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.messages (id, conversation_id, author_id, author_role, body, attachments, read, created_at) VALUES ('76b233d4-c176-5ddb-a94f-11699295e869', 'fdff056a-eb12-5caa-a37d-220a639bf365', '65e66346-62d0-525f-be12-81d3f1868f06', 'buyer', 'Hi, I saw your listing on PuneNest. Is it available?', '[]', true, '2026-07-29 22:33:54.213947+05:30')
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


-- ============================================================================================
-- NAMED FIXTURE CONTRACT  (added 2026-08-12, migration Phase 1)
-- ============================================================================================
-- Everything above this line is a `pg_dump` of the original dev database: bulk demo content whose
-- individual rows nobody chose. Everything below is the opposite — a small set of rows that exist
-- *because a test asserts against them*, with the invariant each one guarantees written down in
-- `docs/system/fixture-registry.md`. Do not delete a row here without deleting its registry entry
-- and the assertions that depend on it.
--
-- WHY THESE ROWS ARE HAND-WRITTEN RATHER THAN DUMPED
-- --------------------------------------------------
-- The obvious shortcut was to `pg_dump` the deals, tickets, tenancies and reviews that had
-- accumulated in the local dev database and fold them in the same way the block above was made.
-- That was measured on 2026-08-12 and rejected: of 50 properties in that database only 38 came
-- from this file, of 172 users only 78 did, and **all 11 deals hung off the 12 drifted
-- properties**, not off the seeded ones. The transactional rows were a self-contained island
-- built by manual clicking on locally created listings, so importing them would have dragged in
-- 94 unnamed users and 12 unnamed listings to satisfy the foreign keys — bulk again, and this
-- time bulk that no test could name. The registry rows below instead attach to listings that were
-- already in this file, so the fixture set stays closed over itself.
--
-- UUID CONVENTION — every id below starts `f1c7` (fixture), so `grep f1c7` finds the whole
-- contract, and no generated uuid5 from the dump above can collide with one.
--
-- TIMESTAMPS ARE FIXED, NEVER `now()`. A relative date makes an assertion pass in August and fail
-- in September. Where a row's meaning is temporal (a rent instalment that is still owed) the
-- meaning is carried by an explicit `status` column, not by comparing its date to today.
--
-- The three actors added here carry `password_hash = NULL` like every other user in this file:
-- they are reachable only through the dev OTP flow, and nothing here is a credential.

-- --- Actors -------------------------------------------------------------------------------
-- The owner side of the contract is NOT created here: it is Meera Deshpande
-- (3ad0171b-3206-53e2-b6dc-732bf4e1b44c, mobile 9470744469), already seeded above with 4 listings
-- of which 3 are approved. `e2e/tests/live-property-integration.spec.js` already pins that pair of
-- numbers, so the rest of the contract is built to hang off her rather than to duplicate her.
INSERT INTO public.users (id, name, mobile, role, status, city, mobile_verified, verified, joined_at, created_at, updated_at) VALUES ('f1c70000-0000-4000-8000-000000000001', 'Rahul Mehta', '9700000001', 'buyer', 'active', 'Pune', true, true, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, role, status, city, mobile_verified, verified, joined_at, created_at, updated_at) VALUES ('f1c70000-0000-4000-8000-000000000002', 'Priya Nair', '9700000002', 'buyer', 'active', 'Pune', true, true, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.users (id, name, mobile, role, status, city, mobile_verified, verified, joined_at, created_at, updated_at) VALUES ('f1c70000-0000-4000-8000-000000000003', 'Arjun Rao', '9700000003', 'buyer', 'active', 'Pune', true, false, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30')
    ON CONFLICT DO NOTHING;

-- --- saved / savedSearch: Rahul has 3 saved listings and 1 listings alert -----------------
-- All three saved listings are `approved`, so the count survives the public-visibility filter; a
-- spec asserting a count would otherwise break the day someone flags one of them.
--
-- The Saved page tabs by deal, so the split matters as much as the total: p5021 and p5023 are both
-- `buy` and p5034 is `rent`. Two on one tab is the minimum that can express "removing this card
-- left the other one alone", which is the whole subject of the swipe-and-undo spec — with one card
-- per tab the undo window has nothing to be measured against and the spec quietly stops asserting
-- what its name says.
INSERT INTO public.saved_properties (user_id, property_id, created_at) VALUES ('f1c70000-0000-4000-8000-000000000001', '615287b3-7a3b-530f-84aa-773753e8682b', '2026-08-02 10:00:00+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.saved_properties (user_id, property_id, created_at) VALUES ('f1c70000-0000-4000-8000-000000000001', '291e5cb6-b46b-5f83-aae4-a1c5e27761bf', '2026-08-02 10:05:00+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.saved_properties (user_id, property_id, created_at) VALUES ('f1c70000-0000-4000-8000-000000000001', '8c6141a4-9acf-5d2b-8cb7-7795f9aa70c7', '2026-08-02 10:07:00+05:30')
    ON CONFLICT DO NOTHING;
-- `kind='listings'` REQUIRES a non-null `query` (there is a CHECK enforcing exactly that against
-- the flatmates variant, which requires `criteria` instead). `new_count = 0` so the alert badge
-- starts clean and a spec can assert it becoming non-zero.
INSERT INTO public.saved_searches (id, user_id, name, query, filters, alert_frequency, channel, new_count, kind, label, created_at, updated_at) VALUES ('f1c70001-0000-4000-8000-000000000001', 'f1c70000-0000-4000-8000-000000000001', '2 BHK in Kharadi', 'deal=buy&type=flat&bhk=2&locality=kharadi', '{"bhk": [2], "deal": "buy", "locality": ["kharadi"]}', 'daily', 'whatsapp', 0, 'listings', '2 BHK in Kharadi', '2026-08-02 10:10:00+05:30', '2026-08-02 10:10:00+05:30')
    ON CONFLICT DO NOTHING;

-- --- notification: Rahul has 2 notifications, exactly 1 of them unread --------------------
INSERT INTO public.notifications (id, user_id, type, title, body, read, link, created_at) VALUES ('f1c70002-0000-4000-8000-000000000001', 'f1c70000-0000-4000-8000-000000000001', 'saved.search.match', 'A new 2 BHK matches your Kharadi alert', 'One new listing matched "2 BHK in Kharadi" since you last looked.', false, '/listings?deal=buy&locality=kharadi', '2026-08-03 09:00:00+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.notifications (id, user_id, type, title, body, read, link, created_at) VALUES ('f1c70002-0000-4000-8000-000000000002', 'f1c70000-0000-4000-8000-000000000001', 'contact.request.approved', 'Meera Deshpande shared her number', 'Your contact request on p5021 was approved.', true, '/property/615287b3-7a3b-530f-84aa-773753e8682b', '2026-08-03 11:00:00+05:30')
    ON CONFLICT DO NOTHING;

-- --- review: one published property review, written by Rahul after a visit ----------------
-- `target_id` is text-typed but holds the property UUID (matching the rows already in the dev
-- database); `context='visit'` and `status='published'` are both CHECK-constrained vocabularies.
INSERT INTO public.reviews (id, target_type, target_id, author_id, rating, title, body, status, context, categories, recommend, created_at, updated_at) VALUES ('f1c70003-0000-4000-8000-000000000001', 'property', '615287b3-7a3b-530f-84aa-773753e8682b', 'f1c70000-0000-4000-8000-000000000001', 4, 'Well kept, honest listing', 'Photos matched the flat. Society is quiet and the owner was upfront about the maintenance dues.', 'published', 'visit', '{"accuracy": 5, "locality": 4, "condition": 4}', true, '2026-08-04 18:00:00+05:30', '2026-08-04 18:00:00+05:30')
    ON CONFLICT DO NOTHING;

-- --- report: a moderation queue with all three tabs, all four statuses, and one escalation ----
-- Deliberately targets p5002 (51897b51…), the one Meera listing seeded as `flagged`, so the
-- moderation queue and the listing's own status tell the same story instead of contradicting.
--
-- WHY SEVEN ROWS AND NOT ONE. The queue has three tabs, a four-value status filter, a per-tab reason
-- filter and a repeat-offender badge, and one open property report exercises none of them: two tabs
-- read empty, three of four statuses never render a badge, and the "Closed" KPI is
-- permanently 0. A spec asserting against that set can only check that hardcoded chrome exists.
--
-- The shape is chosen, not arbitrary:
--   * THREE reports on 51897b51 — one short of nothing, one *over* the threshold. The queue shows a
--     "3x" escalation badge at `repeatCount >= 3` (AdminReports.jsx), which is the signal that a
--     listing is being complained about repeatedly rather than once. Two rows would leave that
--     badge unrendered and unassertable; three is the smallest set that proves it fires.
--   * ALL FOUR STATUSES across the set — open (…01, …04), reviewing (…02), dismissed (…03),
--     actioned (…05). `reviewing` and the two terminal states are otherwise unreachable in a read
--     fixture, because nothing in the suite triages a seeded report.
--   * ALL THREE TABS non-empty. `TARGET_TO_KIND` maps `property → listing`, `user → user` and
--     `post → share`, and the queue filters rows by exactly that, so each tab needs a row of its
--     own target type and cannot be faked with another. The two `post` rows (…06, …07) are the
--     fixture for the flatmates tab — that target type has been on the wire far longer than the
--     queue has had a tab to show it, so reports filed from Flatmates.jsx were landing correctly
--     and rendering nowhere. `filled` is chosen deliberately: it is legal for a post and for
--     nothing else, so it proves the reason filter is scoped to the tab rather than offering the
--     union of all three vocabularies.
--
-- REASONS ARE PER TARGET TYPE and these are checked against `ReportReasons`: `pricing` and `broker`
-- are legal complaints about a property, `brokerage` and `abuse` about a person, and they are not
-- interchangeable — the server validates the reason *against* the target type, so a plausible-
-- looking cross-pairing here would seed a row the API itself would have rejected with a 400.
--
-- NO ROW HERE COLLIDES WITH THE DUPLICATE GUARD. `idx_reports_one_open_per_reporter` is unique on
-- (reporter_id, target_type, target_id) but PARTIAL on `status IN ('open','reviewing')`. The three
-- property rows use three different reporters; the two user rows use two different reporters; and
-- the terminal rows fall outside the index entirely. Reusing a reporter on a live row would fail
-- the insert silently, because every statement here is `ON CONFLICT DO NOTHING`.
--
-- THE REPORTED USER IS RAHUL MEHTA, who is a *target* here and nothing else. No spec triages these
-- rows — the queue's "Suspend" button carries `enforcement='suspend_account'`, which archives the
-- account for the remainder of the run, so a spec that wants to exercise enforcement must create
-- its own report against its own throwaway actor rather than reach for one of these.
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
-- The two post rows target real flatmate supply seeded below — the Wakad shared room
-- (f1c7000b…02) and the Kharadi group (f1c7000d…01) — rather than an invented id, so a moderator
-- following the target from the queue lands on something that exists. `reports.target_id` is plain
-- text with no FK precisely because it spans four tables, which means nothing but care keeps these
-- pointing at real rows.
INSERT INTO public.reports (id, target_type, target_id, reporter_id, reason, details, status, created_at, updated_at) VALUES ('f1c70004-0000-4000-8000-000000000006', 'post', 'f1c7000b-0000-4000-8000-000000000002', 'f1c70000-0000-4000-8000-000000000002', 'filled', 'Seat was taken weeks ago — host confirmed on call but the post is still up.', 'open', '2026-08-06 15:10:00+05:30', '2026-08-06 15:10:00+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.reports (id, target_type, target_id, reporter_id, reason, details, status, created_at, updated_at) VALUES ('f1c70004-0000-4000-8000-000000000007', 'post', 'f1c7000d-0000-4000-8000-000000000001', 'f1c70000-0000-4000-8000-000000000003', 'broker', 'Listed as a tenant looking for flatmates, but he is charging a finder fee per seat.', 'reviewing', '2026-08-06 16:40:00+05:30', '2026-08-06 16:40:00+05:30')
    ON CONFLICT DO NOTHING;

-- --- support: Priya has 1 open ticket carrying 2 messages (hers, then a staff reply) -------
-- `author_role` does NOT have its own vocabulary — it reuses the `users.role` CHECK
-- (buyer | owner | staff | admin), so the tenant's message is authored as `buyer`, not `user`.
INSERT INTO public.support_tickets (id, user_id, subject, category, status, unread, staff_unread, created_at, updated_at) VALUES ('f1c70005-0000-4000-8000-000000000001', 'f1c70000-0000-4000-8000-000000000002', 'Rent receipt for July is missing', 'rent', 'open', false, true, '2026-08-05 09:30:00+05:30', '2026-08-05 09:45:00+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.support_ticket_messages (id, ticket_id, author_id, author_role, body, created_at) VALUES ('f1c70005-1000-4000-8000-000000000001', 'f1c70005-0000-4000-8000-000000000001', 'f1c70000-0000-4000-8000-000000000002', 'buyer', 'I paid July rent on the 3rd but the receipt never arrived by WhatsApp.', '2026-08-05 09:30:00+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.support_ticket_messages (id, ticket_id, author_id, author_role, body, created_at) VALUES ('f1c70005-1000-4000-8000-000000000002', 'f1c70005-0000-4000-8000-000000000001', NULL, 'staff', 'Thanks for flagging — we can see the payment and are re-sending the receipt now.', '2026-08-05 09:45:00+05:30')
    ON CONFLICT DO NOTHING;

-- --- deal: one active buy deal on p5021, with a counterparty and a pending offer -----------
-- `deals` has no owner column — the owner is derived from `property_id`, which is why the deal
-- must sit on a listing this file already gave Meera.
INSERT INTO public.deals (id, property_id, deal, counterparty_id, counterparty_mobile, agreed_price, status, note, created_at, updated_at) VALUES ('f1c70006-0000-4000-8000-000000000001', '615287b3-7a3b-530f-84aa-773753e8682b', 'buy', 'f1c70000-0000-4000-8000-000000000001', '9700000001', 8900000, 'active', 'Buyer has arranged a home loan; awaiting sanction letter.', '2026-08-06 10:00:00+05:30', '2026-08-06 10:00:00+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.deal_parties (id, deal_id, name, mobile, note, created_at, updated_at) VALUES ('f1c70006-1000-4000-8000-000000000001', 'f1c70006-0000-4000-8000-000000000001', 'Rahul Mehta', '9700000001', 'Primary buyer', '2026-08-06 10:00:00+05:30', '2026-08-06 10:00:00+05:30')
    ON CONFLICT DO NOTHING;
-- Left `pending` on purpose: an accept/decline spec needs an offer it is allowed to transition.
INSERT INTO public.offers (id, property_id, from_user_id, amount, status, message, move_in, created_at, updated_at) VALUES ('f1c70007-0000-4000-8000-000000000001', '615287b3-7a3b-530f-84aa-773753e8682b', 'f1c70000-0000-4000-8000-000000000001', 8900000, 'pending', 'Can close in 45 days if the society NOC is ready.', '2026-10-01', '2026-08-06 10:05:00+05:30', '2026-08-06 10:05:00+05:30')
    ON CONFLICT DO NOTHING;

-- --- messaging: one thread between the two *named* actors, on one of Meera's own listings --
--
-- The four threads seeded further up are between generated users who carry no other fixtures, so
-- before this row existed neither Rahul nor Meera nor Priya could open a chat at all -- which meant
-- the whole messaging surface (the composer, the mobile full-screen rule, the unread count, the
-- `?c=` deep link) was unreachable from any spec that signs in as an actor, and therefore untested
-- rather than merely untried. Rahul is the demand side and Meera owns the anchor listings, so
-- buyer-enquires-on-owner's-flat is also the shape the product actually produces.
--
-- It lives down here, among the named-actor fixtures, rather than beside the other conversations:
-- the generated users exist by the time that block runs but Rahul and Meera do not, and the
-- foreign key says so.
--
-- `conversations_pair_ordered` requires user_a_id < user_b_id, so Meera is the "a" side here
-- despite being the owner: the column pair is a set, not a role assignment.
INSERT INTO public.conversations (id, user_a_id, user_b_id, property_id, last_message, created_at, updated_at) VALUES ('f1c70006-0000-4000-8000-000000000001', '3ad0171b-3206-53e2-b6dc-732bf4e1b44c', 'f1c70000-0000-4000-8000-000000000001', '615287b3-7a3b-530f-84aa-773753e8682b', 'Thursday after six suits me. I will share the gate code.', '2026-08-06 10:00:00+05:30', '2026-08-06 10:20:00+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.messages (id, conversation_id, author_id, author_role, body, attachments, read, created_at) VALUES ('f1c70007-0000-4000-8000-000000000001', 'f1c70006-0000-4000-8000-000000000001', 'f1c70000-0000-4000-8000-000000000001', 'buyer', 'Hello, is the Baner flat still available for a Thursday viewing?', '[]', true, '2026-08-06 10:00:00+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.messages (id, conversation_id, author_id, author_role, body, attachments, read, created_at) VALUES ('f1c70007-0000-4000-8000-000000000002', 'f1c70006-0000-4000-8000-000000000001', '3ad0171b-3206-53e2-b6dc-732bf4e1b44c', 'owner', 'It is. Thursday after six suits me. I will share the gate code.', '[]', false, '2026-08-06 10:20:00+05:30')
    ON CONFLICT DO NOTHING;

-- --- rent: Priya is the active tenant of p5015, with a 3-instalment ledger ----------------
-- Rent and deposit mirror the listing's own seeded price (38000), so the tenancy does not
-- contradict the listing it belongs to.
INSERT INTO public.tenancies (id, property_id, tenant_id, owner_id, rent, deposit, start_date, end_date, status, created_at, updated_at) VALUES ('f1c70008-0000-4000-8000-000000000001', '1078d711-d3eb-5961-ab3c-30d4bdc5f377', 'f1c70000-0000-4000-8000-000000000002', '3ad0171b-3206-53e2-b6dc-732bf4e1b44c', 38000, 76000, '2026-06-01', '2027-05-31', 'active', '2026-05-25 10:00:00+05:30', '2026-05-25 10:00:00+05:30')
    ON CONFLICT DO NOTHING;
-- Two settled instalments and one still owed. The "still owed" one is `status='due'` rather than a
-- future `due_date`, so the ledger reads the same way in any month it is loaded.
INSERT INTO public.rent_payments (id, tenancy_id, amount, platform_fee, gst, due_date, paid_date, status, method, reference, created_at, updated_at) VALUES ('f1c70009-0000-4000-8000-000000000001', 'f1c70008-0000-4000-8000-000000000001', 38000, 380, 68, '2026-06-05', '2026-06-03', 'paid', 'upi', 'PN-RENT-202606-0001', '2026-06-01 08:00:00+05:30', '2026-06-03 09:12:00+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.rent_payments (id, tenancy_id, amount, platform_fee, gst, due_date, paid_date, status, method, reference, created_at, updated_at) VALUES ('f1c70009-0000-4000-8000-000000000002', 'f1c70008-0000-4000-8000-000000000001', 38000, 380, 68, '2026-07-05', '2026-07-03', 'paid', 'upi', 'PN-RENT-202607-0001', '2026-07-01 08:00:00+05:30', '2026-07-03 08:41:00+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.rent_payments (id, tenancy_id, amount, platform_fee, gst, due_date, paid_date, status, method, reference, created_at, updated_at) VALUES ('f1c70009-0000-4000-8000-000000000003', 'f1c70008-0000-4000-8000-000000000001', 38000, 380, 68, '2026-08-05', NULL, 'due', NULL, NULL, '2026-08-01 08:00:00+05:30', '2026-08-01 08:00:00+05:30')
    ON CONFLICT DO NOTHING;

-- --- visit: Omkar has exactly one LIVE visit, so the dashboard offers Reschedule -----------
-- The actor is Omkar Kulkarni (f619aa88…, mobile 9708919481) rather than one of the three added
-- above: `live-property-integration.spec.js` already browses the consumer dashboard as him, and a
-- second seeker there would be a second identity to sign in as for no gain — the OTP send budget
-- is the scarce resource in that file, not the row count.
--
-- WHY THIS ROW EXISTS. `VisitsTab` offers Reschedule only on a `scheduled` or `confirmed` visit
-- (`upcoming` filters on status alone), and the five dumped visits above all belong to other
-- users. So the control had no subject and the live spec's reschedule assertion failed as "element
-- not found", which reads as a missing button rather than a missing fixture. It could not be left
-- to the spec's own `seedPropertyReview` either: that helper *completes* the visit it books, in
-- order to mint reviewer standing, so the one visit Omkar had by the time the dashboard loaded was
-- always terminal.
--
-- ON A DIFFERENT LISTING TO THAT HELPER, DELIBERATELY. `seedPropertyReview` scopes its search to
-- p5015 and `VisitService.schedule` answers 409 to a second live visit on the same property, so
-- putting this one on p5034 keeps the two fixtures from colliding in either direction.
--
-- The slot is fixed and in the past like every other timestamp in this block. That is not a
-- contradiction of "live": the status column carries the meaning, and `VisitService` allows past
-- slots at both create and reschedule time (see its class Javadoc — an owner logging a visit that
-- already happened is the ordinary case).
INSERT INTO public.visits (id, property_id, visitor_id, slot, mode, status, note, created_at, updated_at) VALUES ('f1c7000a-0000-4000-8000-000000000001', '291e5cb6-b46b-5f83-aae4-a1c5e27761bf', 'f619aa88-84ed-50ce-9a07-abb7712afa9d', '2026-08-08 11:00:00+05:30', 'in-person', 'scheduled', 'Weekend morning suits me best.', '2026-08-05 10:00:00+05:30', '2026-08-05 10:00:00+05:30')
    ON CONFLICT DO NOTHING;

-- --- flatmates: a board with something on it, on the public side of moderation ---------------
-- WHY THIS BLOCK EXISTS. The bulk dump above contains no flatmate rows at all, and V41 (D72) made
-- every seeker post, room and group start at `mod_status='pending'` — visible to its author and to
-- nobody else. So `/flatmates` loaded, rendered its three tabs, called all three feed endpoints and
-- showed zero cards, which is exactly the failure the live spec's "the board is not empty"
-- assertion exists to catch: every provenance check passes on an empty board.
--
-- `mod_status='approved'` rather than `'live'`. Both are public (`FlatmateVocabulary.isPublic`),
-- but `approved` is the one a moderator can actually produce — `live` is the pre-D72 value that
-- only exists for rows that predate the queue. Seeding the state the system can still reach keeps
-- the fixture honest about the workflow rather than grandfathering itself past it.
--
-- Every facet is left at its column default (`gender='any'`, `food='any'`, `policy='any'`) so these
-- rows match any filter search. That is deliberate: the filter test asserts "every row returned by
-- a `female` search is `female` or `any`", and a seed row with a concrete gender would make the
-- board's contents rather than the query decide whether it passes.
INSERT INTO public.flatmate_rooms (id, host_id, room_type, budget, locality, localities, bhk, furnishing, attached_bath, host_role, note, mod_status, created_at, updated_at) VALUES ('f1c7000b-0000-4000-8000-000000000001', '3ad0171b-3206-53e2-b6dc-732bf4e1b44c', 'Private room', 16000, 'Baner', '["Baner"]'::jsonb, '2', 'semi', 'attached', 'owner', 'Quiet corner room, balcony faces the garden.', 'approved', '2026-08-06 09:00:00+05:30', '2026-08-06 09:00:00+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.flatmate_rooms (id, host_id, room_type, budget, locality, localities, bhk, furnishing, attached_bath, host_role, note, mod_status, created_at, updated_at) VALUES ('f1c7000b-0000-4000-8000-000000000002', 'f619aa88-84ed-50ce-9a07-abb7712afa9d', 'Shared room', 9500, 'Wakad', '["Wakad"]'::jsonb, '3', 'furnished', 'shared', 'tenant', 'Sharing with two working professionals.', 'approved', '2026-08-06 09:05:00+05:30', '2026-08-06 09:05:00+05:30')
    ON CONFLICT DO NOTHING;

INSERT INTO public.flatmate_seeker_posts (id, user_id, name, budget, localities, note, mod_status, created_at, updated_at) VALUES ('f1c7000c-0000-4000-8000-000000000001', 'f1c70000-0000-4000-8000-000000000001', 'Rahul Mehta', 15000, '["Baner","Aundh"]'::jsonb, 'Moving for work, looking for a private room near the Hinjewadi line.', 'approved', '2026-08-06 09:10:00+05:30', '2026-08-06 09:10:00+05:30')
    ON CONFLICT DO NOTHING;
INSERT INTO public.flatmate_seeker_posts (id, user_id, name, budget, localities, note, mod_status, created_at, updated_at) VALUES ('f1c7000c-0000-4000-8000-000000000002', 'f1c70000-0000-4000-8000-000000000002', 'Priya Nair', 12000, '["Kharadi"]'::jsonb, 'Happy either way on private or shared.', 'approved', '2026-08-06 09:15:00+05:30', '2026-08-06 09:15:00+05:30')
    ON CONFLICT DO NOTHING;
-- One *verified* seeker post, because without it the demo and e2e databases render the
-- flatmates feed with the VERIFIED pill nowhere on screen -- and that pill is the surface's
-- only safety signal, the thing that says we checked the identity of the stranger someone is
-- deciding whether to live with. It cannot be reached by flipping a column: the service sets
-- `verified` from `caller.aadhaarVerified()` on create, and neither Rahul nor Priya is
-- Aadhaar-verified. Meera is, so the post is hers -- which also keeps this row a state the
-- create path could actually produce, rather than one only an INSERT can reach.
INSERT INTO public.flatmate_seeker_posts (id, user_id, name, budget, localities, note, verified, mod_status, created_at, updated_at) VALUES ('f1c7000c-0000-4000-8000-000000000003', '3ad0171b-3206-53e2-b6dc-732bf4e1b44c', 'Meera Deshpande', 22000, '["Baner","Balewadi"]'::jsonb, 'Letting out a room in my own flat while I am posted out of the city for a year.', true, 'approved', '2026-08-06 09:20:00+05:30', '2026-08-06 09:20:00+05:30')
    ON CONFLICT DO NOTHING;

INSERT INTO public.flatmate_groups (id, host_id, title, locality, rent, seats_total, seats_open, host_role, note, mod_status, created_at, updated_at) VALUES ('f1c7000d-0000-4000-8000-000000000001', 'f619aa88-84ed-50ce-9a07-abb7712afa9d', 'Two seats in a 3 BHK, Kharadi', 'Kharadi', 42000, 3, 1, 'tenant', 'Lease starts next month, split three ways.', 'approved', '2026-08-06 09:20:00+05:30', '2026-08-06 09:20:00+05:30')
    ON CONFLICT DO NOTHING;

-- --- derived: owner_verified must agree with the owner's badge (D95) -------------------------
-- WHY THIS EXISTS. `properties.owner_verified` is denormalised from `users.aadhaar_verified` —
-- buyers read it on the listing card and the ranking treats it as a trust signal, so it is stored
-- on the row rather than joined at read time. The bulk dump above predates the writer that keeps
-- the two in step (`VerificationService.handleWebhook` back-fills, `ListingService.create` stamps
-- new listings), and it inherited the mock catalogue's randomised values. The result was a seed
-- that contradicted itself in both directions: Omkar Kulkarni is `aadhaar_verified = false` and
-- all three of his listings badged him as verified, while Meera Deshpande is verified and p5015
-- said she was not.
--
-- That is worse than untidy. The first case is a fixture that tells buyers an unverified owner is
-- trustworthy — the exact claim the badge exists to make — and any spec asserting the badge
-- renders would have been asserting a lie. The second would make a correct implementation look
-- broken.
--
-- Derived rather than 38 hand-edited literals: the dump is generated, so a literal would be lost
-- the next time it is regenerated, and a rule cannot drift from the invariant it encodes. This is
-- also the only statement here that has to run *after* both tables are populated, which the
-- file's position (see the `zz_` note at the top) already guarantees.
UPDATE public.properties p
   SET owner_verified = u.aadhaar_verified
  FROM public.users u
 WHERE u.id = p.owner_id
   AND p.owner_verified IS DISTINCT FROM u.aadhaar_verified;


-- ============================================================================================
-- EDITORIAL CONTENT — the FAQ set the help surfaces read.
-- ============================================================================================
--
-- `GET /faqs` is public and has existed since slice 8, and until now it answered `[]` on every
-- environment, because `faqs` is created by V8 and populated by nothing. That is not a table
-- waiting for content: the content exists and always has, as nine objects inside the browser's own
-- `db.json`, which is where Support and the assistant widget read them from. So the endpoint was
-- shipped, correct, and empty, while the copy it was built to serve sat in the bundle.
--
-- These are those nine rows, moved rather than written. Nothing here is new copy — every question
-- and answer is the string the mock has been rendering, so a visitor sees the same help before and
-- after the seam is rewired, which is the only way to tell a migration from a rewrite.
--
-- WHY dev/e2e AND NOT REFERENCE DATA
-- ----------------------------------
-- `R__seed_reference_data.sql` runs for every profile including prod, and putting help copy there
-- would decide what the live site tells its customers — a product call, not a migration step. It
-- would also be a strange place to leave it: FAQs are meant to be edited by whoever answers
-- support tickets, and there is no admin write path for `faqs` yet (AdminContent still calls the
-- mock's `mutateDb`). Until that exists, promoting this copy to reference data would freeze it into
-- a migration nobody can edit without a deploy.
--
-- So it lands here, where it makes the endpoint answer honestly on a developer's machine and gives
-- the live suite something real to assert against, and production keeps answering `[]` until
-- somebody decides what it should say. Recorded in `tasks/todo.md`.
--
-- Ids are hard-coded so the set is stable across rebuilds and a spec can name one. `ON CONFLICT DO
-- NOTHING` for the reason stated at the top of this file.
INSERT INTO public.faqs (id, question, answer, category) VALUES
  ('fa900001-0000-4000-8000-00000000f001',
   'Is PuneNest really zero brokerage?',
   'Yes — always. You connect directly with verified owners and pay zero brokerage on any rent or resale deal. We earn only from optional owner plans and add-on services like rent agreements, never a cut of your rent or deposit.',
   'General'),
  ('fa900001-0000-4000-8000-00000000f002',
   'How are owners and listings verified?',
   'Every owner''s identity is checked against Aadhaar, and wherever possible we confirm ownership documents before a listing goes live. Verified listings carry a badge. If something looks off, use ''Report listing'' and our trust team reviews it within 24 hours.',
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
   'Pay a deposit or rent only after you''ve visited the property and signed an agreement. PuneNest never asks you to transfer a token to ''block'' a flat before a visit — treat any such request as a red flag and report it.',
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

-- Marathi for two of the nine (D2).
--
-- Two, not nine, and deliberately: the point of a nested `translations` object is that a row can be
-- partly translated, and a seed where everything is translated cannot demonstrate the fallback that
-- the help page depends on. f001 is translated in full; f002 has a Marathi question and no Marathi
-- answer, which is the awkward state a real editorial workflow spends most of its time in -- somebody
-- translated the headline and has not got to the body yet. The client falls back per field, so that
-- row renders a Marathi question above an English answer rather than disappearing.
--
-- The remaining seven carry `{}`. That is the third case worth having in the fixture: a row with no
-- translations at all must still render, in every language.
--
-- Written as an UPDATE rather than folded into the INSERT above because the INSERT is `ON CONFLICT
-- DO NOTHING` -- on any database that already has these nine rows, adding a column to the VALUES
-- list would change nothing at all, and the seed would appear to work while doing nothing.
UPDATE public.faqs SET translations = '{"mr": {"question": "पुणेनेस्ट खरंच शून्य दलाली आहे का?", "answer": "होय — नेहमीच. तुम्ही थेट पडताळणी केलेल्या मालकांशी संपर्क साधता आणि कोणत्याही भाडे किंवा पुनर्विक्री व्यवहारावर शून्य दलाली भरता.", "category": "सर्वसाधारण"}}'::jsonb
 WHERE id = 'fa900001-0000-4000-8000-00000000f001';

UPDATE public.faqs SET translations = '{"mr": {"question": "मालक आणि जाहिराती कशा पडताळल्या जातात?"}}'::jsonb
 WHERE id = 'fa900001-0000-4000-8000-00000000f002';

-- D19: give the demo listings a real society, because "none of them have one" was
-- indistinguishable from "the feature does not work".
--
-- Every one of the 38 rows above passes NULL in the society_id position, so until now the only
-- listings in the whole dataset that could answer "which building is this?" were ones somebody had
-- posted by hand through the wizard. The client filled the silence itself: societyForListing()
-- picked a society with fnvHash(listing.id) % pool.length and the property page printed that
-- building's builder, tower count, unit count, year and occupancy as if they described this home.
-- Every figure on that panel is a checkable claim about a named third party, and it was wrong for
-- all but one listing in twenty-eight by construction.
--
-- Deterministic and locality-respecting: within each locality the listings are dealt round-robin
-- across the societies that are actually in that locality, so a Baner listing lands in a Baner
-- building and several societies end up with homes rather than one hoarding them all. Idempotent
-- via the `society_id IS NULL` guard, which matters because a repeatable migration re-runs whenever
-- its checksum changes, and because a listing bound by hand through the wizard must not be
-- reassigned by the seed.
--
-- Flats, studios and penthouses only. Villas, row houses and plots stay unbound on purpose: the
-- unbound path is the one that has never been exercised, and the whole point of this change is that
-- a listing with no society renders no society section at all rather than a borrowed one.
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

-- D27 — the hand-back axis has its own column since V92, so the two concierge rows that had got
-- past the paperwork carry a milestone as well as a stage. Written as an UPDATE rather than two
-- more values in the INSERT column list, which every one of the 38 property rows shares and only
-- these two would use. Their `pipeline_stage` is `docs_submitted` above: a hand-back cannot start
-- before the paperwork is in, and the database enforces that.
UPDATE public.properties SET handback_milestone = 'photos_uploaded' WHERE slug = 'p5024';
UPDATE public.properties SET handback_milestone = 'claim_sent'      WHERE slug = 'p5037';

-- ============================================================================================
-- COMMERCIAL STOCK  (added 2026-08-18)
-- ============================================================================================
-- The 38 listings above are entirely residential - Flat, Studio, Penthouse, Row House, Villa and
-- Plot, and nothing else. The mock provider has 14 commercial listings, so `/listings?type=
-- commercial` is a populated page against the mock and a blank one against the API, and the whole
-- "Commercial Type" sub-filter had no data underneath it at all.
--
-- WHY THIS COST MORE THAN IT LOOKS
-- --------------------------------
-- A converted spec that reads a table the seed never filled does not fail with "there is no
-- commercial stock". It fails with `locator.waitFor: Timeout`, which reads as a broken selector or
-- a product regression. On 2026-08-18 a 20-spec conversion probe failed 19 of 92 tests and 10 of
-- those 19 were this one absence, wearing 10 different disguises. So this is not "nice to have
-- fixtures" - it is the difference between converting a spec in minutes and debugging a phantom
-- product bug for an afternoon. `e2e/scripts/check-seed-coverage.mjs` now guards the general case.
--
-- WHY NEW LISTINGS RATHER THAN RE-TYPING EXISTING ONES
-- ---------------------------------------------------
-- The contract block above deliberately hangs its rows off listings that were already here, to
-- keep the fixture set closed over itself. That is not available here: flipping six of the 38 to
-- 'Office Space' would silently move stock out of the residential counts that
-- `live-trust-counters`, `live-saved-search-match-count` and the locality specs read, to fix a
-- different page. Adding is additive - every existing count still means what it meant.
--
-- SHAPE
-- -----
-- Twelve rows: each of the six subtypes in `COMMERCIAL_SUBTYPES` (frontend/src/data/
-- propertyTypes.js), once to buy and once to rent, in twelve different localities so no two titles
-- collide. `tests/consumer/search/commercial-type-filter.spec.js` asserts that filtering to a
-- subtype leaves NO card without that subtype's label in it, so the label has to be in the title
-- verbatim and no other row may repeat it - hence one row per (subtype, deal) and not two.
--
-- `bhk` is NULL, not 0: an office does not have a bedroom count, and the mock agrees (`"bhk": ""`).
-- Note the Plot rows dumped above DO carry a bhk - that is a dump artefact from a wizard that
-- always asked, not a shape to copy. Images and floor plans are the ones the mock uses for the
-- same subtype, so a listing looks the same whichever provider served it.
--
-- One owner for all twelve, `f1c7...0010`. Both the trust counters this feeds stay strict:
-- verifiedOwners gains 1 while owner-verified listings gain 12.
INSERT INTO public.users (id, name, mobile, role, status, city, mobile_verified, verified, aadhaar_verified, listings_count, joined_at, created_at, updated_at) VALUES ('f1c70000-0000-4000-8000-000000000010', 'Sanjay Pathak', '9700000010', 'owner', 'active', 'Pune', true, true, true, 12, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30')
    ON CONFLICT DO NOTHING;

-- Buy: one unit of each subtype.
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, price, price_unit, negotiable, area, area_unit, carpet_area, furnishing, total_floors, possession, locality, locality_slug, city, lat, lng, description, amenities, images, cover_image, floor_plan, posted_by_type, status, verified, owner_verified, ownership_verified, docs_count, views, enquiries, created_at, updated_at) VALUES
 ('f1c70000-0000-4000-8000-000000005101', 'p5101', 'f1c70000-0000-4000-8000-000000000010', 'Office Space in Baner', 'buy', 'Office Space', 22500000, 'total', true, 1800, 'sqft', 1520, 'unfurnished', 7, 'ready-to-move', 'Baner', 'baner', 'Pune', 18.559, 73.776, 'Office Space available on sale in Baner, Pune. Zero brokerage - deal directly with the verified owner.', '["parking", "power", "lift", "security"]', '["https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=800&q=70', '/floorplans/office.svg', 'owner', 'approved', true, true, true, 3, 180, 4, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005102', 'p5102', 'f1c70000-0000-4000-8000-000000000010', 'Shop / Showroom in Kharadi', 'buy', 'Shop / Showroom', 9800000, 'total', true, 650, 'sqft', 590, 'unfurnished', 2, 'ready-to-move', 'Kharadi', 'kharadi', 'Pune', 18.551, 73.941, 'Shop / Showroom available on sale in Kharadi, Pune. Zero brokerage - deal directly with the verified owner.', '["parking", "power", "security"]', '["https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1604719312566-8912e9227c6a?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=800&q=70', '/floorplans/shop.svg', 'owner', 'approved', true, true, true, 2, 142, 6, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005103', 'p5103', 'f1c70000-0000-4000-8000-000000000010', 'Retail / Mall Unit in Kalyani Nagar', 'buy', 'Retail / Mall Unit', 18500000, 'total', false, 1200, 'sqft', 1040, 'semi-furnished', 4, 'ready-to-move', 'Kalyani Nagar', 'kalyani-nagar', 'Pune', 18.548, 73.902, 'Retail / Mall Unit available on sale in Kalyani Nagar, Pune. Zero brokerage - deal directly with the verified owner.', '["parking", "power", "lift", "security"]', '["https://images.unsplash.com/photo-1567521464027-f127ff144326?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1519567241046-7f570eee3ce6?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1567521464027-f127ff144326?auto=format&fit=crop&w=800&q=70', '/floorplans/retail.svg', 'owner', 'approved', true, true, true, 3, 96, 2, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005104', 'p5104', 'f1c70000-0000-4000-8000-000000000010', 'Warehouse / Godown in Hadapsar', 'buy', 'Warehouse / Godown', 42000000, 'total', true, 6000, 'sqft', 5800, 'unfurnished', 1, 'ready-to-move', 'Hadapsar', 'hadapsar', 'Pune', 18.5, 73.926, 'Warehouse / Godown available on sale in Hadapsar, Pune. Zero brokerage - deal directly with the verified owner.', '["parking", "power", "security"]', '["https://images.unsplash.com/photo-1553413077-190dd305871c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1553413077-190dd305871c?auto=format&fit=crop&w=800&q=70', '/floorplans/warehouse.svg', 'owner', 'approved', true, true, true, 4, 71, 1, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005105', 'p5105', 'f1c70000-0000-4000-8000-000000000010', 'Industrial / Factory in Pimpri', 'buy', 'Industrial / Factory', 68000000, 'total', true, 12000, 'sqft', 11400, 'unfurnished', 1, 'ready-to-move', 'Pimpri', 'pimpri', 'Pune', 18.627, 73.805, 'Industrial / Factory available on sale in Pimpri, Pune. Zero brokerage - deal directly with the verified owner.', '["parking", "power", "security"]', '["https://images.unsplash.com/photo-1581092160562-40aa08e78837?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1565891741441-64926e441838?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1581092160562-40aa08e78837?auto=format&fit=crop&w=800&q=70', '/floorplans/industrial.svg', 'owner', 'approved', true, true, true, 5, 58, 1, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005106', 'p5106', 'f1c70000-0000-4000-8000-000000000010', 'Co-working Space in Viman Nagar', 'buy', 'Co-working Space', 31000000, 'total', false, 2400, 'sqft', 2050, 'furnished', 6, 'ready-to-move', 'Viman Nagar', 'viman-nagar', 'Pune', 18.567, 73.915, 'Co-working Space available on sale in Viman Nagar, Pune. Zero brokerage - deal directly with the verified owner.', '["parking", "power", "lift", "security", "club"]', '["https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=800&q=70', '/floorplans/coworking.svg', 'owner', 'approved', true, true, true, 3, 214, 9, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30')
    ON CONFLICT DO NOTHING;

-- Rent: the same six subtypes again, in six different localities so no title repeats. `deposit` is
-- set here and left NULL on the buy rows above - a sale has no deposit, and a rental without one
-- would make the deposit line untestable.
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, price, price_unit, deposit, negotiable, area, area_unit, carpet_area, furnishing, total_floors, possession, locality, locality_slug, city, lat, lng, description, amenities, images, cover_image, floor_plan, posted_by_type, status, verified, owner_verified, ownership_verified, docs_count, views, enquiries, created_at, updated_at) VALUES
 ('f1c70000-0000-4000-8000-000000005107', 'p5107', 'f1c70000-0000-4000-8000-000000000010', 'Office Space in Wakad', 'rent', 'Office Space', 135000, 'per-month', 810000, true, 1500, 'sqft', 1280, 'semi-furnished', 5, 'ready-to-move', 'Wakad', 'wakad', 'Pune', 18.598, 73.762, 'Office Space available on rent in Wakad, Pune. Zero brokerage - deal directly with the verified owner.', '["parking", "power", "lift", "security"]', '["https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=800&q=70', '/floorplans/office.svg', 'owner', 'approved', true, true, true, 3, 163, 5, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005108', 'p5108', 'f1c70000-0000-4000-8000-000000000010', 'Shop / Showroom in Magarpatta', 'rent', 'Shop / Showroom', 95000, 'per-month', 570000, true, 700, 'sqft', 640, 'unfurnished', 2, 'ready-to-move', 'Magarpatta', 'magarpatta', 'Pune', 18.516, 73.928, 'Shop / Showroom available on rent in Magarpatta, Pune. Zero brokerage - deal directly with the verified owner.', '["parking", "power", "security"]', '["https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1604719312566-8912e9227c6a?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=800&q=70', '/floorplans/shop.svg', 'owner', 'approved', true, true, true, 2, 118, 3, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005109', 'p5109', 'f1c70000-0000-4000-8000-000000000010', 'Retail / Mall Unit in Koregaon Park', 'rent', 'Retail / Mall Unit', 175000, 'per-month', 1050000, false, 1100, 'sqft', 960, 'semi-furnished', 3, 'ready-to-move', 'Koregaon Park', 'koregaon-park', 'Pune', 18.536, 73.893, 'Retail / Mall Unit available on rent in Koregaon Park, Pune. Zero brokerage - deal directly with the verified owner.', '["parking", "power", "lift", "security"]', '["https://images.unsplash.com/photo-1567521464027-f127ff144326?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1519567241046-7f570eee3ce6?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1567521464027-f127ff144326?auto=format&fit=crop&w=800&q=70', '/floorplans/retail.svg', 'owner', 'approved', true, true, true, 3, 132, 4, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005110', 'p5110', 'f1c70000-0000-4000-8000-000000000010', 'Warehouse / Godown in Pimpri', 'rent', 'Warehouse / Godown', 220000, 'per-month', 1320000, true, 5500, 'sqft', 5300, 'unfurnished', 1, 'ready-to-move', 'Pimpri', 'pimpri', 'Pune', 18.627, 73.805, 'Warehouse / Godown available on rent in Pimpri, Pune. Zero brokerage - deal directly with the verified owner.', '["parking", "power", "security"]', '["https://images.unsplash.com/photo-1553413077-190dd305871c?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1553413077-190dd305871c?auto=format&fit=crop&w=800&q=70', '/floorplans/warehouse.svg', 'owner', 'approved', true, true, true, 4, 87, 2, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005111', 'p5111', 'f1c70000-0000-4000-8000-000000000010', 'Industrial / Factory in Hadapsar', 'rent', 'Industrial / Factory', 310000, 'per-month', 1860000, true, 9000, 'sqft', 8600, 'unfurnished', 1, 'ready-to-move', 'Hadapsar', 'hadapsar', 'Pune', 18.5, 73.926, 'Industrial / Factory available on rent in Hadapsar, Pune. Zero brokerage - deal directly with the verified owner.', '["parking", "power", "security"]', '["https://images.unsplash.com/photo-1581092160562-40aa08e78837?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1565891741441-64926e441838?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1581092160562-40aa08e78837?auto=format&fit=crop&w=800&q=70', '/floorplans/industrial.svg', 'owner', 'approved', true, true, true, 5, 64, 1, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005112', 'p5112', 'f1c70000-0000-4000-8000-000000000010', 'Co-working Space in Baner', 'rent', 'Co-working Space', 160000, 'per-month', 960000, false, 2000, 'sqft', 1750, 'furnished', 6, 'ready-to-move', 'Baner', 'baner', 'Pune', 18.559, 73.776, 'Co-working Space available on rent in Baner, Pune. Zero brokerage - deal directly with the verified owner.', '["parking", "power", "lift", "security", "club"]', '["https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=800&q=70', '/floorplans/coworking.svg', 'owner', 'approved', true, true, true, 3, 241, 11, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30')
    ON CONFLICT DO NOTHING;


-- ---------------------------------------------------------------------------
-- A HOME INSIDE SKYLINE HEIGHTS (added 2026-08-19)
--
-- The society directory seeds 348 societies, all with coordinates, and 26 of
-- them have a listing attached. `skyline-heights-baner` was not one of the 26 —
-- it had coordinates but no homes. The Society Hub hides a tab that would open
-- empty, which is correct behaviour and is itself asserted ("Homes and Location
-- tabs are hidden for a generic society with no listings"). So the *absence* of
-- this row did not look like missing data; it looked like the Homes tab having
-- been removed from the product.
--
-- One listing, because the society-tabs spec describes Skyline as "has 1 listing
-- + coords" and the Homes tab carries a count badge. A second home would not
-- break the badge assertion (/Homes\s*\d+/), but it would quietly make the
-- fixture stop matching its own description, and the next person to read that
-- comment would be misled.
--
-- Added rather than re-pointed: `p5013` is also a Baner flat and is already
-- attached to a different society, so moving it would have given Skyline a home
-- by taking one away from somewhere else - fixing one page by emptying another.
-- Reuses p5013's owner (7c92f0c4...) rather than inventing an owner, so the trust
-- counters see one more listing and no new person.
--
-- The society is resolved by SLUG, not by id, and the coordinates are copied off
-- the society row rather than retyped. Societies are seeded by
-- `db/migration/R__seed_reference_data.sql` with `gen_random_uuid()`, so every
-- reset gives Skyline Heights a brand-new primary key: an id pasted in from a
-- psql session is correct exactly until the next reset, and then it becomes a
-- foreign-key violation. `slug` is the stable identity here - it is what the
-- spec navigates to and what the reference data keys on - so it is the only
-- safe thing for a fixture to point at.
-- ---------------------------------------------------------------------------
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

-- `listing_count` is a denormalised column that the bulk society import left at 0
-- for every society, including the 26 that do have listings. Set it here so the
-- Homes tab's count badge is right whether the UI reads the column or counts the
-- rows; the two agree for Skyline, which is the only society a spec opens.
UPDATE public.societies SET listing_count = 1
 WHERE slug = 'skyline-heights-baner' AND listing_count = 0;


-- ---------------------------------------------------------------------------
-- FLATMATE SEEKERS: MOVE-IN DATES AND LIFESTYLE TAGS (added 2026-08-19)
--
-- The three seeded seeker posts each had `move_in = NULL` and `tags = '[]'`.
-- Both are actively wrong rather than merely thin, because of how the frontend
-- reads them (flatmates/helpers.js):
--
--   moveInDays(null) === 0
--
-- i.e. a post with no stated move-in date is treated as available *immediately*.
-- With every seeded post NULL, the "Immediate" chip selected all of them, so a
-- filter whose entire job is to narrow returned exactly what it started with.
-- The empty tags failed the mirror image: "Non-smoker" matched nothing, so the
-- same control went from all to none. One filter could not narrow and the other
-- could not leave anything standing, and neither looked like a data problem from
-- the test output.
--
-- So the three existing posts are UPDATEd rather than left alone and worked
-- around. A NULL move-in is not a neutral value here, it is a claim - "available
-- now" - and it was not one the fixture meant to make.
--
-- Five more are added so the spread is wide enough to be narrowed twice over:
--   'now' (2)  ->  Immediate returns 2 of 8
--   '15'  (2)  ->  a date ~20 days out returns 4, strictly more than Immediate
--   '30'  (2), '60' (2)  ->  the tail that both filters must exclude
-- and four of the eight carry 'Non-smoker', so that habit narrows to 4 - fewer
-- than the whole set, more than none. Groups are unaffected by the move-in
-- filter (groupMatches has no move-in clause), so they shift every count by the
-- same constant and none of the inequalities depend on how many exist.
--
-- ---------------------------------------------------------------------------
UPDATE public.flatmate_seeker_posts SET move_in = '30', tags = '["Vegetarian", "Student"]'
 WHERE id = 'f1c7000c-0000-4000-8000-000000000001' AND move_in IS NULL;
UPDATE public.flatmate_seeker_posts SET move_in = '60', tags = '["Night owl", "Fitness"]'
 WHERE id = 'f1c7000c-0000-4000-8000-000000000002' AND move_in IS NULL;
UPDATE public.flatmate_seeker_posts SET move_in = 'now', tags = '["Non-smoker", "Working professional"]'
 WHERE id = 'f1c7000c-0000-4000-8000-000000000003' AND move_in IS NULL;

-- The new posts get five new user rows rather than reusing the three existing
-- seeker users, because the schema forbids the reuse:
--
--   uq_flatmate_seeker_posts_live_user  UNIQUE (user_id) WHERE archived = false
--
-- One live seeker post per person - a real product rule (you are looking for one
-- place at a time), not an implementation detail. Worth noting how that surfaced:
-- the first version of this block did reuse the ids, and because these inserts
-- end in ON CONFLICT DO NOTHING, the unique violation was swallowed and the
-- statement reported success having written nothing. The row count afterwards
-- was the only thing that said otherwise. ON CONFLICT DO NOTHING is what makes
-- this file safely re-runnable, and it is also what makes a genuinely wrong row
-- indistinguishable from an already-present one - so these blocks are verified by
-- counting, never by exit status.
INSERT INTO public.users
    (id, name, mobile, role, status, city, mobile_verified, verified, aadhaar_verified,
     listings_count, joined_at, created_at, updated_at)
VALUES
 ('f1c70000-0000-4000-8000-000000000021', 'Sneha Joshi', '9700000021', 'buyer', 'active', 'Pune', true, true, false, 0, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000000022', 'Aditi Rao', '9700000022', 'buyer', 'active', 'Pune', true, true, false, 0, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000000023', 'Pooja Shah', '9700000023', 'buyer', 'active', 'Pune', true, false, false, 0, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000000024', 'Karan Malhotra', '9700000024', 'buyer', 'active', 'Pune', true, false, false, 0, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000000025', 'Nikhil Rane', '9700000025', 'buyer', 'active', 'Pune', true, true, false, 0, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30')
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


-- ---------------------------------------------------------------------------
-- FLATMATE GROUPS, ONE PER SEEKER LOCALITY (added 2026-08-19)
--
-- The map-popup spec opens the Team up tab, clicks the first area and then the
-- first bubble, and asserts that at least one row in that popup offers a group
-- action (Join / Request / Full) rather than a seeker's "Express interest".
-- With a single seeded group, in Kharadi, whether that assertion passed came
-- down to which locality happened to sort first - the spec read as a check on
-- group CTAs while actually testing the sort order, and it failed once the
-- first bubble was a locality with only seekers in it.
--
-- Fixed by making the claim true of every bubble instead of the lucky one: one
-- group in each locality that has a seeker (Kharadi already had one).
--
-- Two things about bubble membership drive the shape of this block, and both are
-- easy to get wrong from the table alone:
--
--   1. A bubble indexes a seeker under EVERY locality in `localities`, not just
--      the first. Pooja Shah listing '["Wakad", "Baner"]' put her in the Baner
--      bubble as well as the Wakad one - so Baner held three seekers plus its
--      group while the table said two.
--   2. The popup renders at most MAX_ROWS = 3, seekers first. A fourth row is not
--      scrolled to, it is dropped - and the group is what falls off the end.
--
-- Together those turned a group that existed, was approved, and was served by
-- the API into one that was invisible in the only bubble the spec opens. So the
-- rule this block maintains is per LOCALITY MENTION, not per seeker: at most two
-- seekers may name any one locality, and every locality named by a seeker has a
-- group - including Aundh and Balewadi, which no seeker lives in but Rahul and
-- Meera each list as a second choice.
--
-- All of them reuse the existing group host. Groups are hosted by tenants here
-- (host_role 'tenant', verification_tier 'identity'), matching the seeded one.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- NAMED RESIDENTIAL RENTALS AND A LAND SALE  (added 2026-08-19)
--
-- WHAT WAS MISSING
-- ----------------
-- The catalogue had 24 rentals and not one of them was an approved residential
-- *Flat*. The only two rent Flats, 42ba0880 (Kharadi) and 75e78160 (Pimple
-- Saudagar), are both `pending` on purpose - they are the outreach-console and
-- concierge fixtures, and approving either would destroy the invariant each was
-- created to hold. Everything else on rent is a Penthouse, Studio, Plot, Row
-- House, Villa, or one of the six commercial units added on 2026-08-18.
--
-- Worse, every residential rental is anonymous `pg_dump` scenery: no readable
-- slug, and `deposit`, `maintenance` and `carpet_area` all NULL. So a spec that
-- wants "a rental" has nothing to name, and a spec that wants to read the rent
-- economics has nothing to read.
--
-- Likewise no land was for sale. The two buy Plots (e3b80978 Undri, 2b49c102
-- Bavdhan) are `flagged` and `pending` respectively, and both carry a bogus
-- `bhk` - a dump artefact from a wizard that always asked the question, not a
-- shape to copy. `land_use` is NULL on both.
--
-- HOW THIS SHOWS UP
-- -----------------
-- Exactly like the commercial gap did, and just as misleadingly. A converted
-- spec pointed at a rental that is not there fails with `locator.waitFor:
-- Timeout` on the detail page, which reads as a broken selector. The 15-spec
-- conversion wave on 2026-08-19 lost 31 tests across 8 files, and this absence
-- is behind the rent half of them.
--
-- WHY THE LOCALITIES ARE NOT INTERCHANGEABLE
-- -----------------------------------------
-- `frontend/src/data/localityIntel.js` carries a curated benchmark for exactly
-- ten localities: Baner, Wakad, Hinjawadi, Koregaon Park, Kothrud, Viman Nagar,
-- Aundh, Kharadi, Hadapsar, Wagholi. The detail page prints a real comparison
-- when the listing sits in one of those and a neutral "we would rather publish a
-- verified number than a guessed one" note when it does not. Both branches need
-- a fixture, so the locality of each row below is load-bearing:
--
--   p5121  Wakad     - IS benchmarked (rent2 = 32000 for Baner, 27000 here), and
--                      priced at 24000 so the verdict is a definite "below
--                      locality average" rather than a boundary case.
--   p5123  Balewadi  - is NOT benchmarked, which is the whole reason it is
--                      Balewadi and not somewhere prettier. Moving this row to a
--                      benchmarked locality silently deletes the coverage of the
--                      neutral-note branch while leaving the test green.
--
-- p5122 is 1 BHK because the flatmate-split card is asserted ABSENT on a rental
-- too small to share; p5121 is 2 BHK so the same card is asserted PRESENT. A
-- single rental cannot prove both, which is why there are two.
--
-- OWNER
-- -----
-- Reuses `f1c7...0010` (Sanjay Pathak), the owner of the twelve commercial
-- units, rather than inventing a person. `live-trust-counters` asserts
-- relationships and not totals - owners <= listings, and strictly fewer people
-- than listings - so adding listings to an existing owner keeps every one of its
-- assertions true and makes the "fewer people than listings" one stronger. His
-- `listings_count` is left at 12 deliberately: it is a denormalised display
-- field, and no assertion reads it.
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, deposit, maintenance, negotiable, area, area_unit, carpet_area, furnishing, floor, total_floors, facing, possession, locality, locality_slug, city, lat, lng, description, amenities, images, cover_image, floor_plan, posted_by_type, status, verified, owner_verified, ownership_verified, docs_count, views, enquiries, created_at, updated_at) VALUES
 ('f1c70000-0000-4000-8000-000000005121', 'p5121', 'f1c70000-0000-4000-8000-000000000010', '2 BHK Flat for rent in Wakad', 'rent', 'Flat', 2, 24000, 'per-month', 72000, 1800, true, 950, 'sqft', 780, 'semi-furnished', 4, 11, 'East', 'ready-to-move', 'Wakad', 'wakad', 'Pune', 18.598, 73.762, '2 BHK Flat available on rent in Wakad, Pune. Zero brokerage - deal directly with the verified owner.', '["parking", "lift", "security", "power", "gym"]', '["https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=800&q=70', '/floorplans/2bhk.svg', 'owner', 'approved', true, true, true, 3, 208, 7, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005122', 'p5122', 'f1c70000-0000-4000-8000-000000000010', '1 BHK Flat for rent in Hinjawadi', 'rent', 'Flat', 1, 15000, 'per-month', 45000, 1000, true, 560, 'sqft', 450, 'unfurnished', 2, 7, 'North', 'ready-to-move', 'Hinjawadi', 'hinjawadi', 'Pune', 18.591, 73.738, '1 BHK Flat available on rent in Hinjawadi, Pune. Zero brokerage - deal directly with the verified owner.', '["parking", "lift", "security"]', '["https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1493809842364-78817add7ffb?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=800&q=70', '/floorplans/1bhk.svg', 'owner', 'approved', true, true, true, 2, 141, 4, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005123', 'p5123', 'f1c70000-0000-4000-8000-000000000010', '3 BHK Flat for rent in Balewadi', 'rent', 'Flat', 3, 42000, 'per-month', 126000, 2600, false, 1450, 'sqft', 1180, 'furnished', 8, 14, 'West', 'ready-to-move', 'Balewadi', 'balewadi', 'Pune', 18.575, 73.769, '3 BHK Flat available on rent in Balewadi, Pune. Zero brokerage - deal directly with the verified owner.', '["parking", "lift", "security", "power", "gym", "pool", "club"]', '["https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1484154218962-a197022b5858?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=800&q=70', '/floorplans/3bhk.svg', 'owner', 'approved', true, true, true, 4, 176, 6, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30')
    ON CONFLICT DO NOTHING;

-- The land sale. `bhk` is NULL, unlike the two dumped Plots: `propertyKind()` in
-- frontend/src/pages/consumer/property/derivations.js routes any type containing
-- 'plot', 'land' or 'farm' to the land branch, which renders plot zone and title
-- instead of bedrooms, and `floorPlanFor()` returns null for land so the
-- floor-plan section never appears. A bedroom count on a plot is therefore not
-- merely odd, it contradicts the branch the page is about to take.
--
-- Wagholi IS in the benchmark set, which is the point: the spec asserts that a
-- LAND listing shows the neutral note even in a locality where a residential
-- benchmark exists, proving the page suppresses the comparison on the property
-- kind rather than on whether it happens to have the data. Putting this row in
-- an unbenchmarked locality would make it pass for the wrong reason.
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, price, price_unit, negotiable, area, area_unit, possession, land_use, locality, locality_slug, city, lat, lng, description, amenities, images, cover_image, posted_by_type, status, verified, owner_verified, ownership_verified, docs_count, views, enquiries, created_at, updated_at) VALUES
 ('f1c70000-0000-4000-8000-000000005124', 'p5124', 'f1c70000-0000-4000-8000-000000000010', 'Open Plot for sale in Wagholi', 'buy', 'Plot', 8500000, 'total', true, 2400, 'sqft', 'ready-to-move', 'residential', 'Wagholi', 'wagholi', 'Pune', 18.58, 74.001, 'Open Plot available on sale in Wagholi, Pune. Clear title, zero brokerage - deal directly with the verified owner.', '["power", "security"]', '["https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=800&q=70', 'owner', 'approved', true, true, true, 3, 94, 2, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30')
    ON CONFLICT DO NOTHING;

-- COMMERCIAL FIT-OUT BACK-FILL (added 2026-08-19)
--
-- The commercial stock above was seeded with a generic ["parking", "power", "security"]
-- amenity list. The property page reads `amenities` to render the "Fit-out & fixtures"
-- section, and that section is deliberately sub-type-specific: COMMERCIAL_FIXTURES in
-- frontend/src/pages/consumer/list-property/constants.js splits every commercial subtype
-- into one of three use-profiles, so a warehouse offers a loading bay and never a
-- reception desk. With the generic list every profile rendered the same three words, which
-- means the seed could not tell a correct page from a broken one - the whole point of the
-- section is that it changes with the subtype.
--
-- These lists are taken verbatim from COMMERCIAL_FIXTURES so a fixture drift in the product
-- shows up as a failing assertion rather than a quietly weaker test. Parking/power/security
-- are kept on the front of each list because they are true of all of them and because the
-- generic amenity chips elsewhere on the page still read them.
--
--   workspace  -> Office Space, Co-working Space        (p5101, p5106, p5107, p5112)
--   retail     -> Shop / Showroom, Retail / Mall Unit   (p5102, p5103, p5108, p5109)
--   industrial -> Warehouse / Godown, Industrial / Factory (p5104, p5105, p5110, p5111)

UPDATE public.properties SET amenities =
  '["parking", "power", "security", "Server / UPS Room", "Meeting Cabins", "Reception Area", "Conference Room", "False Ceiling", "Central AC"]'
WHERE slug IN ('p5101', 'p5106', 'p5107', 'p5112');

UPDATE public.properties SET amenities =
  '["parking", "power", "security", "Main-Road Frontage", "Display Windows", "Rolling Shutter", "Signage Space", "Mezzanine Floor", "Customer Washroom"]'
WHERE slug IN ('p5102', 'p5103', 'p5108', 'p5109');

UPDATE public.properties SET amenities =
  '["parking", "power", "security", "Loading Bay / Dock", "High Ceiling", "3-Phase Power", "Wide Truck Access", "Crane / Gantry Support", "Covered Yard"]'
WHERE slug IN ('p5104', 'p5105', 'p5110', 'p5111');

-- PROPERTY REVIEW FIXTURE (added 2026-08-19)
--
-- `reviews` held exactly one row, against a property nothing asserts on, so the ratings
-- summary on the property page had no fixture at all. The mock suite worked around this by
-- writing `puneNestPropReviews` into localStorage, which the live app never reads - the
-- aggregate there comes from the server. So the summary block, its star distribution and its
-- per-aspect averages were all unverified against the real seam.
--
-- The three rows below are the asymmetric fixture that makes the summary falsifiable:
--
--   ratings 5 / 4 / 3      -> average is exactly 4.0, and one review lands on each of the
--                             top three bars while 2* and 1* stay empty. The distribution
--                             arrives as string keys "1".."5" and is drawn from a 0-based
--                             array, so an off-by-one shifts the 5* count onto the 4* bar
--                             and still renders a plausible chart. Only an uneven seed
--                             catches it.
--
--   categories sparse      -> locality is rated by two authors (5 and 4), condition by one,
--                             accuracy and owner by nobody. That proves two things at once:
--                             the aspect average is over the authors who answered (4.5, not
--                             3.0 across all three reviews), and unrated aspects are absent
--                             rather than displayed at 0.0 - a zero is a claim no reviewer
--                             made.
--
--   recommend t / t / NULL -> the headline percentage is 100%, not 67%. NULL is an author
--                             who skipped the question; counting a skip as "would not
--                             recommend" is the specific bug this row exists to catch.
--
-- target_id is resolved from the slug rather than hard-coded: it is a text column holding a
-- property uuid, and writing the uuid literally would silently detach this fixture from the
-- listing the moment that row is reseeded.

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

-- ---------------------------------------------------------------------------
-- Society reviews (D19). Four rows across two societies, and a third society
-- deliberately left empty.
--
-- `target_id` is resolved FROM public.societies rather than written literally,
-- and here that is not a nicety: `societies.id` is `gen_random_uuid()` and the
-- rows are seeded by a repeatable migration keyed on `slug`, so the uuid is a
-- different value in every database and after every reset. A literal would
-- point at nothing and the fixture would read as "no reviews" -- the same
-- silent zero these rows exist to disprove.
--
-- The aggregate is matched on the society **id**, not the slug
-- (`SocietyRatingService` maps ids to strings before calling
-- `ReviewRepository.aggregateFor`), and only `status = 'published'` counts.
--
-- Two societies carry 5 + 4, so the average is 4.5 and not a whole number: a
-- reader that truncates, rounds, or returns the count where the average
-- belongs still produces a plausible "4" or "2" from a whole-number fixture.
--
--   palm-court-panchshil-undri     the /societies directory card
--   golden-springs-panchshil-baner p5013's society, for the property page block
--   golden-nest-mahindra-baner     p5008's society -- NO rows on purpose, so the
--                                  "Not rated yet" branch stays provable
--
-- `categories` uses the society vocabulary (Safety, Maintenance, Management,
-- Amenities, Connectivity -- capitalised, per ReviewCategories), which is a
-- different set from the property one used above. Only one row carries any, so
-- an aspect nobody rated must be absent rather than shown as zero.
--
-- One review per author per target is a unique index, so the two rows on each
-- society use different authors.
-- ---------------------------------------------------------------------------

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

-- BATCH F: canonical-type stock + a deliberately photoless listing (added 2026-08-21)
--
-- The home-search dropdown and the listings Property-type filter both offer the six
-- canonical Buy types from frontend/src/data/propertyTypes.js, but Postgres had stock for
-- only three of them: there was no Independent House and no Farm Land anywhere in the
-- seed, and the only plots were 'Plot' (the legacy string). A filter option that can never
-- return a row is indistinguishable from a filter option that is broken, so
-- live-search-property-types.spec.js had been faking its stock into puneNestDB_v5 - the
-- mock store the live app does not read - and passing while proving nothing.
--
-- All four are featured=true. That has no visual effect on a tile; it only pins them to
-- page 1 under the real relevance sort, so the type-filter assertions do not depend on
-- where a given row happens to land in a 100-row page.
--
-- p5131 uses 'Open Plot' rather than the legacy 'Plot' deliberately: SEARCH_TYPES matches
-- key 'plot' on BOTH substrings, so keeping one row of each proves the filter still
-- recognises legacy stock instead of silently dropping it the day someone tidies the
-- taxonomy.
--
-- p5131 is also the only approved commercially-zoned plot in the seed. land_use is read by
-- the Land-use filter, and before this batch the frontend never read the column at all -
-- propertyMapper dropped it and landUseOf() fell back to a hash of the slug, so every land
-- listing advertised a zone the server had never stated. p5124 is 'residential' in Postgres
-- and was rendering as 'mixed'. Zoning is a legal attribute of the land, so the mapper now
-- reads it and this row gives the 'Commercial' option something true to match.
--
-- p5132's 'agricultural' is stated rather than left NULL even though landUseOf() would infer
-- it from the Farm Land type: the inference is a display fallback and the assertion should
-- be pinned to the column, otherwise the test passes if the column is ignored again.
--
-- p5133 carries images '[]' and cover_image NULL on purpose. It is the fixture for D188:
-- <img src=""> is not an image-less image - the browser resolves the empty string against
-- the document URL and re-downloads the whole HTML page as a photo, once per card. Nothing
-- else in the seed has zero photos, so without this row that regression cannot be caught
-- live. Do not "fix" this row by giving it a picture.
INSERT INTO public.properties (id, slug, owner_id, title, deal, property_type, bhk, price, price_unit, negotiable, area, area_unit, carpet_area, furnishing, possession, land_use, locality, locality_slug, city, lat, lng, description, amenities, images, cover_image, posted_by_type, status, featured, verified, owner_verified, ownership_verified, docs_count, views, enquiries, created_at, updated_at) VALUES
 ('f1c70000-0000-4000-8000-000000005130', 'p5130', 'f1c70000-0000-4000-8000-000000000010', '3 BHK Independent House for sale in Baner', 'buy', 'Independent House', 3, 12500000, 'total', true, 1850, 'sqft', 1520, 'semi-furnished', 'ready-to-move', NULL, 'Baner', 'baner', 'Pune', 18.5602, 73.7861, '3 BHK Independent House available on sale in Baner, Pune. Zero brokerage - deal directly with the verified owner.', '["parking", "security", "power", "garden"]', '["https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=70", "https://images.unsplash.com/photo-1570129477492-45c003edd2be?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=800&q=70', 'owner', 'approved', true, true, true, true, 3, 132, 5, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005131', 'p5131', 'f1c70000-0000-4000-8000-000000000010', 'Open Plot for sale in Baner', 'buy', 'Open Plot', NULL, 9800000, 'total', true, 2600, 'sqft', NULL, NULL, 'ready-to-move', 'commercial', 'Baner', 'baner', 'Pune', 18.5595, 73.7802, 'Commercially zoned open plot on sale in Baner, Pune. Clear title, zero brokerage - deal directly with the verified owner.', '["power", "security"]', '["https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=800&q=70', 'owner', 'approved', true, true, true, true, 3, 88, 3, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005132', 'p5132', 'f1c70000-0000-4000-8000-000000000010', 'Farm Land for sale in Baner', 'buy', 'Farm Land', NULL, 6400000, 'total', true, 21780, 'sqft', NULL, NULL, 'ready-to-move', 'agricultural', 'Baner', 'baner', 'Pune', 18.5641, 73.7745, 'Farm Land available on sale near Baner, Pune. Clear title, zero brokerage - deal directly with the verified owner.', '["power"]', '["https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=800&q=70"]', 'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?auto=format&fit=crop&w=800&q=70', 'owner', 'approved', true, true, true, true, 2, 61, 1, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30'),
 ('f1c70000-0000-4000-8000-000000005133', 'p5133', 'f1c70000-0000-4000-8000-000000000010', '2 BHK Flat for sale in Baner', 'buy', 'Flat', 2, 7200000, 'total', true, 910, 'sqft', 760, 'unfurnished', 'ready-to-move', NULL, 'Baner', 'baner', 'Pune', 18.5588, 73.7890, '2 BHK Flat available on sale in Baner, Pune. Photos coming soon. Zero brokerage - deal directly with the verified owner.', '["parking", "lift", "security"]', '[]', NULL, 'owner', 'approved', true, true, true, true, 2, 44, 1, '2026-08-01 10:00:00+05:30', '2026-08-01 10:00:00+05:30')
    ON CONFLICT DO NOTHING;

-- BATCH G: real values for the attributes the browser used to invent (added 2026-08-21)
--
-- Every column set below has existed since V95 and every one had a ListingFacets predicate,
-- but all of them were NULL or at their default, so the frontend manufactured a value from
-- fnvHash(slug) and filtered on that. Wiring the mapper without this batch would have been
-- worse than leaving the fabrication in place: eleven filters would have gone to zero stock,
-- which is precisely the pressure that produced the fabrication in the first place ("Small
-- rentals are always a PG or flatmate share so the filter has stock").
--
-- The old fabrication was not merely fictional, it was broken. fnvHash returns a uint32 and
-- the derivations used a SIGNED >>, so for any slug whose hash has the high bit set - about
-- half the catalogue, and 14 of the 17 rows checked - `(h >> 16) % 26` went NEGATIVE. Those
-- listings advertised an age of -18 years and a floor of -31, were dropped from any narrowed
-- Age or Floor search (a negative can never be >= a lower bound of 0), and got
-- `availableFrom = ['now','15','30'][-2]` = undefined, so they matched no availability option
-- at all. `(h >> 14) % 5 < 2` is true for every negative remainder, so the same rows were
-- unconditionally badged "conveyance done" rather than the ~40% the comment claimed. The
-- author had diagnosed exactly this hazard one line away, on PG_SHARING ("a signed >> would
-- go negative for hashes >= 2^31"), and fixed it there alone.
--
-- These are UPDATEs, not INSERTs, on purpose: they add facts to listings that already exist
-- rather than adding rows, so no count assertion anywhere moves. Values are chosen to
-- CONTRADICT what the hash produced wherever the field is filterable, so a test pinned to an
-- exact set fails if anything ever starts deriving these again. The seeded sets are also
-- deliberately small - three society-verified rows against the roughly thirty the coin flip
-- produced - which is what makes an exact-set assertion a discriminator rather than a
-- coincidence.
--
-- Rows left NULL are as meaningful as the rows filled in. p5010 (villa) and p5130
-- (independent house) state nothing: an independent house has no society to verify and no
-- floor to be on, and the detail page must render "Not specified" rather than a number. Keep
-- at least one such row or the "unstated" path stops being covered.

-- Buy: age / floor / facing, and the two society trust flags.
--   age_years present:  p5133=1, p5130=2, p5023=3, p5008=6, p5120=9, p5013=18
--     -> narrowing Age to 0-3 yields exactly {p5133, p5130, p5023}
--   floor present:      p5013=2, p5133=3, p5023=5, p5008=9, p5120=11
--     -> narrowing Floor to 8+ yields exactly {p5008, p5120}
--   society_verified:   {p5120, p5133, p5023}
--   conveyance_done:    {p5120, p5008, p5023}
-- p5133 is the ordinary Indian case worth keeping: a new building whose society is registered
-- but whose conveyance has not completed. That is exactly the pair of facts a buyer is trying
-- to separate, and the hash decided them independently at 50% and 40%.
UPDATE public.properties SET age_years = 9,  floor = 11, total_floors = 14, facing = 'East',       society_verified = true,  conveyance_done = true  WHERE slug = 'p5120';
UPDATE public.properties SET age_years = 1,  floor = 3,  total_floors = 12, facing = 'North-East', society_verified = true,  conveyance_done = false WHERE slug = 'p5133';
UPDATE public.properties SET age_years = 3,  floor = 5,  total_floors = 8,  facing = 'North',      society_verified = true,  conveyance_done = true  WHERE slug = 'p5023';
UPDATE public.properties SET age_years = 6,  floor = 9,  total_floors = 9,  facing = 'West',       society_verified = false, conveyance_done = true  WHERE slug = 'p5008';
UPDATE public.properties SET age_years = 18, floor = 2,  total_floors = 5,  facing = 'South',      society_verified = false, conveyance_done = false WHERE slug = 'p5013';
-- Independent house: an age, but no society and no floor in a building it does not sit in.
UPDATE public.properties SET age_years = 2 WHERE slug = 'p5130';
-- p5010 (villa) is left entirely unstated on purpose. Do not fill it in.

-- Rent: letting policy, availability and the PG / flatmate distinction.
--   tenants 'family':   {p5121, p5123}          available_from 'now': {p5121, p5007}
--   tenants 'company':  {p5123, p5014}          pets allowed:         {p5122, p5033}
--   shareType 'pg':        {p5007, p5033}   (occupancy stated in `sharing`)
--   shareType 'flatmates': {p5122, p5014}   (room stated, no occupancy)
-- p5033 and p5122 invert what the coin flip said - it called p5033 a flatmate share and p5122
-- a PG - so the PG and Flatmates chips cannot both pass by accident. p5000 states no policy at
-- all and must stay that way: it is the row proving an unstated listing is no longer
-- re-labelled to fill a filter.
UPDATE public.properties SET age_years = 5,  tenants = '["family"]'::jsonb, available_from = 'now', pets = false WHERE slug = 'p5121';
UPDATE public.properties SET age_years = 12, tenants = '["bachelor-male"]'::jsonb, available_from = '15', pets = true, room = 'single' WHERE slug = 'p5122';
UPDATE public.properties SET age_years = 7,  tenants = '["family", "company"]'::jsonb, available_from = '30', pets = false WHERE slug = 'p5123';
UPDATE public.properties SET age_years = 4,  floor = 1,  total_floors = 6,  facing = 'South', room = 'shared', tenants = '["bachelor-female"]'::jsonb, available_from = 'now', pets = false, sharing = '["triple"]'::jsonb WHERE slug = 'p5007';
UPDATE public.properties SET age_years = 15, floor = 12, total_floors = 12, facing = 'East',  room = 'shared', tenants = '["bachelor-male", "bachelor-female"]'::jsonb, available_from = '15', pets = true, sharing = '["double", "triple"]'::jsonb WHERE slug = 'p5033';
UPDATE public.properties SET age_years = 8,  floor = 6,  total_floors = 10, room = 'single', tenants = '["company"]'::jsonb, available_from = '30', pets = false WHERE slug = 'p5014';
-- p5000 (villa, rent) states no tenant policy, no availability and no share type. Do not fill it in.


-- BATCH H: enough stock for a second page (added 2026-08-22)
--
-- The listings grid now asks the server for one page at a time (24 rows) instead of pulling the
-- whole catalogue and slicing it in the browser. That change is only testable against a catalogue
-- that does not fit on one page. Before this batch the largest search in the seed was `deal=buy`
-- with 19 rows, so "the filter narrowed the catalogue" and "the filter narrowed the 24 rows the
-- browser happened to be holding" produced identical results, and a regression to client-side
-- filtering would have gone green.
--
-- Three properties of these rows are deliberate and load-bearing; changing any of them silently
-- weakens `consumer/search/live-server-side-search.spec.js`:
--
--   1. They are the OLDEST rows in the catalogue (January, against everything else's April-August).
--      Both the default `newest` order and relevance ranking therefore put them last, which keeps
--      all nineteen pre-existing buy listings on page 1 exactly where they were. Every spec that
--      opens `/listings?deal=buy` looking for a particular card still finds it.
--
--   2. They are all in Wagholi, which held exactly one approved buy listing before this batch (the
--      open plot p5124). Sitting last behind nineteen older rows, they straddle the page boundary:
--      five land on page 1 of `deal=buy` and five on page 2. So `deal=buy&loc=wagholi` is a search
--      a browser filtering the twenty-four rows it happens to be holding answers with SIX - the
--      five on page 1 plus p5124, which is also on page 1 - and a server that filtered the whole
--      catalogue answers with ELEVEN. That gap is the entire reason this batch is ten rows in one
--      locality rather than ten scattered: scattered, every locality would have fit on the page it
--      was already on and the two implementations would have agreed.
--
--      Deliberately NOT Magarpatta, which is the obvious empty locality and the wrong one.
--      `live-location-recovery.spec.js` needs Magarpatta to hold no approved buy listing at all,
--      so that `loc=magarpatta` combined with "near Magarpatta City" has nothing to match and the
--      page has to fall back to the proximity search and say so in a banner. Ten rows there
--      answered the query outright and the banner never rendered. A seed fixture is shared: read
--      what the live specs assert about a locality before adding stock to it.
--
--   3. They carry no trust badge at all - neither a verified owner nor checked ownership paperwork -
--      so `deal=buy` returns more listings than it does verified ones. That gap is what makes
--      `verifiedElements` falsifiable: the count behind it is `owner_verified OR live ownership
--      verification`, and while every buy listing was badged, a count describing only the current
--      page was indistinguishable from one describing the whole match.
--
--      The owner is what makes that stick, not the `owner_verified` literal below. This file
--      derives `owner_verified` from the owner's `aadhaar_verified` after both tables are loaded
--      (see the UPDATE above the FAQ section) - the badge claims the PERSON is verified, so it
--      cannot be set per listing. These rows were first written against Sanjay Pathak, who is
--      Aadhaar-verified, and the invariant quietly promoted all ten: `deal=buy` came back 29 of 29
--      verified and the assertion had nothing left to catch. They now belong to Isha Mehta
--      (`b05422ba`), an owner with no Aadhaar and, before this batch, no listings. Re-homing these
--      rows to a verified owner silently disarms the test.
--
-- They state nothing optional - no age, no floor, no facing, no society or conveyance flag - so the
-- exact-slug assertions in `live-listing-attributes.spec.js` are untouched, and they are covered by
-- that spec's "listings that state nothing are excluded from narrowed searches" rule for free.
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
