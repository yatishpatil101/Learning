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

/**
 * Map coverage and place-suppression policy (`settings.geo`).
 *
 * **A fourth public route.** Live this reads `GET /geo`, for the reason the flags and the Move-in
 * Pack each read their own: the block gates what a *logged-out visitor* sees — where a map centres,
 * whether locality search is fenced to the city bounds, which places are hidden from every
 * suggestion box — and the document it lives in is admin-only because it also carries the fee table
 * and the permission map. City launch state is served by `GET /cities`, not by this route. Not a key on
 * `getAppFlags()` either: that contract is map-of-boolean and would drop two of this block's three
 * parts on the floor.
 *
 * **Everything in the answer is an override.** `lib/geoConfig.js` owns the built-in centre and box
 * per city and merges this over them, so `{}` is the correct answer for an install
 * whose operator has never opened the Maps panel, and an unreachable server leaves the client on
 * defaults rather than on nothing. That is why there is no fail-closed shape here the way there is
 * for the Move-in Pack — there is nothing to close.
 *
 * **The live answer is narrower than the stored block by one field.** Each blacklist entry keeps
 * its `placeId` and `term`, which is all the matcher has ever read, and drops the operator's
 * free-text reason. The admin console reads the whole entry through `getSettings()`, which is
 * where a moderator's note about a named building belongs.
 *
 * @returns {Promise<{ enforceCityLimit?: boolean, cities?: object, blacklist?: Array }>}
 */
export const getGeo = async () => (await provider()).getGeo();

/**
 * What a healthy install charges, and the answer when the server cannot be reached.
 *
 * These live here rather than in `lib/store/billing.js` because that is where the *last* copy lived,
 * and the copy was the bug: the same seven numbers sat in the browser bundle and in the seed row,
 * and because the browser never asked, neither could contradict the other. They drifted apart on
 * five of the seven and nothing was wrong until `GET /pricing` started reading. The server's
 * `PlatformSettings` defaults match this object exactly and must stay in step — that duplication is
 * deliberate in the way the notification preferences' is, because the mock path has no server to
 * ask, and defaults that disagreed would make the two modes quote different prices.
 *
 * Frozen so a caller cannot mutate the fallback every later caller depends on.
 */
export const PRICING_DEFAULTS = Object.freeze({
  ownerPlanYearly: 999,
  ownerProYearly: 2499,
  rentAgreementPlatform: 500,
  seekerPlusTopup: 199,
  featuredListing: 999,
  gstPercent: 18,
});

/**
 * What PuneNest sells, and for how much (`settings.fees`).
 *
 * **A fifth public route.** Live this reads `GET /pricing`, for the reason each of the others reads
 * its own: a price a visitor is quoted before they sign in is not a privileged fact, and the
 * document these live in is admin-only because it also carries the permission map. Not a key on
 * `getAppFlags()` either — that contract is map-of-boolean and would drop every one of these.
 *
 * **Not `GET /fees`**, which already exists and answers a different question: that is the broker
 * comparison table, keyed by deal, and most of what it lists is the state's money — stamp duty,
 * registration. This is the platform's own price list.
 *
 * **Absent means the bundled default**, which is the opposite of the Move-in Pack's fail-closed
 * rule and deliberately so. The Pack can decline to sell when it does not know a price, because its
 * page has a coming-soon mode to fall back to; a checkout that has already been entered has no such
 * mode, and blanking the number would strand a user mid-purchase rather than protect them. So an
 * unreachable server leaves the client on `PRICING_DEFAULTS`, which is the answer a healthy install
 * gives.
 *
 * That fallback is the whole reason this route exists, and it is worth saying why. These numbers
 * lived in `lib/store/billing.js` *and* in the seed row, and while the browser held its own
 * copy and never asked, neither could contradict the other — so the two drifted apart on five of
 * them and nothing was wrong until something finally read. A duplicated constant does
 * not drift loudly; it presents the bill in one go, on the day the duplicate is retired.
 *
 * Prices are **whole rupees**; `gstPercent` is a percentage.
 *
 * @returns {Promise<{ ownerPlanYearly: number, ownerProYearly: number, rentAgreementPlatform: number,
 *                     seekerPlusTopup: number, featuredListing: number, gstPercent: number }>}
 */
export const getPricing = async () => (await provider()).getPricing();
