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

COMMENT ON TABLE staff_account_approvals IS
    'Maker-checker on back-office account creation (D200). One row per account minted through '
    'POST /users/staff. A row with approved_at IS NULL BLOCKS AUTHENTICATION for that account on '
    'every login path; NO ROW means the account is not subject to maker-checker, which is the '
    'state of every account created before this migration and of every consumer account. Read by '
    'identity/auth/AuthService, written by moderation/user/UserAdminService.';

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
