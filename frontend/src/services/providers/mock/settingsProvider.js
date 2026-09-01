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
