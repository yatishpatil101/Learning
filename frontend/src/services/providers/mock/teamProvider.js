/**
 * Mock team provider — the localStorage counterpart to `providers/http/teamProvider.js`.
 *
 * Storage and rules both live in `lib/mockApi/team.js`, which is where the fake server is: this
 * file only adapts names and argument order, the same way `mock/reportProvider.js` sits over
 * `lib/data/reports.js`. Read that module for the refusal wording — it is the server's, verbatim.
 *
 * ## What this mock now enforces (D205)
 *
 * 1. **The last-administrator floor.** Archiving, suspending or demoting the final administrator
 *    is refused with the server's own 409, instead of succeeding and reporting success.
 * 2. **No self-archive.** 403, as `UserAdminService` answers before it reaches the floor.
 * 3. **Maker-checker on creation.** A new `staff`/`admin` account raised while another
 *    administrator exists is parked awaiting a second signature, with the bootstrap escape the
 *    server has — nobody to countersign means no queue.
 * 4. **The approval queue, in the server's order and with its refusals**: unknown id (404),
 *    archived approver (403), not waiting (409), already approved (409), and approver-is-creator
 *    (403). Approval is not idempotent here either.
 * 5. **Only the contract's roles on create.** `manager` is refused with the server's 403; it is an
 *    admin-console permission label, not an auth role (contract: `Role = buyer|owner|staff|admin`).
 * 6. **No hard delete.** The mock used to drop the row. There is no `DELETE /users/{id}`; archive
 *    is the removal, so `deleteTeamMember` is gone rather than reimplemented.
 *
 * ## What it still cannot reproduce — read this before trusting a green run
 *
 * - **`users:write` capability.** The server's floor counts administrators who still hold that
 *   permission after their D192 permission document applies; there are no permission documents
 *   here, so every live administrator is assumed capable. The mock's administrator set is a
 *   *superset* of the server's, so this floor lifts later than the real one — the one remaining
 *   asymmetry in the permissive direction. A console that narrows an administrator's grants can
 *   reach a state here that the server refuses.
 * - **Per-request permission resolution and the advisory lock.** D192 resolves grants per request
 *   and D200 holds `FLOOR_LOCK` while it counts, so two concurrent archives cannot both pass. A
 *   single-tab localStorage store has neither; nothing here is safe under two tabs.
 * - **`moduleAccess`, `roleId` and custom roles.** Console-local, and unwired to
 *   `PUT /users/{id}/permissions` on either provider. They compose a *widening* union while the
 *   server's permission map may only narrow (D67), so they are navigation tidying, not access.
 * - **Staff sign-in.** `pages/consumer/StaffLogin.jsx` reads `getTeamMemberByMobile` straight off
 *   this store and does not consult `approval`, so an account still waiting for its second
 *   signature can sign in on mocks. Hiding it there would be worse — that page falls back to a
 *   user-picked role when the lookup answers null — so it is left alone and named here instead.
 */
import {
  approveTeamMember as _approve,
  listPendingApprovals as _pending,
  listTeamMembers as _list,
  saveTeamMember as _save,
  setTeamMemberStatus as _setStatus,
} from '../../../lib/mockApi.js';

export async function listTeamMembers() {
  return _list();
}

/**
 * `previous` is ignored: the store holds the row already, so it re-reads it rather than trusting a
 * caller-supplied copy. The http provider needs the argument because the wire cannot tell it what
 * changed without a second, individually-audited read.
 */
export async function saveTeamMember(member) {
  return _save(member);
}

export async function setTeamMemberStatus(id, status) {
  return _setStatus(id, status);
}

export async function listPendingApprovals() {
  return _pending();
}

export async function approveTeamMember(id) {
  return _approve(id);
}
