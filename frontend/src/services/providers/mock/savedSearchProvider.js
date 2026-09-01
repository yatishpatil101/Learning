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
import { listProperties } from '../../../lib/mockApi.js';
import { countMatches } from '../../../pages/consumer/listings/alertCriteria.js';

/** The server's default cadence, mirrored so a new alert reads the same on both providers. */
const DEFAULT_FREQUENCY = 'daily';

/**
 * The catalogue this provider counts matches against (D227).
 *
 * The live provider reads `matchCount` off the row because the server counts it; here the whole
 * demo catalogue is in memory, so counting it locally is the honest answer and there is no page to
 * be truncated by. That asymmetry is the point of the field — the caller stopped counting for
 * itself, and each provider answers from whatever it actually holds.
 *
 * `listProperties` rather than `rawDb().listings` so the count is over the same visible,
 * approved set a buyer would see, which is what the server's query restricts itself to.
 */
async function catalogue() {
  try {
    const props = await listProperties({});
    return Array.isArray(props) ? props : [];
  } catch {
    // A count is a decoration on the alert card. An unreadable catalogue reads as zero matches
    // rather than as a failed list of the user's own alerts.
    return [];
  }
}

/**
 * Normalise a stored record into the seam's shape.
 *
 * The stored row may predate `alertFrequency` entirely, so the boolean is the source of truth when
 * the enum is absent — never the other way round. Deriving `alerts` back from the enum afterwards
 * keeps the two fields consistent even on a row that only ever had one of them.
 *
 * `countMatches` is the same three-facet matcher (`deal`, `localities`, `bhk`) the server's
 * `countVisibleWithFilters` implements, which is why the two providers can be relied on to agree.
 * A flatmates alert counts zero on both sides — neither reads the flatmates catalogue.
 *
 * The `deal` guard is not redundant. `countMatches` reads any non-`rent` value as "buy", so a
 * record whose `deal` never made it into storage would count the entire sale catalogue; the server
 * counts zero for a filter blob with no `deal`, on the grounds that an alert which has not said
 * what it wants has not asked for anything. Zero is the answer that matches.
 */
function toViewModel(rec, props = []) {
  const alertFrequency = rec.alertFrequency ?? (rec.alerts === false ? 'off' : DEFAULT_FREQUENCY);
  const kind = rec.kind || 'listings';
  const countable = kind === 'listings' && (rec.deal === 'rent' || rec.deal === 'buy');
  return {
    ...rec,
    kind,
    channel: rec.channel || 'whatsapp',
    alertFrequency,
    alerts: alertFrequency !== 'off',
    newCount: rec.newCount ?? 0,
    matchCount: countable ? countMatches(rec, props) : 0,
  };
}

export async function listSavedSearches() {
  // One catalogue read for the whole list, not one per row — the http provider gets its counts in
  // the same single response.
  const props = await catalogue();
  return getSavedSearches().map((rec) => toViewModel(rec, props));
}

export async function createSavedSearch(record) {
  // `addSavedSearch` stamps the id, timestamp and defaults, and honours `record.mobile` for the
  // signed-out lead path. Passing the record through unchanged keeps that behaviour intact.
  return toViewModel(addSavedSearch(record), await catalogue());
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
  return toViewModel(row, await catalogue());
}

export async function deleteSavedSearch(id) {
  removeSavedSearch(id);
}
