-- At most one LIVE account per email address.
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
