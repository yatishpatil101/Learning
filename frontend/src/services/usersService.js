/** `teamService.js` is the neighbouring seam and the distinction is worth stating, because the two sit on the same
 * `/users` routes. */
import { createProvider } from './config.js';

const provider = createProvider('users');

export const listUsers = async (...args) => (await provider()).listUsers(...args);

/** Not paged, on purpose — see the contract. Entries carry `{ kind, entityId, at, label, status }` and deliberately
 * no sentence: the console words each line from `kind`, in the operator's language. */
export const getUserTimeline = async (...args) => (await provider()).getUserTimeline(...args);

/** Withdrawing a badge that was earned through Aadhaar is a 409 the console must show rather than swallow: nothing
 * would restore it, because the verification webhook returns early on an already-verified row. */
export const setUserBadge = async (...args) => (await provider()).setUserBadge(...args);
export const listBadgeGrants = async (...args) => (await provider()).listBadgeGrants(...args);
export const approveBadgeGrant = async (...args) => (await provider()).approveBadgeGrant(...args);
export const rejectBadgeGrant = async (...args) => (await provider()).rejectBadgeGrant(...args);

/** `'active'` would be ambiguous, because it is the answer to both un-suspending and un-archiving, and the server
 * refuses to guess: reactivating an archived account is a 409 that says to restore it first. */
export const setUserStatus = async (...args) => (await provider()).setUserStatus(...args);

/** Raise or lower the internal review flag. A reason is required to raise one; 422 without it. */
export const setUserFlag = async (...args) => (await provider()).setUserFlag(...args);
