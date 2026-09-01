/**
 * HTTP settings provider.
 *
 * `GET /admin/settings` · `PUT /admin/settings`, both `x-roles: [admin]`.
 *
 * Verified against `backend/src/main/resources/static/openapi/draazy-api.yaml` (`/admin/settings`,
 * the `AdminSettings` schema) and `admin/AdminSettingsService.java`.
 *
 * ## No mapper, deliberately
 *
 * Every other domain has one, because every other domain has a fixed record whose field names the
 * client should not have to match. This one does not: the server stores one row per top-level key
 * and folds them into a document on read, so the set of keys is open by construction — the contract
 * enumerates the ones it knows about but does not close the object, and `geo` is stored today
 * without appearing there at all. A mapper would have to either list the keys (and silently drop
 * the next one someone adds server-side) or pass the object through (and be a mapper in name only).
 *
 * The consequence to keep in mind: **nothing here validates the shape.** `AdminFlagsContext` merges
 * what it gets over its own defaults and `AdminSettings.jsx` renders it field by field, so a block
 * the server has never stored reads as absent rather than as an error, which is the behaviour both
 * screens already expect from a fresh install.
 *
 * ## `If-Match` is not sent
 *
 * The contract offers an optional precondition (D66) that turns two admins editing the same block
 * into a 412 instead of a silent last-write-wins. It is not wired here, and that is a gap rather
 * than a decision: honouring it means holding the ETag from the last GET, surfacing the 412 as a
 * "someone else changed this, re-read" prompt, and re-applying the edit — i.e. UI work in
 * `AdminSettings.jsx`, not a line in this file. Sending the header without that handling would
 * convert a rare silent overwrite into a frequent unexplained failure, which is worse. The header
 * is optional precisely so this stays a choice.
 */
import { get, put } from '../../http.js';
import { PRICING_DEFAULTS } from '../../settingsService.js';

/** The whole configuration document. */
export async function getSettings() {
  const doc = await get('/admin/settings');
  return doc && typeof doc === 'object' ? doc : {};
}

/**
 * Deep-merge `patch` into the stored document; resolves with the document **as saved**.
 *
 * The server's own response is returned rather than the local patch, because merging and clamping
 * happen server-side and a screen that trusts its optimistic copy will disagree the first time a
 * value is corrected on the way in.
 */
export async function updateSettings(patch) {
  const doc = await put('/admin/settings', patch);
  /* Same in-tab refresh signal the mock provider raises from inside `lib/mockApi`.

     It is dispatched here rather than in `settingsService.js` so that exactly one of the two
     providers raises it per write — hoisting it to the service would make the mock path fire
     twice. It is not an artefact of the mock: `AdminFlagsContext` listens on it so that saving a
     flag on the Settings screen re-gates the admin nav without a reload, and a `storage` event
     cannot do that job because it only fires in *other* tabs. */
  window.dispatchEvent(new CustomEvent('draazy-settings-change'));
  return doc && typeof doc === 'object' ? doc : {};
}

/**
 * Always `[]`.
 *
 * Not a stub and not a missing feature: migration V61 deleted `settings.customRoles`, and
 * `PUT /admin/settings` answers **422** for the key rather than storing it — sending it here would
 * fail the write. There is nothing to fetch, so the honest live answer is the empty list, and the
 * console's module-key navigation consequently falls back to the always-on base modules for any
 * account that is not an `admin`.
 *
 * That is a real reduction in what a scoped back-office account can see, and it fails *closed*, so
 * it is a usability gap rather than an exposure. Closing it properly means binding the console to
 * `GET /admin/permission-catalogue` — the server's actual 16-atom model — which is open decision 3
 * in the migration plan, not something this function can paper over.
 */
export async function getCustomRoles() {
  return [];
}

/**
 * `GET /flags` — public, and deliberately a different route from the one above.
 *
 * The flag block decides what an anonymous visitor sees, so it cannot be read through the
 * admin-only settings document; publishing it on its own route is what makes the toggles real for
 * the people they act on. Verified against the contract's `/flags` (`getAppFlags`) and
 * `common/settings/AppFlagsController.java`.
 *
 * Only explicitly-set booleans come back — the server drops anything else, since the caller's test
 * is `!== false` and a stray string would read as enabled either way. A failed read is left to the
 * caller: `AppFlagsContext` treats it as "no decisions recorded", which lands every flag on its
 * default rather than blanking the site.
 */
