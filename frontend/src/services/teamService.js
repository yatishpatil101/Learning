/**
 * Team & Access — the internal back-office accounts the admin console administers (D205).
 *
 * The console used to call `lib/mockApi.js` directly, which meant every rule the server shipped in
 * D192 (per-account permission grants) and D200 (maker-checker on staff creation, plus the
 * last-administrator floor held under an advisory lock) was invisible to the product. The failure
 * mode was not a missing feature but a *confident wrong answer*: an administrator archived the last
 * administrator, the console said it worked, and the real server would have refused with a 409.
 *
 * Endpoints behind the http provider — all `users:write` except the directory read:
 *
 *   listTeamMembers      GET   /users?role=&archived=        (paged, mobiles masked)
 *   saveTeamMember       POST  /users/staff                  (201) — create
 *                        PATCH /users/{id}                   — update, name + email only
 *   setTeamMemberStatus  PATCH /users/{id}/archive           (409 = last-administrator floor)
 *                        PATCH /users/{id}/restore
 *   listPendingApprovals GET   /users/pending-approvals      (unpaged, oldest first)
 *   approveTeamMember    POST  /users/{id}/approve           (403 self-approval, 409 not waiting)
 *
 * Both providers speak the console's `TeamMember` shape:
 *
 *   { id, name, mobile, email, role, roleId, moduleAccess[], teams[], status, createdAt, approval }
 *
 * `approval` is `{ createdBy, createdByName, createdAt, approvedAt }` while an account is waiting
 * for its second signature, and null otherwise. Live it is reconstructed from
 * `GET /users/pending-approvals` rather than read off a field, because the contract's `User` has no
 * `createdBy` — see the provider for what that costs the queue screen.
 *
 * **There is deliberately no `deleteTeamMember`.** The mock had one and it removed the row; the
 * contract has no `DELETE /users/{id}` at all, because this platform is soft-delete only. Archive
 * *is* the removal, and it is what `setTeamMemberStatus(id, 'suspended')` performs.
 *
 * Custom roles (`listCustomRoles` and friends) are **not** here on purpose: the server refuses
 * `settings.customRoles` outright with 422 (D67) and has no replacement route, so there is nothing
 * for an http provider to call. They stay console-local reads against `lib/mockApi.js`.
 */
import { createProvider } from './config.js';

const provider = createProvider('team');

/** Every internal account, live and suspended, in console shape. */
export const listTeamMembers = async (...args) => (await provider()).listTeamMembers(...args);

/**
 * Create or update an internal account.
 *
 * @param {object} member    the form payload; `id` absent means create
 * @param {object} [previous] the stored record being edited, when there is one. Live it is the only
 *   way to tell whether the edit asks for something `PATCH /users/{id}` cannot carry — the route
 *   takes name, email and avatar, and nothing else. Without it a role change would be dropped
 *   silently and the console would report a success that never happened.
 */
export const saveTeamMember = async (...args) => (await provider()).saveTeamMember(...args);

/** `'suspended'` archives the account, `'active'` restores it. 409 when the floor refuses. */
export const setTeamMemberStatus = async (...args) => (await provider()).setTeamMemberStatus(...args);

/** Accounts minted through staff creation that still need a second administrator's signature. */
export const listPendingApprovals = async (...args) => (await provider()).listPendingApprovals(...args);

/** Turn the second key. Not idempotent — approving twice is a 409, by design. */
export const approveTeamMember = async (...args) => (await provider()).approveTeamMember(...args);
