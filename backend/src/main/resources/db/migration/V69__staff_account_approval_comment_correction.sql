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
-- This migration exists because the wrong sentence is in the database, where it will be read by
-- someone inspecting the schema rather than the source. V67 is amended here rather than in place
-- because it has already been applied, and rewriting an applied migration only trades a wrong
-- comment for a checksum mismatch on every machine that has run it.
COMMENT ON TABLE staff_account_approvals IS
    'Maker-checker on back-office account creation (D200). One row per account minted through '
    'POST /users/staff. A row with approved_at IS NULL BLOCKS AUTHENTICATION for that account on '
    'all three token-issuing paths: mobile-OTP login, staff password login, and refresh rotation. '
    'NO ROW means the account is not subject to maker-checker, which is the state of every account '
    'created before V67 and of every consumer account. Read by identity/auth/AuthService, written '
    'by moderation/user/UserAdminService.';
