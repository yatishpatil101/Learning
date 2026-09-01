/**
 * Mock settings provider — the localStorage counterpart to `providers/http/settingsProvider.js`.
 *
 * Thin by design: `lib/mockApi` already stores the document as one `settings` object inside
 * `db.json` and already fires `punenest-settings-change` after a write, which is what the admin
 * console listens on to refresh itself. Re-implementing either here would give the mock two
 * different settings stores.
 *
 * The one thing worth saying out loud is what `updateSettings` has to do that `lib/mockApi` does
 * not: the server **deep-merges** the patch block by block, while `lib/mockApi`'s version is a
 * shallow `{ ...db.settings, ...patch }`. Those two rules agree only while every caller sends one
 * whole top-level block, which was true until `AdminFlagsContext.setFlag` started sending just the
 * flag it changed — `{ adminFlags: { tab: { finance: false } } }`. Under the shallow rule that
 * patch replaces the entire `adminFlags` object with a single-key one, silently discarding every
 * other flag; under the server's it changes one boolean. Sending the narrow patch is the correct
 * behaviour (a whole-block write re-asserts values the caller may never have read), so the
 * divergence is closed *here*, by pre-merging against the stored document before handing a set of
 * whole top-level blocks to `lib/mockApi`. The alternative — teaching every caller to send blocks
 * it has not read — is the bug, not the fix.
 */
import {
  getSettings as mockGetSettings,
  updateSettings as mockUpdateSettings,
  getCustomRoles as mockGetCustomRoles,
} from '../../../lib/mockApi.js';

/**
 * Merge `incoming` onto `base` the way `AdminSettingsService.merge` does.
 *
 * Objects merge key by key; arrays and scalars replace whole. Replacing arrays matters as much as
 * merging objects: `geo.blacklist` is an ordered list, and index-wise merging of two lists produces
 * a third that neither side asked for.
 */
function deepMerge(base, incoming) {
  if (
    !base || typeof base !== 'object' || Array.isArray(base)
    || !incoming || typeof incoming !== 'object' || Array.isArray(incoming)
  ) {
    return incoming;
  }
  const result = { ...base };
  for (const [key, value] of Object.entries(incoming)) {
    // `Object.entries` on a `JSON.parse` result does surface an own `__proto__` key, and assigning
    // to it would reparent `result` instead of adding a setting. Same guard as `AdminFlagsContext`.
    if (key === '__proto__' || key === 'constructor') continue;
    result[key] = deepMerge(base[key], value);
  }
  return result;
}

/** The whole stored document. */
export async function getSettings() {
  return mockGetSettings();
}

/** Deep-merge `patch` into the document and resolve with the result. */
export async function updateSettings(patch) {
  const current = await mockGetSettings();
  const blocks = {};
  for (const [key, value] of Object.entries(patch || {})) {
    blocks[key] = deepMerge(current?.[key], value);
  }
  // `lib/mockApi`'s shallow spread is now correct by construction: every entry handed to it is a
  // complete top-level block.
  return mockUpdateSettings(blocks);
}

/**
 * The console-local named module bundles.
 *
 * Synchronous in `lib/mockApi` — the service seam is async for every domain, so it is wrapped
 * rather than exposed raw. The live provider answers `[]` here for reasons that are not this file's
 * to explain; see `settingsService.js`.
 */
export async function getCustomRoles() {
  return mockGetCustomRoles();
}

/**
 * The flag block, from the same stored document the admin console writes.
 *
 * A slice rather than its own store on purpose: the mock's whole value is that the settings screen
 * and the consumer UI disagree about nothing, and a second copy of the flags would be a second
 * thing to keep in step. Live the two are separate routes because one is public and one is not —
 * a distinction with no meaning against localStorage.
 */
export async function getAppFlags() {
  const doc = await mockGetSettings();
  const flags = doc?.flags;
  return flags && typeof flags === 'object' ? flags : {};
}

/**
 * The Move-in Pack block, from that same stored document.
 *
 * Normalised to `{ enabled, items }` here rather than returned raw, because the mock document has
 * no schema behind it: the block is whatever the settings screen last wrote, and it is absent
 * entirely in a fresh `db.json`. Answering the contract's shape from both providers is what lets
 * the caller stop asking which one it is talking to.
 *
 * `enabled` is compared against `true` rather than coerced, matching the live provider — a truthy
 * leftover like the string `'false'` must not launch a paid product.
 */
export async function getMovePack() {
  const doc = await mockGetSettings();
  const pack = doc?.movePack;
  if (!pack || typeof pack !== 'object') return { enabled: false, items: {} };
  return {
    enabled: pack.enabled === true,
    items: pack.items && typeof pack.items === 'object' ? pack.items : {},
  };
}

/**
 * The geo policy block, from that same stored document.
 *
 * Every field here is an *override* merged over `lib/geoConfig.js`'s built-in defaults, so there is
 * no shape to normalise toward and `{}` is the correct answer for a document nobody has edited.
 *
 * **Projected to the three keys `GET /geo` publishes, and no others** — the same list, in the same
 * order, as `GeoPolicyController`. Spreading the stored block instead would be the cheaper line and
 * the wrong one: `settings.geo` is an open document an operator writes through the Maps panel, and
 * the day a private field is added under it the mock would publish it while the live route withheld
 * it, silently, with nothing failing. A projection cannot drift that way — a new field is invisible
 * here until somebody adds it on purpose, in both places.
 *
 * The one field that already differs is `note` on each blacklist entry. `GET /geo` withholds it
 * because that route is anonymous and the note is moderator prose about a named building; keeping
 * it here would make the mock the only place a consumer could read it, which is how a leak ships —
 * a component binds to a field that exists in development and vanishes in production. Nothing loses
 * access: the admin console reads the whole entry through `getSettings()`.
 *
 * What this deliberately does *not* mirror is the server's hardening — a half-written `center`, an
 * inverted `bounds`, a one-character `term`. Those are defences against a malformed stored
 * document, and the mock store is written only by this app's own admin panel. Reproducing them here
 * would be a second implementation of the same rules with nothing keeping the two honest.
 */
export async function getGeo() {
  const doc = await mockGetSettings();
  const geo = doc?.geo;
  if (!geo || typeof geo !== 'object') return {};
  const blacklist = Array.isArray(geo.blacklist)
    ? geo.blacklist
        .filter((entry) => entry && typeof entry === 'object')
        .map(({ id, placeId, term }) => ({ id, placeId, term }))
    : [];
  return {
    enforceCityLimit: geo.enforceCityLimit,
    cities: geo.cities && typeof geo.cities === 'object' ? geo.cities : {},
    blacklist,
  };
}
