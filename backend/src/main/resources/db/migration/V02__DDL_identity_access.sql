-- V02 DDL Identity & Access. Root of the trust boundary: users + auth material + the back-office
-- controls that decide who may hold a session and what that session may reach.
--
-- Scope (in creation order): users, otp_codes, refresh_tokens, identity_verifications,
-- back_office_permissions, staff_account_approvals, staff_invites, notification_preferences,
-- erasure_requests.
--
-- Folded from the old chain: V2 (all of it), V18 (the users directory indexes only), V29 (the
-- otp_codes purpose widening only), V31 (users.hide_number), V56 (erasure_requests), V59
-- (refresh_tokens expiry index), V65 (back_office_permissions), V67 + V69 (staff_account_approvals
-- and the corrected table comment), V70 (uq_users_live_email_ci), V71 (staff_invites), V73 (the
-- notification_preferences table only -- the notifications.deliver_after half belongs to the
-- engagement file), V77 (the users review-flag columns), V126 (refresh_tokens.graced_count and its
-- rotated_from index).
--
-- Schemas: User, UserUpdate, StaffCreate, AuthResponse, AadhaarVerification, KycStart,
-- DigilockerWebhook.

-- ===========================================================================
-- users
-- ===========================================================================
-- users: the identity root every other table hangs off (reconciliation #10: *Mobile natural keys
-- become user_id FKs). email nullable (reconciliation #9). Seekers (buyer/tenant) share 'buyer'.
--
-- ---------------------------------------------------------------------------
-- V31 — `users.hide_number`: the owner's blanket privacy control (tech-debt D5, closed).
--
-- WHAT IT MEANS
-- -------------
-- Approving a contact request unlocks the relationship: the buyer may chat, and the owner sees the
-- buyer's real number. `hide_number` decides whether that approval *also* hands over the owner's raw
-- phone digits, or whether the owner would rather be reached in-app.
--
-- It is deliberately NOT a second gate. An owner who hides their number still approves requests, and
-- an approved buyer still gets a conversation; the only thing withheld is the ten digits. Modelling
-- it as another approval state would have made "approved" mean two different things depending on a
-- flag, which is how a trust model stops being explicable.
--
-- WHY IT LIVES ON `users` RATHER THAN ON `properties`
-- ---------------------------------------------------
-- The phone number is the owner's, not the listing's. A person who does not want their number handed
-- out does not want it handed out on their third listing either, and requiring them to re-set the
-- preference per listing would be a privacy control that fails open by default. Contact *approval*
-- is per-listing (each listing is a separate decision the owner makes); this is per-person, because
-- the thing it protects is per-person.
--
-- DEFAULT false, AND THAT IS THE SAFE DIRECTION HERE
-- --------------------------------------------------
-- Normally a privacy flag should default to the private value. Not this one: it defaults to the
-- behaviour every existing row already has, so this migration changes nothing for anybody. Defaulting
-- to `true` would silently withdraw numbers from buyers whose requests owners had already approved --
-- a change of meaning applied retroactively to a consent that was already given. Owners opt in.
--
-- Pairs with `verified_contact_only` above it, which is the same shape (owner preference, boolean,
-- NOT NULL, default false) and is the reason this column has no `CHECK`: there is nothing to check.
--
-- ---------------------------------------------------------------------------
-- V77: an internal review flag on a user account, and the provenance to make it accountable.
--
-- WHAT THIS ADDS, AND WHY IT DID NOT EXIST. The admin console has offered "Flag user for review"
-- since it was written. There was no column behind it: the mock stored the flag in the browser's
-- own copy of the database, so the button worked perfectly for exactly as long as one operator sat
-- at one machine and never reloaded. Converting `/admin/users` onto the API forced the question of
-- whether the capability is real, and the answer is yes -- it is how a moderator parks an account
-- that looks wrong but is not yet actionable, so the next person to look at the directory inherits
-- the suspicion instead of rediscovering it.
--
-- WHY A REASON IS MANDATORY, ENFORCED HERE AND NOT ONLY IN JAVA. A flag with no reason is worse
-- than no flag: the next moderator sees a marked account, cannot tell what was noticed, and either
-- clears it (losing whatever was seen) or leaves it (a permanent smear nobody can act on). The
-- CHECK is phrased `flagged = false OR reason present` so that clearing a flag is not obliged to
-- invent a reason, and so that the invariant survives any future write path that forgets it -- the
-- application check is the good error message, this is the guarantee.
--
-- WHY `flagged_by` IS `ON DELETE SET NULL` AND NOT `CASCADE`. Users are never hard-deleted on this
-- platform (`SoftDeleteEntity`; DPDP erasure pseudonymises and archives rather than DELETEs), so in
-- practice neither branch fires. It is SET NULL because the two facts are independent: that an
-- account was flagged is a moderation fact about the flagged account, and it must not evaporate
-- because the colleague who raised it later left. CASCADE would delete the flag along with the
-- flagger, which is exactly backwards.
--
-- WHY THERE IS NO CORRESPONDING COLUMN FOR THE VERIFIED BADGE. `PATCH /users/{id}/badge` grants the
-- L2 badge by hand, and the obvious instinct is to record who granted it and why, next to it. That
-- would duplicate `audit_log`, which already carries actor, action, entity, entity_id, timestamp and
-- metadata for every back-office write, and which V77's sibling change makes queryable by
-- entity_id. The flag columns are here because they are *state the product reads* -- the directory
-- renders them, the filter selects on them. Provenance that only an auditor reads belongs in the
-- audit log, and having it in two places means having it disagree with itself.
CREATE TABLE users (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name                  text,
    mobile                text NOT NULL UNIQUE CHECK (mobile ~ '^[6-9][0-9]{9}$'),  -- schema: Mobile
    email                 text,
    password_hash         text,                                                     -- staff/admin only (StaffLoginRequest)
    role                  text NOT NULL DEFAULT 'buyer' CHECK (role IN ('buyer','owner','staff','admin')),
    team                  text CHECK (team IN ('rental','legal','loans','interior','packers','valuation')),
    status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
    city                  text,
    -- Trust ladder (ADR-019): mobile_verified (L1) is the floor; verified/aadhaar_verified is the
    -- opt-in badge (L2), a trust signal never a gate.
    mobile_verified       boolean NOT NULL DEFAULT false,
    verified              boolean NOT NULL DEFAULT false,
    aadhaar_verified      boolean NOT NULL DEFAULT false,
    verified_contact_only boolean NOT NULL DEFAULT false,  -- owner pref: accept L2-verified contacts only
    hide_number           boolean NOT NULL DEFAULT false,  -- owner pref: mask my number even after approval
    listings_count        integer NOT NULL DEFAULT 0,      -- denormalized (owners)
    avatar                text,
    joined_at             timestamptz NOT NULL DEFAULT now(),
    last_active           timestamptz,
    archived              boolean NOT NULL DEFAULT false,   -- soft-delete (never hard-delete users)
    archived_at           timestamptz,
    archive_reason        text,
    -- Internal moderation flag; a reason is mandatory whenever it is set (see users_flag_reason_check).
    flagged               boolean NOT NULL DEFAULT false,
    flag_reason           text,
    flagged_at            timestamptz,
    flagged_by            uuid REFERENCES users (id) ON DELETE SET NULL,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT users_flag_reason_check
        CHECK (flagged = false OR (flag_reason IS NOT NULL AND length(trim(flag_reason)) > 0))
);

CREATE INDEX idx_users_role   ON users (role);
CREATE INDEX idx_users_team   ON users (team) WHERE team IS NOT NULL;
CREATE INDEX idx_users_status ON users (status) WHERE archived = false;

-- ---------------------------------------------------------------------------
-- The user directory (V18)
-- ---------------------------------------------------------------------------
--
-- api-standards.md §5 requires every sort be index-backed, and the back-office reads are exactly
-- the ones that get slow first: they are unfiltered by user, so they scan the whole table.
--
-- idx_users_role (role) and idx_users_status (status) WHERE archived = false above are filters
-- without an ordering. The directory is "live users, optionally of one role, newest first", so both
-- variants get a key whose trailing column is the sort.
--
-- Both are partial on archived = false: that is the default read, and excluding suspended accounts
-- from the index keeps it proportional to the live population rather than to everyone who ever
-- signed up. The `?archived=true` variant is an audit view, expected to be rare and small.
CREATE INDEX idx_users_created ON users (created_at DESC) WHERE archived = false;
CREATE INDEX idx_users_role_created ON users (role, created_at DESC) WHERE archived = false;

-- `q` is deliberately a PREFIX search, not a substring search.
--
-- A substring match ("%sharma%") cannot use a btree at all; serving it properly needs pg_trgm and
-- a GIN index. An internal ops lookup -- where the operator is reading a name or a number off a
-- support ticket and typing the start of it -- does not justify adding an extension to the
-- platform, and a seq-scan-per-keystroke on the users table certainly does not justify itself.
-- text_pattern_ops is what makes LIKE 'x%' index-usable regardless of the database's collation.
CREATE INDEX idx_users_name_prefix ON users (lower(name) text_pattern_ops);
CREATE INDEX idx_users_mobile_prefix ON users (mobile text_pattern_ops);

-- WHY THE FLAG INDEX IS PARTIAL. Flagged accounts are meant to be rare; a full index on a boolean
-- that is false for essentially every row is bytes the planner will not use. `WHERE flagged = true`
-- indexes only the rows the "show me flagged accounts" filter is looking for.
CREATE INDEX idx_users_flagged ON users (flagged) WHERE flagged = true;

-- ---------------------------------------------------------------------------
-- At most one LIVE account per email address (V70).
--
-- WHAT THIS CLOSES. `users.email` had no uniqueness guarantee of any kind -- not a constraint, not
-- an index, nothing. The only thing standing between the platform and two accounts on one address
-- was an application check, `existsByEmailAndArchivedFalse`, consulted at exactly one write site
-- (`moderation.user.UserAdminService.addStaff`). Archiving is a SOFT delete, so that check
-- legitimately passes once an address has been archived, and the restore path validated nothing at
-- all. The reachable sequence was: create a@x.com, archive it, create a@x.com again, restore the
-- first. Two live rows, one address, and the operator saw two successes.
--
-- WHY THAT WAS WORSE THAN UNTIDY. `identity.auth.AuthService.staffLogin` resolves the account with
-- `findByEmailAndArchivedFalse` -- an Optional-returning lookup. Two matching rows is not a failed
-- login, it is an IncorrectResultSizeDataAccessException: a 500 on every subsequent sign-in for
-- that address, for BOTH people, with no way back through the back office, because the restore
-- that caused it reported success and the directory shows two ordinary accounts.
--
-- WHY THE INDEX IS PARTIAL, AND WHY YOU MUST NOT "SIMPLIFY" IT INTO A PLAIN UNIQUE CONSTRAINT.
-- Users are never hard-deleted on this platform (`SoftDeleteEntity`; DPDP erasure pseudonymises and
-- archives, it does not DELETE), so archived rows accumulate and keep their addresses forever. A
-- total unique constraint would therefore make an email address a single-use resource for the
-- lifetime of the database: archive a colleague and nobody -- including that same colleague on a
-- second engagement -- could ever use that address again, and the archive itself would start
-- failing the moment two archived rows happened to share one. `WHERE archived = false` says the
-- thing the platform actually means: at most one LIVE claimant, history unconstrained.
--
-- WHY `lower(email)` AND NOT `email`. Because the collision is the operator's, not the database's.
-- `A@x.com` and `a@x.com` are the same mailbox to every mail server and to the person typing them,
-- so a case-sensitive index would enforce a rule nobody believes in and leave the duplicate-account
-- outcome above reachable through a shift key. The domain half of an address is case-insensitive by
-- RFC 5321 and the local half is case-sensitive in theory only -- no provider this platform's staff
-- use treats it that way. Note that this is STRICTER than the surviving application check in
-- `addStaff`, which still compares case-sensitively; that mismatch is a known defect and this index
-- is what stops it becoming a duplicate account. It costs a slightly less specific error message on
-- that one path (the constraint handler's generic 409 rather than a tailored one), which is the
-- right way round.
--
-- `email IS NOT NULL` is not needed for correctness -- NULLs never conflict in a btree unique index
-- -- but most rows on this platform have no email at all (buyers and owners sign in by mobile), so
-- excluding them keeps the index proportional to the number of people who actually have one.
--
-- NOT CREATED CONCURRENTLY, deliberately: Flyway runs migrations in a transaction and
-- CREATE INDEX CONCURRENTLY cannot run inside one. The table is small (a few hundred rows on the
-- largest deployment) and the write lock is momentary. Verified before writing this: zero
-- case-insensitive duplicates exist in either database, live or archived, so the build cannot fail.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_live_email_ci
    ON public.users (lower(email))
    WHERE archived = false AND email IS NOT NULL;

COMMENT ON INDEX public.uq_users_live_email_ci IS
    'At most one non-archived account per email address, compared case-insensitively. Partial on purpose: users are soft-deleted, so archived rows keep their addresses and must be allowed to repeat one. Do not replace with a total UNIQUE constraint; see migration V70 for why.';

COMMENT ON COLUMN users.hide_number IS
    'Owner preference: keep my mobile masked even after I approve a contact request; reach me in-app instead.';

COMMENT ON COLUMN users.flagged IS
    'Internal moderation marker. Never rendered to the account holder or to any consumer surface; '
    'it is a note between back-office colleagues, not a status the platform acts on.';
COMMENT ON COLUMN users.flag_reason IS
    'What was noticed. Mandatory whenever flagged is true (users_flag_reason_check).';

-- The `suspended` state has been in users_status_check since V2 and nothing has ever written it.
-- `PATCH /users/{id}/suspend` does now, so record what the three values mean, because the
-- distinction between the two non-active ones is not self-evident from the names.
COMMENT ON COLUMN users.status IS
    'active | suspended | archived. suspended: the account still exists and still appears in the '
    'directory, but cannot obtain a session -- a reversible moderation state. archived: soft '
    'deleted, hidden from the default directory, and set by PATCH /users/{id}/archive, which also '
    'sets the archived flag that every read path filters on. The two are independent columns and a '
    'row may legitimately be both.';

-- ===========================================================================
-- otp_codes
-- ===========================================================================
-- Passwordless login OTP (ADR-008). Code stored hashed; attempts + TTL support throttling.
--
-- ---------------------------------------------------------------------------
-- OTP HAS A 'owner-consent' PURPOSE (V29)
-- ---------------------------------------------------------------------------
-- A sitting tenant listing a replacement flatmate pings the flat's OWNER, who confirms by OTP that
-- they know it is happening. That code is not a login: it authenticates nobody, issues no token and
-- is sent to a person who usually has no account at all.
--
-- Scoping it as its own purpose is what keeps the two apart. The send-budget and the attempt cap are
-- both keyed on (mobile, purpose), so a consent request cannot burn a login code's budget, and --
-- much more importantly -- a code obtained through the consent flow can never be presented at
-- /auth/login. Reusing 'login' here would have made "ask for consent" a way to mint login codes for
-- any number you can name.
--
-- Written as an inline CHECK, so it carries the Postgres-generated name otp_codes_purpose_check.
CREATE TABLE otp_codes (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mobile     text NOT NULL CHECK (mobile ~ '^[6-9][0-9]{9}$'),
    code_hash  text NOT NULL,
    purpose    text NOT NULL DEFAULT 'login'
                   CHECK (purpose IN ('login', 'signup', 'contact', 'owner-consent')),
    attempts   integer NOT NULL DEFAULT 0,
    consumed   boolean NOT NULL DEFAULT false,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_otp_codes_mobile ON otp_codes (mobile, purpose);

-- ===========================================================================
-- refresh_tokens
-- ===========================================================================
-- Rotating refresh tokens with reuse-detection (ADR-008). Stored hashed; rotated_from chains
-- rotations so a replayed old token can be detected and the family revoked.
--
-- ---------------------------------------------------------------------------
-- V126 Bound how many times one refresh-token family may be forgiven (ADR-008 follow-up).
--
-- The grace window in RefreshTokenService.rotate forgives a replay that lands within seconds of
-- the rotation it lost to, so two tabs racing do not sign the user out. That forgiveness was
-- unbounded per family, and unbounded is exploitable: an attacker holding a stolen token who keeps
-- rotating keeps the family's head permanently "fresh", so every replay the victim makes lands
-- inside a window the attacker is holding open. Attacker and victim then ping-pong indefinitely,
-- each forgiven, and the tripwire never fires for the full 30-day TTL.
--
-- graced_count carries the number of *consecutive* graces along a rotation chain: a clean
-- (uncontested) rotation resets it to 0, a forgiven one increments it, and the service burns the
-- family once it would exceed its limit. Consecutive rather than lifetime is what keeps a legitimately
-- flaky client from accumulating its way to a forced sign-out over thirty days, while still bounding
-- the ping-pong, which is contested at every single step and so never resets.
--
-- Backfill is 0 for existing rows -- the column counts consecutive graces ending at that row, and no
-- row written before this migration was minted by a graced rotation that we recorded. Starting them
-- at 0 is therefore accurate, not merely convenient.
CREATE TABLE refresh_tokens (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES users(id),
    token_hash   text NOT NULL UNIQUE,
    rotated_from uuid REFERENCES refresh_tokens(id),
    revoked      boolean NOT NULL DEFAULT false,
    graced_count integer NOT NULL DEFAULT 0,
    expires_at   timestamptz NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens (user_id);

-- V59 Add an expiry index for refresh-token pruning (D10 follow-up).
--
-- RefreshTokenPruningSweep deletes rows by expires_at. Without an index this is a periodic
-- full-table predicate scan as refresh_tokens grows. The index keeps the prune path bounded.
create index if not exists idx_refresh_tokens_expires_at on refresh_tokens(expires_at);

-- The grace walk resolves a chain by rotated_from (up to MAX_GRACE_HOPS lookups per replay), and
-- until now that column carried no index at all -- every hop was a sequential scan of the whole
-- table. Bounding the grace makes that path hotter, not colder, since it is now walked on exactly
-- the requests that matter most. Not declared unique: one successor per predecessor is an invariant
-- the service upholds under a row lock, but promoting it to a constraint here would turn any
-- historical violation into a failed migration on a table we cannot inspect ahead of time.
create index if not exists idx_refresh_tokens_rotated_from on refresh_tokens(rotated_from);

-- ===========================================================================
-- identity_verifications
-- ===========================================================================
-- Identity (KYC) verification badge (ADR-009/009b/019). Merges the in-progress KycStart handle
-- (ref/verification_url/expires_at) with the DigiLocker result (masked UID, mobile_match).
-- identity_hash = server-computed composite dedup key -> UNIQUE enforces "one Aadhaar = one account".
-- Raw Aadhaar is NEVER stored (only last-4 masked).
CREATE TABLE identity_verifications (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid NOT NULL UNIQUE REFERENCES users(id),
    ref              text UNIQUE,                       -- correlates KycStart <-> DigiLocker webhook
    badge            boolean NOT NULL DEFAULT false,
    status           text NOT NULL DEFAULT 'none' CHECK (status IN ('none','pending','verified','failed')),
    source           text CHECK (source IN ('digilocker')),
    masked_aadhaar   text,                              -- 'XXXX XXXX 1234'
    identity_hash    text UNIQUE,                       -- dedup key; irreversible
    mobile_match     boolean,                           -- soft signal (ADR-009a), nullable
    verification_url text,
    expires_at       timestamptz,
    verified_at      timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ===========================================================================
-- back_office_permissions
-- ===========================================================================
-- D192/D13: give a single back-office account a permission document of its own, and make it a
-- subtraction rather than a grant.
--
-- WHAT WAS MISSING. V61 deleted `settings.customRoles` rather than wiring it, and its header names
-- the three things that had to exist first. Two of them are answered here and one is answered in
-- Java:
--
--   1. A KEY TO RESOLVE A DOCUMENT AGAINST. There was no `users.role_id`, no claim and no endpoint,
--      so a bundle could only ever have been selected by something the client sent -- "an allow-list
--      the client opts out of". This table is keyed by `user_id`, which is the `sub` of a
--      signature-verified token and the one thing on the principal a caller cannot choose. No
--      request parameter, header or body field takes part in selecting a row.
--   2. A SERVER-SIDE VOCABULARY. `customRoles` held the admin console's module keys (`enquiries`,
--      `properties:verify`) and nothing mapped them onto anything the server enforces. The entries
--      stored here are drawn from `security/BackOfficePermissions`, a catalogue where every name
--      exists because a route is annotated with it -- and the write endpoint rejects a name that is
--      not in it (422) rather than storing it to look meaningful. The frontend's keys are NOT
--      mapped; inventing that mapping is still "writing policy nobody agreed".
--   3. DIRECTION. `customRoles` composed by union (`BASE u role-bundle u moduleAccess`). This
--      document is resolved by `security/AccountPermissions` as `retainAll` against a compiled-in
--      role baseline, so the resolved set is a SUBSET of the baseline by construction. There is no
--      value an administrator can put in this column that adds anything.
--
-- WHY A TABLE AND NOT A COLUMN ON `users`. Two reasons, and the second is the load-bearing one.
-- First, absence has to mean something: no row is "this account is not scoped", which is every
-- account today and must stay a no-op -- a nullable column would have said the same thing less
-- clearly, but only just. Second, the resolver lives in the shared kernel (`security`), which
-- `docs/system/package-structure.md` §2 forbids from importing a feature context -- and `users` is
-- `identity`'s table. A kernel-owned table with a kernel-owned repository keeps the resolution
-- entirely inside the kernel instead of smuggling an `identity` read into it, which is the same
-- reason `User implements TokenSubject` rather than `JwtService` importing `User`.
--
-- WHY NOT IN THE JWT. A capability set embedded in a signed token is an allow-list the holder
-- carries: narrowing somebody's access would not take effect until their token expired, and every
-- issued token would be a standing snapshot of a policy that has since changed. Server-side lookup
-- makes a revocation take effect on the next request, which is what an access control that exists
-- to be used in an incident has to do. The token shape is deliberately unchanged by this migration
-- -- it still carries identity and the coarse role, exactly as V61's warning about client-selected
-- bundles requires.
--
-- WHY THE VALUE IS A JSON ARRAY RATHER THAN A JOIN TABLE. The document is read whole, on every
-- request, for one user, and is never queried across users -- "who holds tickets:write" is a report
-- nobody has asked for. A row per grant would turn one primary-key lookup into a join for no gain
-- and would make "granted nothing" indistinguishable from "not scoped", which is precisely the
-- distinction the resolver turns on. The CHECK below is what stops the column from holding a shape
-- the resolver would have to guess at; see the fail-closed note on `permissions`.
--
-- Seeds nothing. On every existing deployment this table is empty on the morning after deploy, and
-- an empty table means every back-office account keeps exactly the access it had -- which is the
-- only safe way to introduce an access-control mechanism into a running platform.

CREATE TABLE back_office_permissions (
    user_id     uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    permissions jsonb       NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  uuid        REFERENCES users (id) ON DELETE SET NULL,
    CONSTRAINT back_office_permissions_is_array CHECK (jsonb_typeof(permissions) = 'array')
);

COMMENT ON TABLE back_office_permissions IS
    'Per-account narrowing of back-office access (D192/D13). One row scopes one staff or admin '
    'account; NO ROW is the normal state and means "not scoped -- the compiled-in role baseline '
    'applies". Resolved per request by security/AccountPermissions, which intersects this document '
    'with the baseline for the caller''s role, so the row can only ever subtract. It is never '
    'consulted instead of a @PreAuthorize role guard, only in addition to one.';

COMMENT ON COLUMN back_office_permissions.user_id IS
    'The account this document scopes. Also the primary key: an account has one permission document '
    'or none. Selected from the JWT ''sub'' of the signature-verified principal and from nothing '
    'else -- a document addressed by anything the client sends would be an allow-list the client '
    'could opt out of (V61).';

COMMENT ON COLUMN back_office_permissions.permissions IS
    'JSON array of "module:action" atoms from security/BackOfficePermissions, e.g. '
    '["tickets:read","tickets:write","users:read"]. Names outside that catalogue are refused by the '
    'write endpoint with 422 rather than stored, so this column cannot accumulate the kind of '
    'inert, meaningful-looking policy that V61 had to delete. An empty array is legal and means '
    '"this account may reach no guarded back-office route"; that is a deliberate state, which is '
    'why it is distinguished from having no row at all. A value the resolver cannot read as an '
    'array of strings DENIES everything for this one account rather than falling back to the '
    'baseline -- unlike settings.permissions, whose fallback is platform-wide and whose absence '
    'must not be able to take the back office down, a malformed row here can only arrive by direct '
    'database edit and can only affect the one account it names.';

COMMENT ON COLUMN back_office_permissions.updated_by IS
    'The administrator who last wrote this document. Nullable and ON DELETE SET NULL: the record of '
    'who scoped an account must survive that administrator''s own account being removed, and losing '
    'the attribution is a smaller loss than losing the scoping.';

-- ===========================================================================
-- staff_account_approvals
-- ===========================================================================
-- D200 (half 2): a staff or admin account minted through `POST /users/staff` cannot authenticate
-- until a SECOND administrator approves it.
--
-- WHAT THIS CLOSES. D192 made permission narrowing real: the document is re-read per request, so an
-- account genuinely loses the modules it was scoped out of. What it did not take away was the
-- ability to create ANOTHER account. An administrator narrowed down to `users:write` could
-- `POST /users/staff`, mint a fresh administrator -- which has no row in `back_office_permissions`
-- and therefore resolves to the FULL role baseline -- sign in as it, and recover every module it
-- had just been scoped out of. Every call in that sequence is individually authorised, which is
-- exactly why no audit rule would flag it. The escalation is closed by making the new account
-- unable to authenticate at all until somebody who is not its creator says so.
--
-- WHY A ROW HERE RATHER THAN A COLUMN ON `users`. The same two reasons V65 gives, and the second is
-- again the load-bearing one. First, ABSENCE HAS TO MEAN SOMETHING: no row is "this account is not
-- subject to maker-checker", which is every account that exists on the morning after this migration
-- and every consumer account forever. A nullable `users.approved_at` would have had to answer
-- "never approved" and "never needed approving" with the same NULL, and the login gate would then
-- have had to guess. Seeding nothing is what makes deploying this a no-op rather than an outage
-- that locks every existing colleague out of the back office. Second, the gate is read by
-- `identity.auth.AuthService` and the row is written by `moderation`; a kernel-owned table read
-- through a kernel-owned repository keeps `identity` (layer 0) from importing `moderation`
-- (layer 5), which `docs/system/package-structure.md` §2 forbids outright.
--
-- WHY THE CHECKER CONSTRAINT IS IN THE DATABASE AND NOT ONLY IN THE SERVICE. `StaffAccountApproval`
-- refuses a self-approval before it ever reaches SQL, and that is where the useful 403 comes from.
-- But maker-checker is a two-key rule and a two-key rule enforced in exactly one place is a
-- one-key rule with extra steps: a future batch job, a repair script or a second write path would
-- silently satisfy nobody but itself. `approved_by <> created_by` is an invariant of the DATA, so
-- it belongs with the data. The pair CHECK is there for the same reason -- an approval with a
-- decider and no timestamp, or a timestamp and no decider, is half a decision, and half a decision
-- read by the login gate as "approved" is the whole vulnerability back again.
--
-- WHY `ON DELETE RESTRICT` ON BOTH ACTORS, AND CASCADE ON THE SUBJECT. Users are never hard-deleted
-- on this platform (`SoftDeleteEntity`; erasure pseudonymises and archives, it does not DELETE), so
-- RESTRICT costs nothing operationally and refuses to let the record of WHO approved an account be
-- silently dropped -- which is the one fact a later dispute turns on. That is the correction D202
-- records against V63's evidence table, applied here at the outset rather than in a later
-- migration. The subject cascades because an approval for an account that does not exist is not a
-- record of anything.
--
-- WHY NO BOOTSTRAP ROW IS SEEDED. The very first administrator on a fresh install cannot be
-- approved by a peer, and an approval requirement nobody can satisfy is a lockout, not a control.
-- The escape is decided in Java, per creation, and it is deliberately NOT expressed as an
-- auto-approved row: `approved_by = created_by` would be a lie about a two-key decision, and the
-- CHECK above refuses it on purpose. See `UserAdminService#addStaff` for the predicate and the
-- reasoning; the short version is that a creation writes NO row -- the same "not subject to
-- maker-checker" reading as every pre-existing account -- exactly when no other admin-role account
-- exists at all.

CREATE TABLE staff_account_approvals (
    user_id     uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    created_by  uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at  timestamptz NOT NULL DEFAULT now(),
    approved_by uuid        REFERENCES users (id) ON DELETE RESTRICT,
    approved_at timestamptz,
    CONSTRAINT staff_account_approvals_checker_is_not_maker
        CHECK (approved_by IS NULL OR approved_by <> created_by),
    CONSTRAINT staff_account_approvals_decision_is_whole
        CHECK ((approved_by IS NULL) = (approved_at IS NULL))
);

-- The only query shape: "which accounts are still waiting". Partial, because the approved rows are
-- history and are never listed -- an index over them would be the whole table for a screen that
-- shows none of it.
CREATE INDEX idx_staff_account_approvals_pending
    ON staff_account_approvals (created_at)
    WHERE approved_at IS NULL;

-- ---------------------------------------------------------------------------
-- V69 — correct V67's description of what an unapproved row actually blocks (D200).
--
-- V67's table COMMENT claimed a pending row "BLOCKS AUTHENTICATION for that account on every login
-- path". That was not true when it was written. The gate lived in AuthService#issueFor, which the
-- OTP and staff-password flows both funnel through — but POST /auth/refresh mints an access token
-- directly from jwtService and never consulted the table. A held account with a live refresh token
-- would have kept minting access tokens for the whole refresh TTL.
--
-- It was unexploitable in practice, and the reason is worth writing down because it is the kind of
-- safety that evaporates without anyone touching the line that provides it: the only writer of an
-- approval row is UserAdminService#addStaff, which writes it in the same transaction that inserts
-- the user, so no token could predate the hold. That is a property of today's write paths, not an
-- invariant anything enforces. The first time someone holds an *existing* account — the obvious
-- incident-response use, and one this table's own COMMENT invites — the gap becomes live.
--
-- The gate is now called from refresh() as well, so the guarantee is real rather than accidental.
-- The corrected sentence is the one recorded below, because it is the database that gets read by
-- someone inspecting the schema rather than the source. V67's original wording is superseded here;
-- in the old chain it was amended by a follow-up migration rather than rewritten in place, because
-- rewriting an applied migration only trades a wrong comment for a checksum mismatch on every
-- machine that has run it.
COMMENT ON TABLE staff_account_approvals IS
    'Maker-checker on back-office account creation (D200). One row per account minted through '
    'POST /users/staff. A row with approved_at IS NULL BLOCKS AUTHENTICATION for that account on '
    'all three token-issuing paths: mobile-OTP login, staff password login, and refresh rotation. '
    'NO ROW means the account is not subject to maker-checker, which is the state of every account '
    'created before V67 and of every consumer account. Read by identity/auth/AuthService, written '
    'by moderation/user/UserAdminService.';

COMMENT ON COLUMN staff_account_approvals.created_by IS
    'The administrator who minted the account. NOT NULL and RESTRICT: this is one half of the '
    'two-key record, and an approval whose maker cannot be named is not evidence of anything.';

COMMENT ON COLUMN staff_account_approvals.approved_by IS
    'The SECOND administrator who let the account authenticate. NULL until then. The CHECK forbids '
    'it equalling created_by -- enforced here as well as in the service, because a two-key rule '
    'enforced in one place is a one-key rule.';

COMMENT ON COLUMN staff_account_approvals.approved_at IS
    'When the second key turned. Constrained to be present exactly when approved_by is, because '
    'half a decision read as a whole one is the vulnerability this table exists to close.';

-- ===========================================================================
-- staff_invites
-- ===========================================================================
-- D206: the second key signs for a PERSON, not a record.
--
-- WHAT THIS CLOSES. V67 made a newly minted back-office account unable to authenticate until a
-- second administrator co-signed it. What it did not take away was the maker's ability to choose
-- that account's password: `StaffCreate` carried a `password` field, so the administrator who
-- minted the account also knew the credential it would sign in with. The co-signature therefore
-- attested to a ROW -- "an account with this name and role should exist" -- and not to a HUMAN
-- BEING, because the person who would actually be holding it was never involved. A maker could
-- mint a colleague, have a peer approve it in good faith, and then sign in as that colleague; the
-- peer's name is on the decision and the maker holds the session.
--
-- The fix is that NEITHER administrator ever sets or learns the credential. The account is created
-- with no password hash at all, and a single-use, time-limited invite is issued to the person the
-- account is for. They set their own password by redeeming it. The maker has no field to type a
-- password into, and the checker is handed nothing but a decision.
--
-- WHY THE RAW TOKEN IS NOT IN THIS TABLE. Only `sha256(secret)` is stored, for the same reason
-- `refresh_tokens.token_hash` and `otp_codes.code_hash` hold digests: a dump of this table must not
-- be replayable. The token handed to the invitee is `<id>.<secret>` -- the id is a SELECTOR used to
-- fetch exactly one row, and the secret is then compared with `MessageDigest.isEqual`, which is
-- constant-time. Looking a token up BY its hash would have worked too, but the comparison would
-- then be the database's `=` on an indexed column, which is neither constant-time nor ours.
--
-- WHY `user_id` IS UNIQUE RATHER THAN THE PRIMARY KEY. The id has to be an independent selector the
-- token can carry, and a token that carried the user id would name the account it belongs to in
-- plain sight -- an enumeration surface handed out by design. UNIQUE then enforces ONE INVITE PER
-- ACCOUNT, EVER -- not merely one open one. That is deliberately the strictest reading available
-- today, because there is no reissue route to write a second row: an invite that expires unredeemed
-- currently strands the account, and the operator's remedy is to archive it and mint another. A
-- reissue endpoint is the obvious next step and will need its own migration to relax this to a
-- partial unique index over the open rows; until it exists, the loose constraint would only be
-- permission for a second write path nobody has reviewed.
--
-- WHY AN UNREDEEMED ROW BLOCKS AUTHENTICATION, ON TOP OF THE APPROVAL ROW. An account with no
-- password is not thereby unreachable: it has a mobile number, and mobile-OTP login needs no
-- password whatsoever. A maker who typed their OWN number into the create form would hold the
-- account outright the moment the checker approved it. So `identity.auth.AuthService` refuses to
-- issue a token for an account whose invite is still open, on all three issuing paths -- the same
-- shape as V67's gate, and for the same reason: an account that can obtain a session is a foothold
-- regardless of what it is currently permitted to do.
--
-- WHY EXPIRY IS A COLUMN AND NOT A POLICY IN JAVA. An invite that never expires is a credential
-- lying around in somebody's SMS history forever. The TTL is applied when the row is written, so
-- changing the policy later cannot retroactively extend an invite already in flight, and a reader
-- of this table can see when each one dies without reading any code.
--
-- ON DELETE: the subject cascades (an invite to an account that does not exist is a record of
-- nothing); the issuer RESTRICTs, matching V67 -- who issued a credential is the fact a later
-- dispute turns on, and users are never hard-deleted on this platform anyway (erasure
-- pseudonymises and archives).

CREATE TABLE staff_invites (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid        NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
    token_hash  text        NOT NULL,
    created_by  uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL,
    redeemed_at timestamptz,
    CONSTRAINT staff_invites_expires_after_issue CHECK (expires_at > created_at)
);

-- The only query shape that scans: "which invites are still open". Partial, because a redeemed row
-- is history and nothing lists it -- an index over those would be the whole table for a question
-- that excludes them.
CREATE INDEX idx_staff_invites_open
    ON staff_invites (expires_at)
    WHERE redeemed_at IS NULL;

COMMENT ON TABLE staff_invites IS
    'Single-use credential invites for back-office accounts (D206). One row per account minted '
    'through POST /users/staff. A row with redeemed_at IS NULL BLOCKS AUTHENTICATION for that '
    'account on every login path, exactly as an unapproved staff_account_approvals row does, and '
    'for the same reason: the account has no usable password yet and a passwordless account is '
    'still reachable over mobile OTP. NO ROW means the account is not subject to the invite flow, '
    'which is the state of every account created before this migration and of every consumer '
    'account. Read by identity/auth/AuthService, written and redeemed by '
    'identity/auth/StaffInviteService.';

COMMENT ON COLUMN staff_invites.id IS
    'Selector half of the token handed to the invitee (`<id>.<secret>`). Public by construction; it '
    'names no account, which is why it is safe to put in a token and why user_id is not the key.';

COMMENT ON COLUMN staff_invites.token_hash IS
    'sha256(secret) -- the secret half of the token, NEVER the token itself. Compared with '
    'MessageDigest.isEqual so the verify path leaks no timing signal about how much of a guess '
    'matched.';

COMMENT ON COLUMN staff_invites.created_by IS
    'The administrator who minted the account. Recorded for the audit trail only: this person is '
    'deliberately never told the token and cannot set the password, which is the whole of D206.';

COMMENT ON COLUMN staff_invites.redeemed_at IS
    'When the invitee set their own password. NULL means the invite is open, which blocks login. '
    'One-way and single-use: a redeemed invite is refused for the rest of its life.';

-- ===========================================================================
-- notification_preferences
-- ===========================================================================
-- Notification preferences get a server home (D94, D15).
--
-- WHAT WAS BROKEN. `getNotifPrefs`/`setNotifPrefs`/`inQuietHours` have existed in the browser since
-- the settings screen shipped: three delivery-channel switches, a master `matchAlerts` switch, a
-- quiet-hours window and a language. All of it lived in localStorage, under a key suffixed with the
-- user's mobile number, and the server had never been told any of it. The consequence was not
-- cosmetic. `Notifications.jsx` suppresses the alerts IT derives while `inQuietHours()` is true, so
-- the user is shown a product that honours a 22:00-07:00 window -- and then the server writes an
-- offer, a moderation verdict or a message notification at 03:00 and it is simply there. The
-- promise was kept by exactly the half of the system that generates the least of the traffic.
--
-- ONE ROW PER USER, KEYED BY THE USER. No surrogate id, for the reason `owner_kyc` and
-- `ownership_bases` give: a user has exactly one set of preferences, and a surrogate key would
-- permit two, which introduces the question "which of these is in force?" that nothing in the
-- product can answer. The primary key IS the answer.
--
-- ABSENT ROW == TODAY'S DEFAULTS, NOT SILENCE. This is the failure mode worth naming, because it is
-- the one that would be discovered by users rather than by tests. Every account that exists today
-- has no row here and will not have one until it opens Settings and changes something. If the
-- server read a missing row as "all switches off" it would mute the entire platform's notifications
-- for its entire existing user base on deploy, and every one of those notifications is lost rather
-- than delayed. So the reader (`NotificationPreferenceService.effective`) resolves an absent row to
-- the same constants the browser has always defaulted to, and these column defaults repeat them so
-- that a row created by raw SQL cannot disagree with a row created by the application. The two
-- copies are pinned against each other by `NotificationPreferencesEndpointTest`, which reads back a
-- row inserted naming nothing but the user.
--
-- WHY THE QUIET WINDOW IS TEXT AND NOT `time`. The value is a wall-clock label -- "22:00" -- with no
-- date and no zone, and Postgres `time` would be a marginally tighter spelling of exactly that. The
-- deciding argument is the wire: the browser has always stored and sent `'22:00'`, the `<input
-- type="time">` that produces it emits `HH:mm`, and a `time` column round-trips as `22:00:00`. That
-- extra `:00` would either have to be trimmed on the way out (a formatting rule in the mapper, i.e.
-- a place for the two representations to drift) or accepted into the contract (changing a value the
-- client already persists). A CHECK constraint buys the validation `time` would have given us
-- without touching the shape the client agreed to.
--
-- WHY `start == end` IS ALLOWED AND MEANS "NEVER". Rejecting it would be defensible, but the
-- browser's `inQuietHours` already returns false for it and a user who drags both ends together is
-- expressing "no window", not committing an error. Fifteen minutes of quiet is expressible; zero
-- minutes has to be too, or the only way to express it is the `enabled` flag, and then two controls
-- disagree about the same fact. The Java side (`QuietHours.deferUntil`) makes the same call.
CREATE TABLE notification_preferences (
    user_id             uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    email               boolean NOT NULL DEFAULT true,
    sms                 boolean NOT NULL DEFAULT false,
    whatsapp            boolean NOT NULL DEFAULT true,
    match_alerts        boolean NOT NULL DEFAULT true,
    quiet_hours_enabled boolean NOT NULL DEFAULT false,
    quiet_start         text    NOT NULL DEFAULT '22:00',
    quiet_end           text    NOT NULL DEFAULT '07:00',
    language            text    NOT NULL DEFAULT 'en',
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT notification_preferences_quiet_start_check
        CHECK (quiet_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    CONSTRAINT notification_preferences_quiet_end_check
        CHECK (quiet_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    CONSTRAINT notification_preferences_language_check
        CHECK (language IN ('en', 'hi', 'mr'))
);

COMMENT ON TABLE notification_preferences IS
    'One row per user; absent means the defaults in NotificationPreferenceService. Read by '
    'NotificationPublisher on every server-written notification (D94).';
COMMENT ON COLUMN notification_preferences.match_alerts IS
    'The master switch for saved-search/price alerts only. It does not silence transactional '
    'notifications -- an offer on your listing is not an alert you opted into, it is an event you '
    'are a party to, and a user who muted match alerts has not asked to stop hearing about those.';
COMMENT ON COLUMN notification_preferences.email IS
    'Channel switch. Carried and returned; NOT YET consulted by any server code, because nothing on '
    'the server sends email, SMS or WhatsApp today -- the Notifier port writes an in-app inbox row '
    'and nothing else. Persisting them now means the switches the user already sets survive the '
    'move off localStorage, and the first real sender inherits an answer instead of a migration.';
COMMENT ON COLUMN notification_preferences.language IS
    'The language the platform should address this user in. Same caveat as the channel switches: '
    'stored and returned, with no server-side renderer consuming it yet.';

-- ===========================================================================
-- erasure_requests
-- ===========================================================================
-- V56 erasure_requests — the DPDP right-to-erasure spine (D177).
--
-- WHAT THE LAW ACTUALLY ASKS FOR
-- ------------------------------
-- Digital Personal Data Protection Act 2023 s.12(3) gives a Data Principal the right to have their
-- personal data erased. s.8(7) is the boundary and the more interesting half: the Data Fiduciary
-- must erase on withdrawal of consent or when the purpose is served, "unless retention is necessary
-- for compliance with any law for the time being in force". So the obligation is not "delete the
-- person's rows"; it is "stop being able to identify them, except where another statute requires
-- you to keep identifying them, and be able to say which is which".
--
-- That last clause is why this is a table and not a DELETE statement. A platform that erases and
-- keeps no record of having erased cannot answer a Data Principal who asks whether it complied, and
-- cannot show a regulator what it kept or why. A platform that keeps a record naming the person has
-- built a directory of everybody who asked to be forgotten, which is worse than the original problem.
--
-- HOW THE AUDIT RECORD AVOIDS BEING A RE-IDENTIFICATION SURFACE
-- ------------------------------------------------------------
-- `subject_id` is a live FK to users(id) while the request is pending -- it has to be; nothing could
-- be executed otherwise -- and is set to NULL at execution. What survives is `subject_digest`:
-- SHA-256 over a deployment-held pepper and the subject's UUID. It is a *verifier*, not an index.
-- Given a UUID you can confirm "yes, this request concerned that account"; given the table you
-- cannot enumerate who was erased, because the pre-images are 128-bit random UUIDs and the pepper is
-- not in the database. That asymmetry is the whole design: the record can answer the one question
-- accountability needs answered and none of the questions that would make it a leak.
--
-- The digest deliberately does NOT key off the mobile number. A mobile is a ten-digit value from a
-- space small enough to enumerate exhaustively in seconds, so a digest of one is a reversible
-- pointer to the person wearing a hash's clothing. The UUID is the only identifier here whose
-- pre-image space is large enough for a digest to mean anything.
--
-- WHY A REQUEST ROW AND NOT AN IMMEDIATE DELETE ON THE ENDPOINT
-- ------------------------------------------------------------
-- Erasure is the one destructive act on this platform that cannot be undone by the person it was
-- done to -- afterwards there is no account left to appeal from. Three things need to happen between
-- the ask and the act, and none of them fits inside a request handler: a cooling-off window (a
-- tapped button, a coerced tenant, a compromised session), a check for live obligations (an open
-- tenancy, an unsettled payment), and a human decision recorded against a named admin. The row is
-- where those live.
--
-- `erased` and `retained` are written at execution and are the substance of the record: what was
-- removed, table by table with row counts, and what was kept, category by category with the statute
-- that required keeping it. Counts and category names only -- never a value, never a column's
-- contents. "We kept 3 rent agreements under the Limitation Act" is accountability; the addresses on
-- them would be the leak this table exists to avoid.
--
-- ON DELETE: nothing here cascades from users. That is the point -- the audit record must outlive
-- the account, and a cascade would delete the proof of erasure along with the thing erased.
CREATE TABLE erasure_requests (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The subject, while the request is live. NULLed at execution; `subject_digest` takes over.
    -- Nullable from the start rather than NOT NULL + a sentinel, because "this request no longer
    -- names anybody" is exactly what NULL means and a sentinel UUID would need its own explanation.
    subject_id     uuid REFERENCES users(id),

    -- SHA-256(pepper || subject_id), lowercase hex. Survives execution. See the header.
    subject_digest text        NOT NULL,

    status         text        NOT NULL DEFAULT 'pending',
    reason         text,                              -- the subject's own words, optional

    requested_at   timestamptz NOT NULL DEFAULT now(),

    -- The deciding admin. Kept in the clear, unlike the subject: this half of the row is ops
    -- accountability, and an anonymous erasure decision is a power nobody can be held to. Staff
    -- acting in role are not the Data Principal this table is protecting.
    decided_by     uuid REFERENCES users(id),
    decided_at     timestamptz,
    decision_note  text,

    -- What was removed / kept. Counts and category names, never values.
    erased         jsonb       NOT NULL DEFAULT '{}'::jsonb,
    retained       jsonb       NOT NULL DEFAULT '{}'::jsonb,

    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT erasure_requests_status_check
        CHECK (status IN ('pending', 'completed', 'rejected')),

    -- A completed request must not still name its subject. This is the invariant the whole design
    -- rests on, so it is enforced by the database rather than by remembering to call the right
    -- method: a future writer that forgets to NULL `subject_id` gets a constraint violation instead
    -- of quietly leaving a directory of erased people behind.
    CONSTRAINT erasure_requests_completed_is_anonymous
        CHECK (status <> 'completed' OR subject_id IS NULL),

    -- A decided request records who decided it and when. Half a decision is not a decision.
    CONSTRAINT erasure_requests_decided_is_attributed
        CHECK (status = 'pending' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL))
);

-- One live request per subject. Without it, a subject tapping twice files two requests and the
-- second executes against an account the first already emptied -- recording a second erasure that
-- erased nothing, which is a false entry in the one table that exists to be true.
-- Partial, because completed requests keep subject_id NULL and NULLs are not equal to each other
-- anyway; being explicit says which state the rule is about.
CREATE UNIQUE INDEX uq_erasure_requests_live_subject
    ON erasure_requests (subject_id)
    WHERE status = 'pending' AND subject_id IS NOT NULL;

-- The admin queue reads pending-first, newest-first.
CREATE INDEX idx_erasure_requests_status_requested
    ON erasure_requests (status, requested_at DESC);

-- "Did you erase me?" answered from a UUID the asker already holds.
CREATE INDEX idx_erasure_requests_digest
    ON erasure_requests (subject_digest);

COMMENT ON TABLE erasure_requests IS
    'DPDP s.12(3) erasure requests. subject_id is live only while pending; a completed row is '
    'identified solely by subject_digest = SHA-256(pepper || subject uuid), which verifies a '
    'known id but cannot enumerate erased subjects. erased/retained hold counts and category '
    'names only.';

COMMENT ON COLUMN erasure_requests.retained IS
    'Category -> statutory basis for keeping it. Written at execution so the reason travels with '
    'the decision rather than living only in code that may later change.';

-- NOTE ON users.mobile, WHICH IS THE ONE COLUMN ERASURE CANNOT SIMPLY BLANK
-- ------------------------------------------------------------------------
-- It is NOT NULL, UNIQUE, and CHECKed against '^[6-9][0-9]{9}$' (V2). All three must keep holding
-- after erasure, so the number cannot be NULLed and two erased users cannot collapse onto one
-- shared placeholder. The service therefore writes a deterministic pseudonym derived from the row's
-- own id -- see ErasureService.pseudonymMobile, where the derivation and its limits are set out.
--
-- The pseudonym is computed in Java rather than by a SQL function on purpose: it is a rule about
-- what a value means, it needs a unit test that can go red, and a function here would be a second
-- place for that rule to live and drift.
--
-- No schema change is made to relax the CHECK. Relaxing a constraint that holds for every real row
-- on the platform, in order to accommodate a handful of erased ones, would weaken the column's
-- guarantee everywhere to make one code path tidier.

SELECT install_updated_at_triggers();
