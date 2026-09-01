/**
 * Users — the back office's view of everybody who is not a colleague (D210/V77).
 *
 * `teamService.js` is the neighbouring seam and the distinction is worth stating, because the two
 * sit on the same `/users` routes: **Team & Access administers colleagues** (create a staff account,
 * approve it, archive it), while this one is the moderator's view of *consumers* — owners, buyers
 * and tenants — plus the four decisions taken about them. Splitting them keeps each screen's
 * provider readable and matches how the console is actually navigated.
 *
 * The page behind this called `lib/mockApi.js` directly until D210, which meant five row actions
 * were writing to the browser's copy of the database. Four of them had no server behind them at
 * all; the conversion forced the choice between recording the loss and building them, and V77
 * built them.
 *
 * Endpoints behind the http provider:
 *
 *   listUsers        GET   /users?role=&status=&flagged=&q=&archived=   (paged, mobiles masked)
 *   getUserTimeline  GET   /users/{id}/timeline                         (capped at 50, newest first)
 *   setUserBadge     PATCH /users/{id}/badge                            (409 = Aadhaar-earned)
 *   setUserStatus    PATCH /users/{id}/suspend | /reactivate            (403 self, 409 archived)
 *                    PATCH /users/{id}/archive | /restore
 *   setUserFlag      PATCH /users/{id}/flag                             (422 = no reason)
 *
 * ## Two shapes the server will not produce, and are therefore not invented here
 *
 * - **`listings`** — the mock's per-row listing count. `User` carries `listingsCount`, so this one
 *   survives; it is named here only because the column header says "Listings" and the two spellings
 *   differ.
 * - **`city`** — absent from the contract's `User` on consumer accounts more often than not. The
 *   provider passes through whatever is there and the page renders an em-dash for the rest, rather
 *   than guessing from the listings.
 *
 * ## Why `status` and `archived` are separate arguments
 *
 * They are separate columns and mean different things: `archived` is the soft delete, `status` is
 * `active | suspended`. The console's single "All statuses" picker collapses them, so the provider
 * translates — picking `archived` sends `archived=true`, anything else sends `archived=false` plus
 * the status. Sending both as one filter would make "suspended" quietly exclude suspended accounts
 * that had later been archived, which is the population a moderator is most likely to be looking
 * for.
 */
import { createProvider } from './config.js';

const provider = createProvider('users');

/**
 * The consumer directory, one page at a time.
 *
 * @param {{role?:string, status?:string, q?:string, page?:number, size?:number}} [opts]
 * @returns {Promise<{items:object[], total:number, page:number, size:number}>}
 */
export const listUsers = async (...args) => (await provider()).listUsers(...args);

/**
 * What this person has done: account creation, enquiries, visits, service requests, listings and
 * the moderation actions taken against them, newest first and capped at 50.
 *
 * Not paged, on purpose — see the contract. Entries carry `{ kind, entityId, at, label, status }`
 * and deliberately no sentence: the console words each line from `kind`, in the operator's
 * language.
 */
export const getUserTimeline = async (...args) => (await provider()).getUserTimeline(...args);

/**
 * Grant or withdraw the Verified badge by hand.
 *
 * A reason is mandatory. Withdrawing a badge that was earned through Aadhaar is a 409 the console
 * must show rather than swallow: nothing would restore it, because the verification webhook returns
 * early on an already-verified row.
 */
export const setUserBadge = async (...args) => (await provider()).setUserBadge(...args);

/**
 * One of `'suspend'`, `'reactivate'`, `'archive'`, `'restore'` — the action, not the desired state.
 *
 * `'active'` would be ambiguous, because it is the answer to both un-suspending and un-archiving,
 * and the server refuses to guess: reactivating an archived account is a 409 that says to restore it
 * first. Suspension is also the only one of the four that changes what the platform *does* — it ends
 * live sessions and is refused at every path that mints a new one, while archiving is a soft delete
 * that leaves sign-in alone.
 */
export const setUserStatus = async (...args) => (await provider()).setUserStatus(...args);

/** Raise or lower the internal review flag. A reason is required to raise one; 422 without it. */
export const setUserFlag = async (...args) => (await provider()).setUserFlag(...args);
