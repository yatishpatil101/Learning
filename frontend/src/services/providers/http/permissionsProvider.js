import { get, put } from '../../http.js';

// The console must have no opinion of its own about access: anything composed client-side is a
// union and can only widen, while the server's model may only narrow a role's baseline.

export const getFunctionCatalogue = () => get('/admin/function-catalogue');

/** One member's document: what was granted, and what that resolves to against their role. */
export const getMemberPermissions = (userId) => get(`/users/${userId}/permissions`);

// `PUT` replaces rather than patches because a function set is one decision — the intermediate
// state of a narrowing edit is a grant. An empty array means dashboard only.
export const saveMemberFunctions = (userId, functions) =>
  put(`/users/${userId}/permissions`, { functions });
