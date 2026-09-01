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

/* `getCustomRoles` used to be here.
 *
 * Named module bundles for scoped back-office accounts. Migration V61 removed the key: it was
 * keyed by a `roleId` no user row, no JWT claim and no endpoint ever carried, its vocabulary was
 * the admin client's rather than the server's, and it composed by union where the real permission
 * map may only ever narrow. `PUT /admin/settings` answers 422 for the key. It survived here to
 * feed the console's own navigation gate; that gate is now `GET /admin/permission-catalogue` plus
 * the atoms the server returns on `/auth/me`, so the last caller is gone and so is this
 * (open decision 3, resolved). The mock provider still exports it and dies with the mock at P5c.
 */

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

/**
 * The Move-in Pack's launch state and price list.
 *
 * **A third public route, not a fourth flag.** Live this reads `GET /move-pack`. It is not part of
 * `getAppFlags()` because that endpoint's contract is map-of-boolean and drops everything else, so
 * it cannot carry a price list without disagreeing with its own schema; and it is not a slice of
 * `getSettings()` for the same reason the flags are not, which is that the services page renders
 * for visitors who have never signed in and that document is admin-only.
 *
 * It stays on this domain rather than becoming one of its own for the reason given above for the
 * flags: the mock/live switch is per-domain, and a domain nobody remembers to enable fails by
 * silently serving a stale copy.
 *
 * **Absent means off** — the one place this disagrees with `getAppFlags()`. A flag nobody has
 * configured is enabled, so shipping a feature is a code change rather than a code change plus a
 * config row. That rule cannot extend to a price without having an unconfigured install offer to
 * sell at a number nobody chose, so a missing, malformed or unreachable block answers
 * `{ enabled: false, items: {} }`, which is the page's coming-soon mode: no prices shown, waitlist
 * capture instead of booking.
 *
 * Prices are **whole rupees**, like every other money value the seam carries.
 *
 * @returns {Promise<{ enabled: boolean, items: Record<string, number> }>}
 */
export const getMovePack = async () => (await provider()).getMovePack();
