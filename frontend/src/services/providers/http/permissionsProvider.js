import { get, put } from '../../http.js';

/**
 * The back-office permission model, over HTTP.
 *
 * <p>There is no mock counterpart to this provider, and there never will be. The console used to
 * decide access itself, in `lib/permissions.js`, by composing a base module set with a custom-role
 * bundle and a per-member override — a union, so every rule in it could only ever *widen*. The
 * server's model is the opposite: an administrator's document may only narrow what the role's
 * baseline already allows. Two rules that disagree about direction cannot both be the answer, so
 * the console stopped having an opinion and started asking.
 *
 * <p>Three routes, and the shape of the third is the whole point: `PUT` replaces the document
 * rather than patching it, because a permission set is one decision. Sending "add tickets:write"
 * separately from "remove finance:read" would make the intermediate state real, and the
 * intermediate state of a narrowing edit is a grant.
 */

/**
 * The atoms an administrator may hand out, in the order the grid should render them.
 *
 * Server-ordered on purpose: the sequence groups related modules together, and a console that
 * re-sorted it alphabetically would split `properties:read` from `properties:write`.
 */
export const getPermissionCatalogue = () => get('/admin/permission-catalogue');

/** One member's document: what was granted, and what that resolves to against their role. */
export const getMemberPermissions = (userId) => get(`/users/${userId}/permissions`);

/**
 * Replace one member's document.
 *
 * `permissions` is the full intended set. An empty array is meaningful — it means "no scoping",
 * i.e. fall back to the role's baseline — and is not the same as granting nothing.
 */
export const saveMemberPermissions = (userId, permissions) =>
  put(`/users/${userId}/permissions`, { permissions });