export async function getAppFlags() {
  const flags = await get('/flags');
  return flags && typeof flags === 'object' ? flags : {};
}

/**
 * `GET /move-pack` — public, and a third route rather than more of `/flags`.
 *
 * Half of this block is a price list, and `/flags` is typed map-of-boolean and drops everything
 * else, so it cannot carry prices without disagreeing with its own schema. Verified against the
 * contract's `/move-pack` (`getMovePack`, schema `MovePackConfig`) and
 * `common/settings/MovePackController.java`.
 *
 * **A failed read means coming-soon, not "unknown".** That is the opposite of how the caller treats
 * a failed flag read, and deliberately so: an unreachable server must never leave the page quoting
 * prices it could not confirm. The server defaults the same way for a missing or malformed row, so
 * the two ends fail in the same direction.
 */
export async function getMovePack() {
  const cfg = await get('/move-pack');
  if (!cfg || typeof cfg !== 'object') return { enabled: false, items: {} };
  return {
    enabled: cfg.enabled === true,
    items: cfg.items && typeof cfg.items === 'object' ? cfg.items : {},
  };
}

/**
 * `GET /geo` — public, and a fourth route rather than more of `/flags`.
 *
 * Same argument `/move-pack` makes: this block is per-city coordinates, bounding boxes and an
 * ordered list, and `/flags` would drop most of it. Public because the block decides what a
 * logged-out visitor is shown — where a map centres and whether locality search is fenced — while
 * the document it lives in also carries the fee table. City launch state is served separately by
 * `GET /cities`.
 * Verified against the contract's `/geo` (`getGeoPolicy`, schema `GeoPolicy`) and
 * `common/settings/GeoPolicyController.java`.
 *
 * **A failed read means "no overrides", like the flags and unlike the pack.** Every field here is
 * an override merged over `lib/geoConfig.js`'s built-ins, so an unreachable server leaves the
 * client on a working default policy — Pune live, city limit on, nothing blacklisted. There is no
 * fail-closed answer to prefer: refusing to render a map is not safer than rendering the one the
 * client already knows about.
 *
 * The server withholds each blacklist entry's operator note. No normalisation of that here — the
 * projection is the server's job and doing it twice would hide a regression in its half.
 */
export async function getGeo() {
  const geo = await get('/geo');
  return geo && typeof geo === 'object' ? geo : {};
}

/**
 * `GET /pricing` — public, and a fifth route rather than more of `/flags`.
 *
 * Same argument `/move-pack` makes, and for that matter the same argument `/fees` already settled:
 * a price a visitor is quoted before they sign in is not a privileged fact, while the document it
 * lives in also carries the permission map. Not `/fees` itself, which answers what a *transaction*
 * costs — brokerage, stamp duty, registration, mostly the state's money, keyed by deal. This is
 * what Draazy sells. Verified against the contract's `/pricing` (schema `PlatformPricing`) and
 * `common/settings/PricingController.java`.
 *
 * **A failed read means the bundled defaults, unlike the pack.** The Pack can refuse to sell when
 * it cannot confirm a price because its page has a coming-soon mode; a checkout does not, and a
 * blank number strands a user mid-purchase rather than protecting them. `PRICING_DEFAULTS` is what
 * a healthy install answers, so falling back to it changes nothing when the server is reachable and
 * degrades to the status quo ante when it is not.
 *
 * Each key is merged individually rather than accepting the object wholesale, so a server that
 * learns an eighth price does not hand this client a key it has no default for — and a response
 * missing one falls back on that key alone instead of discarding the six that arrived.
 */
export async function getPricing() {
  const raw = await get('/pricing');
  if (!raw || typeof raw !== 'object') return { ...PRICING_DEFAULTS };
  const out = { ...PRICING_DEFAULTS };
  for (const key of Object.keys(PRICING_DEFAULTS)) {
    if (Number.isFinite(raw[key])) out[key] = raw[key];
  }
  return out;
}
