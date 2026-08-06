/**
 * Saved Search Service — persisted searches and their alert preferences.
 *
 * ## Two shape gaps this seam absorbs
 *
 * **1. Flat facets vs a nested `filters` object.** The mock stores a saved search as one flat record
 * — `{ deal, types, bhk, localities, budget, rent, label, … }` — and the whole app reads those
 * facets directly off it: `criteriaChips(rec)`, `countMatches(s, props)` and the alert card all do
 * `rec.deal`, `rec.bhk`, `rec.localities`. The server nests them under a free-form `filters` jsonb
 * column instead. Rather than rewrite every consumer to reach one level deeper, the providers
 * flatten `filters` back onto the record on read and re-nest it on write. The seam's shape is the
 * flat one, because that is the shape the UI is written against.
 *
 * **2. `alerts` boolean vs `alertFrequency` enum.** The mock has an on/off flag; the server has
 * `off | instant | daily | weekly`. Both are exposed here: `alertFrequency` is the real field, and
 * `alerts` is derived (`alertFrequency !== 'off'`) so the existing Switch keeps working. The switch
 * writes `daily` when turned on, which is the server's own default.
 *
 * That derivation is lossy in one direction and it is worth being explicit about: a user who
 * somehow holds `instant` and flips the switch off and on again lands on `daily`. Today nothing can
 * produce a non-default cadence — there is no frequency picker in the UI — so the loss is currently
 * unreachable. It becomes real the moment a picker ships, which is why the seam carries
 * `alertFrequency` rather than pretending the field is a boolean (D84).
 *
 * ## Kinds
 *
 * A saved search watches one of two surfaces. `kind: 'listings'` carries a `query` string and
 * `filters`; `kind: 'flatmates'` carries a `criteria` object and no query. The server enforces
 * "listings needs query, flatmates needs criteria" in both Bean Validation and a CHECK constraint.
 */
import { createProvider } from './config.js';

const provider = createProvider('savedSearch');

/** Every saved search for the caller, newest first. Flat facets, not a nested `filters` object. */
export const listSavedSearches = () => provider().listSavedSearches();

/**
 * Persist a search.
 *
 * @param {object} record the flat alert record — `buildAlertRecord()` output plus optional
 *   `label`, `query`, `channel`, `kind`, `criteria`
 */
export const createSavedSearch = (record) => provider().createSavedSearch(record);

/**
 * Change alert preferences. The query itself is not editable — changing what you are watching
 * replaces the alert rather than mutating it, which is the server's rule too.
 *
 * @param {string} id
 * @param {{alertFrequency?: string, channel?: string}} changes
 */
export const updateSavedSearch = (id, changes) => provider().updateSavedSearch(id, changes);

export const deleteSavedSearch = (id) => provider().deleteSavedSearch(id);

/**
 * Turn alerts on or off for one search.
 *
 * A convenience over `updateSavedSearch` because the UI's control is a two-state Switch: this keeps
 * the `on → 'daily'` decision in one place instead of letting each caller invent its own cadence.
 */
export const setAlertsEnabled = (id, enabled) =>
  provider().updateSavedSearch(id, { alertFrequency: enabled ? 'daily' : 'off' });
