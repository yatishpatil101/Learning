/**
 * Mock saved-search provider — the localStorage counterpart to
 * `providers/http/savedSearchProvider.js`.
 *
 * Storage stays where it was (`pnSavedSearches:<mobile>` in `lib/store`), so the React app and the
 * older HTML prototype still share alerts. What this adds is the `alertFrequency` field: the store
 * only ever knew an `alerts` boolean, so every record is normalised on the way out to carry both.
 * A call site must not be able to tell which provider answered it, and that includes fields the
 * mock's storage never had.
 */
import {
  addSavedSearch,
  getSavedSearches,
  removeSavedSearch,
  saveSavedSearches,
} from '../../../lib/store.js';

/** The server's default cadence, mirrored so a new alert reads the same on both providers. */
const DEFAULT_FREQUENCY = 'daily';

/**
 * Normalise a stored record into the seam's shape.
 *
 * The stored row may predate `alertFrequency` entirely, so the boolean is the source of truth when
 * the enum is absent — never the other way round. Deriving `alerts` back from the enum afterwards
 * keeps the two fields consistent even on a row that only ever had one of them.
 */
function toViewModel(rec) {
  const alertFrequency = rec.alertFrequency ?? (rec.alerts === false ? 'off' : DEFAULT_FREQUENCY);
  return {
    ...rec,
    kind: rec.kind || 'listings',
    channel: rec.channel || 'whatsapp',
    alertFrequency,
    alerts: alertFrequency !== 'off',
  };
}

export async function listSavedSearches() {
  return getSavedSearches().map(toViewModel);
}

export async function createSavedSearch(record) {
  // `addSavedSearch` stamps the id, timestamp and defaults, and honours `record.mobile` for the
  // signed-out lead path. Passing the record through unchanged keeps that behaviour intact.
  return toViewModel(addSavedSearch(record));
}

/**
 * Alert preferences only, matching the server's PATCH.
 *
 * Both fields are written when supplied, and `alerts` is kept in step with `alertFrequency` so a
 * consumer still reading the boolean cannot disagree with one reading the enum.
 */
export async function updateSavedSearch(id, changes = {}) {
  const all = getSavedSearches();
  const row = all.find((s) => s.id === id);
  if (!row) return null;

  if (changes.alertFrequency !== undefined) {
    row.alertFrequency = changes.alertFrequency;
    row.alerts = changes.alertFrequency !== 'off';
  }
  if (changes.channel !== undefined) row.channel = changes.channel;

  saveSavedSearches(all);
  return toViewModel(row);
}

export async function deleteSavedSearch(id) {
  removeSavedSearch(id);
}
