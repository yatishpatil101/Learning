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
 * **2. `alerts` boolean vs `alertFrequency` enum.** The mock stored an on/off flag; the server has
 * `off | instant | daily | weekly`. Both are exposed here: `alertFrequency` is the real field and
 * `alerts` is derived from it (`alertFrequency !== 'off'`) for the read-only places that only need
 * to know whether a search is being watched — the dashboard's "3 active" count, the stat card.
 *
 * Nothing *writes* through the boolean any more (D84). The dashboard's alert row is a four-option
 * cadence picker, and it writes `alertFrequency` directly, so a user holding `instant` who turns
 * alerts off and on again gets `instant` back. The old two-state helper wrote `daily` on every
 * switch-on, which was harmless only for as long as no cadence other than `daily` was reachable;
 * that is exactly what the picker changed, so the helper is gone rather than left as a trap.
 * `ALERT_FREQUENCIES` below is the enum, in escalating order, and is the one place it is spelled.
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
export const listSavedSearches = async () => (await provider()).listSavedSearches();

/**
 * Persist a search.
 *
 * @param {object} record the flat alert record — `buildAlertRecord()` output plus optional
 *   `label`, `query`, `channel`, `kind`, `criteria`
 */
export const createSavedSearch = async (record) => (await provider()).createSavedSearch(record);

/**
 * Change alert preferences. The query itself is not editable — changing what you are watching
 * replaces the alert rather than mutating it, which is the server's rule too.
 *
 * @param {string} id
 * @param {{alertFrequency?: string, channel?: string}} changes
 */
export const updateSavedSearch = async (id, changes) => (await provider()).updateSavedSearch(id, changes);

export const deleteSavedSearch = async (id) => (await provider()).deleteSavedSearch(id);

/**
 * The server's `alert_frequency` enum, in escalating order — the order the picker offers them in.
 * Exported so the UI does not re-spell the vocabulary and drift from the CHECK constraint.
 */
export const ALERT_FREQUENCIES = ['off', 'instant', 'daily', 'weekly'];

/** The cadence a search gets when it is switched on without an explicit choice — the server's own. */
export const DEFAULT_ALERT_FREQUENCY = 'daily';

/**
 * Set how often one search notifies. `'off'` stops it without deleting it.
 *
 * A convenience over `updateSavedSearch` only so that callers cannot pass a cadence the server
 * would reject — an unknown value is refused here rather than round-tripping into a 400.
 */
export const setAlertFrequency = async (id, alertFrequency) => {
  if (!ALERT_FREQUENCIES.includes(alertFrequency)) {
    throw new Error(`Unknown alert frequency: ${alertFrequency}`);
  }
  return (await provider()).updateSavedSearch(id, { alertFrequency });
};
