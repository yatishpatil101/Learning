/**
 * Settings Service — the platform configuration document (`AdminSettings`).
 *
 * `GET /admin/settings` · `PUT /admin/settings` (both `x-roles: [admin]`).
 *
 * ## Why this domain exists
 *
 * It is the last one to get a seam, and it got one for the same reason every other domain did: two
 * consumers were reading the document straight out of `lib/mockApi.js`, so with `VITE_API_DOMAINS`
 * naming every domain the admin console *still* read its feature flags, fee schedule and geo policy
 * out of `data/db.json`. Every other screen was live; this one silently was not, and nothing said
 * so, because a direct import cannot be opted in or out — there is no switch to look at.
 *
 * The document is the SSOT for fees, feature flags and RBAC, which makes it the worst possible
 * place for that to be true: an operator toggling maintenance mode against a browser-local copy is
 * told it worked.
 *
 * ## Shape
 *
 * A bag of independently-stored blocks, not a fixed record — the server keeps one `settings` row
 * per top-level key and folds them into one document on read. `contactUnlockLimit`,
 * `kycBadgeEnabled`, `listingExpiryDays`, `boostEnabled`, `maintenanceMode`, `site`, `fees`,
 * `movePack`, `flags`, `adminFlags`, `permissions` — plus `geo`, which the contract does not
 * enumerate but the server stores like any other key.
 *
 * ## Writes merge; they do not replace
 *
 * `PUT` deep-merges: objects key by key, arrays and scalars replaced whole, absent keys left alone.
 * That is what makes `updateSettings({ flags })` safe to call from a panel that has only ever seen
 * the flags — under replace semantics it would wipe the fee table and the platform would start
 * charging its defaults.
 *
 * The corollary for callers: **send only the block you edited.** Posting the whole document back is
 * not equivalent, because a stale block you did not touch is still a value you are asserting.
 */
import { createProvider } from './config.js';

const provider = createProvider('settings');

/**
 * The whole configuration document.
 *
 * @returns {Promise<object>} every stored block, folded into one object
 */
export const getSettings = async () => (await provider()).getSettings();

/**
 * Merge `patch` into the stored document and resolve with the result.
 *
 * The **stored** document, not the patch — after clamping and merging, what is kept is not
 * necessarily what was sent, and a screen that renders its own optimistic copy will disagree with
 * the server the moment one value is corrected.
 *
 * @param {object} patch the block(s) being changed; keys absent from it are left alone
 * @returns {Promise<object>} the document as saved
 */
export const updateSettings = async (patch) => (await provider()).updateSettings(patch);

/**
 * Named module bundles for scoped back-office accounts (`settings.customRoles`).
 *
 * **Live, this is always empty, and that is the correct answer rather than a gap.** Migration V61
 * removed the key: it was keyed by a `roleId` no user row, no JWT claim and no endpoint ever
 * carried, its vocabulary was the admin client's rather than the server's, and it composed by
 * union where the real permission map may only ever narrow. `PUT /admin/settings` now answers 422
 * for the key rather than storing it.
 *
 * It stays on the interface only because the mock provider still serves the console's module-key
 * navigation from it. Once the console binds to `GET /admin/permission-catalogue` this method and
 * `lib/permissions.js` go together — see the master plan's open decision 3.
 *
 * @returns {Promise<{id: string, modules: string[]}[]>}
 */
export const getCustomRoles = async () => (await provider()).getCustomRoles();

/**
 * The feature toggles the client renders against (`settings.flags`).
 *
 * **Not a slice of `getSettings()`, and it must not become one.** Live, this reads `GET /flags` —
 * a public route — while `GET /admin/settings` is admin-only in both directions, because the
 * document it serves also carries the fee table and the permission map. The flags are the one block
 * in it that gates what a *logged-out visitor* sees: the map view, the EMI calculator, the referral
 * offer, whether signups are open at all. Calling `getSettings()` and reading `.flags` would 403
 * for every consumer of this platform.
 *
 * That asymmetry is why this method exists on the same domain instead of a domain of its own: the
 * mock/live switch is per-domain, so splitting the flags out would add a 24th name to
 * `VITE_API_DOMAINS` that somebody has to remember to enable — and the failure mode of forgetting
 * is a site that silently renders its defaults.
 *
 * **Absent means enabled.** The caller's test is `flags[key] !== false`, so a flag nobody has
 * decided about is on, and `{}` is a correct answer rather than an empty one.
 *
 * @returns {Promise<Record<string, boolean>>} explicitly-set toggles only
 */
export const getAppFlags = async () => (await provider()).getAppFlags();
