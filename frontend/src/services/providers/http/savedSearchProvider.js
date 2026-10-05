/** The mapping lives here rather than in a separate `savedSearchMapper.js` because it is one pair of functions over
 * one shape; the property slice has a mapper module because it maps four different payloads. */
import { del, get, patch, post } from '../../http.js';

/** `filters` is spread onto the top level because every consumer reads facets directly — `rec.deal`, `rec.bhk`,
 * `rec.localities` in `criteriaChips`, `countMatches` and the alert cards. */
function toViewModel(row) {
  const filters = row?.filters && typeof row.filters === 'object' ? row.filters : {};
  return {
    ...filters,
    id: row.id,
    kind: row.kind || 'listings',
    name: row.name ?? undefined,
    query: row.query ?? '',
    criteria: row.criteria ?? undefined,
    /** `label` is in TOP_LEVEL, so it is never written into the filters blob — there is no route by which
     * `filters.label` could be populated by this client, and a fallback to it read as if there were one. */
    label: row.label || row.name || '',
    mobile: row.mobile ?? undefined,
    alertFrequency: row.alertFrequency || 'daily',
    // Derived so the existing Switch and the `s.alerts !== false` guards keep working unchanged.
    alerts: (row.alertFrequency || 'daily') !== 'off',
    channel: row.channel || 'whatsapp',
    newCount: row.newCount ?? undefined,
    /** `?? 0` rather than `undefined` so `matchCount > 0` behaves the same against an older server. */
    matchCount: row.matchCount ?? 0,
    at: row.createdAt ? Date.parse(row.createdAt) : Date.now(),
  };
}

/** Everything that is not a named contract field is a facet, so the filters blob is assembled by exclusion rather
 * than by listing facets explicitly. */
const TOP_LEVEL = new Set([
  'id', 'kind', 'name', 'query', 'criteria', 'label', 'mobile',
  'alertFrequency', 'alerts', 'channel', 'newCount', 'matchCount', 'at',
]);

function toCreateRequest(record = {}) {
  const filters = {};
  for (const [key, value] of Object.entries(record)) {
    if (!TOP_LEVEL.has(key) && value !== undefined) filters[key] = value;
  }
  const kind = record.kind || 'listings';
  return {
    kind,
    /** Since `label` is also excluded from the filters blob by TOP_LEVEL, sending only `record.name` meant every
     * alert built by a card (which sets `label` and never `name`) was stored label-less. */
    name: record.name || record.label,
    /** Several call sites save a filter-only alert with `query: ''`, so fall back to the label — it is the human
     * summary of exactly those filters, which is what the user would have typed. */
    query: kind === 'flatmates' ? undefined : (record.query || record.label || ''),
    filters,
    /* Flatmate alerts need criteria; callers provide flat facets, so this lifts them. */
    criteria: record.criteria ?? (kind === 'flatmates' ? filters : undefined),
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
  /** Saved-search creation is caller-scoped; anonymous lead capture needs its own endpoint. */
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
