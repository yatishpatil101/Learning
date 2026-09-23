/**
 * Team & Access — the internal back-office accounts the admin console administers.
 *
 * Every rule lives on the server: per-account permission grants, maker-checker on staff
 * creation, and the last-administrator floor held under an advisory lock. The console may
 * not restate any of them — the failure mode is not a missing feature but a *confident wrong
 * answer*, an administrator archiving the last administrator and being told it worked.
 *
 * Endpoints behind the provider — all `users:write` except the directory read:
 *
 *   listTeamMembers      GET   /users?role=&archived=        (paged, mobiles masked)
 *   saveTeamMember       POST  /users/staff                  (201) — create
 *                        PATCH /users/{id}                   — update, name + email only
 *   setTeamMemberStatus  PATCH /users/{id}/archive           (409 = last-administrator floor)
 *                        PATCH /users/{id}/restore
 *   listPendingApprovals GET   /users/pending-approvals      (unpaged, oldest first)
 *   approveTeamMember    POST  /users/{id}/approve           (403 self-approval, 409 not waiting)
 *
 * Both sides speak the console's `TeamMember` shape:
 *
 *   { id, name, mobile, email, role, roleId, moduleAccess[], teams[], status, createdAt, approval }
 *
 * `approval` is `{ createdBy, createdByName, createdAt, approvedAt }` while an account is waiting
 * for its second signature, and null otherwise. It is reconstructed from
 * `GET /users/pending-approvals` rather than read off a field, because the contract's `User` has no
 * `createdBy` — see the provider for what that costs the queue screen.
 *
 * **There is deliberately no `deleteTeamMember`.** The contract has no `DELETE /users/{id}` at all,
 * because this platform is soft-delete only. Archive *is* the removal, and it is what
 * `setTeamMemberStatus(id, 'suspended')` performs.
 *
 * Custom roles are **not** here on purpose: migration V61 deleted `settings.customRoles`, the
 * server refuses the key outright with 422 and there is no replacement route. The console's
 * navigation gate reads `GET /admin/permission-catalogue` instead.
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
