/**
 * HTTP saved-search provider — the live counterpart to `providers/mock/savedSearchProvider.js`.
 *
 * The mapping lives here rather than in a separate `savedSearchMapper.js` because it is one pair of
 * functions over one shape; the property slice has a mapper module because it maps four different
 * payloads. A file per translation is not the rule, a testable translation is.
 */
import { del, get, patch, post } from '../../http.js';

/**
 * Server row → the flat record the UI is written against.
 *
 * `filters` is spread onto the top level because every consumer reads facets directly — `rec.deal`,
 * `rec.bhk`, `rec.localities` in `criteriaChips`, `countMatches` and the alert cards. Leaving them
 * nested would mean each of those silently seeing `undefined` and rendering an alert with no
 * criteria: no error, just an empty chip row that looks like the user saved nothing.
 *
 * The spread is first so a server-level field can never be shadowed by a same-named key that ended
 * up inside the free-form `filters` blob.
 */
function toViewModel(row) {
  const filters = row?.filters && typeof row.filters === 'object' ? row.filters : {};
  return {
    ...filters,
    id: row.id,
    kind: row.kind || 'listings',
    name: row.name ?? undefined,
    query: row.query ?? '',
    criteria: row.criteria ?? undefined,
    label: row.label || filters.label || '',
    mobile: row.mobile ?? undefined,
    alertFrequency: row.alertFrequency || 'daily',
    // Derived so the existing Switch and the `s.alerts !== false` guards keep working unchanged.
    alerts: (row.alertFrequency || 'daily') !== 'off',
    channel: row.channel || 'whatsapp',
    newCount: row.newCount ?? 0,
    at: row.createdAt ? Date.parse(row.createdAt) : Date.now(),
  };
}

/**
 * Flat record → `SavedSearchCreate`.
 *
 * Everything that is not a named contract field is a facet, so the filters blob is assembled by
 * exclusion rather than by listing facets explicitly. Listing them would mean this function has to
 * be edited every time a new filter is added to search — and the failure mode of forgetting is a
 * facet that is silently dropped from the alert, which then quietly matches too much.
 */
const TOP_LEVEL = new Set([
  'id', 'kind', 'name', 'query', 'criteria', 'label', 'mobile',
  'alertFrequency', 'alerts', 'channel', 'newCount', 'at',
]);

function toCreateRequest(record = {}) {
  const filters = {};
  for (const [key, value] of Object.entries(record)) {
    if (!TOP_LEVEL.has(key) && value !== undefined) filters[key] = value;
  }
  const kind = record.kind || 'listings';
  return {
    kind,
    name: record.name,
    // The server requires a query for a listings alert and forbids relying on it for flatmates.
    // Several call sites save a filter-only alert with `query: ''`, so fall back to the label —
    // it is the human summary of exactly those filters, which is what the user would have typed.
    query: kind === 'flatmates' ? undefined : (record.query || record.label || ''),
    filters,
    criteria: record.criteria,
    alertFrequency: record.alertFrequency || (record.alerts === false ? 'off' : 'daily'),
    channel: record.channel || 'whatsapp',
  };
}

export async function listSavedSearches() {
  // The contract returns a bare array here, not a page envelope — a user's own alert list is
  // bounded by their own actions, so it is one of the reads that is legitimately unpaged.
  const rows = await get('/me/saved-searches');
  return (Array.isArray(rows) ? rows : []).map(toViewModel);
}

export async function createSavedSearch(record = {}) {
  // The signed-out lead path (NotifyMeCard, FlatmateAlertCard) passes a `mobile` so the alert can
  // be claimed after sign-in. The server has no home for that: `POST /me/saved-searches` is
  // caller-scoped and `SavedSearchCreate` carries no mobile, so the call would 401 for exactly the
  // visitor it exists to capture.
  //
  // Failing loudly is the same convention `propertyProvider` uses for unshipped admin moderation:
  // the alternative is writing to localStorage while every read comes from the server, which
  // produces an alert the user was told they created and can never see again (D85).
  if (record.mobile) {
    throw new Error(
      '[savedSearch] Anonymous lead capture is not supported by the API: POST /me/saved-searches is '
        + 'caller-scoped and takes no mobile. Needs a public demand-capture endpoint (D85).',
    );
  }
  return toViewModel(await post('/me/saved-searches', toCreateRequest(record)));
}

export async function updateSavedSearch(id, changes = {}) {
  return toViewModel(await patch(`/me/saved-searches/${encodeURIComponent(id)}`, changes));
}

export async function deleteSavedSearch(id) {
  await del(`/me/saved-searches/${encodeURIComponent(id)}`);
}
