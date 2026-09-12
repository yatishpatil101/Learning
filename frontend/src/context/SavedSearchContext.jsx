import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  createSavedSearch,
  deleteSavedSearch,
  listSavedSearches,
  setAlertFrequency,
} from '../services/savedSearchService.js';
import { useAuth } from './AuthContext.jsx';

/**
 * The caller's saved searches and their alert preferences.
 *
 * ## Why a context rather than an effect per consumer
 *
 * Three components read this list on the *same* dashboard render — `Dashboard` for the stat card,
 * `AlertsPanel` for the list, `useDashboardData` for the match counts — and `Notifications` reads it
 * on its own page. As four independent effects that is three duplicate requests to draw one screen,
 * and worse, three copies of the list that drift the moment one of them mutates it: today
 * `AlertsPanel` deletes an alert and the stat card above it keeps counting it until a reload.
 *
 * This is a smaller problem than the one `SavedContext` solves (that one was per-card, so it scaled
 * with the page), but it is the same shape and the same fix.
 *
 * ## Signed out
 *
 * The list is caller-scoped and the API 401s without a session, so this holds an empty list. The
 * signed-out *lead capture* path is deliberately not routed through here — see `createSavedSearch`
 * in the http provider for why it has no server home yet.
 */
const SavedSearchContext = createContext(null);

export function SavedSearchProvider({ children }) {
  const { isIn } = useAuth();
  const [searches, setSearches] = useState([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    const next = await listSavedSearches();
    setSearches(next);
    return next;
  }, []);

  useEffect(() => {
    if (!isIn) {
      setSearches([]);
      return undefined;
    }
    let alive = true;
    setLoading(true);
    listSavedSearches()
      .then((next) => { if (alive) setSearches(next); })
      // An unreachable alert list renders as "no alerts yet" rather than taking the dashboard down.
      // The empty state invites the user to create one, which is a recoverable wrong answer; a
      // thrown error in a panel that sits beside five others is not.
      .catch(() => { if (alive) setSearches([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [isIn]);

  const create = useCallback(async (record) => {
    const created = await createSavedSearch(record);
    // Prepend rather than refetch: the list is newest-first and we already hold the new row, so a
    // round trip here would only re-fetch what we just sent.
    if (created) setSearches((prev) => [created, ...prev]);
    return created;
  }, []);

  /**
   * Change one search's alert cadence. Optimistic, with rollback — same reasoning as the
   * saved-property heart.
   *
   * `alerts` is recomputed here rather than left to the next refresh so the "n active" count above
   * the list moves with the picker; it is derived from the cadence, never the other way round
   * (D84 — a boolean round trip is what used to flatten `instant` into `daily`).
   */
  const setFrequency = useCallback(async (id, frequency) => {
    let previous;
    setSearches((prev) => prev.map((s) => {
      if (s.id !== id) return s;
      previous = s;
      return { ...s, alertFrequency: frequency, alerts: frequency !== 'off' };
    }));
    try {
      await setAlertFrequency(id, frequency);
    } catch {
      setSearches((prev) => prev.map((s) => (s.id === id && previous ? previous : s)));
    }
  }, []);

  const remove = useCallback(async (id) => {
    const snapshot = searches;
    setSearches((prev) => prev.filter((s) => s.id !== id));
    try {
      await deleteSavedSearch(id);
    } catch {
      // Put it back. A delete that appears to work and then reappears on reload is worse than one
      // that visibly fails.
      setSearches(snapshot);
    }
  }, [searches]);

  const value = useMemo(
    () => ({ searches, count: searches.length, loading, create, setFrequency, remove, refresh }),
    [searches, loading, create, setFrequency, remove, refresh],
  );
  return <SavedSearchContext.Provider value={value}>{children}</SavedSearchContext.Provider>;
}

/** Null-safe outside the provider, so a component rendered in isolation degrades to "no alerts". */
export function useSavedSearches() {
  return useContext(SavedSearchContext) ?? EMPTY;
}

const EMPTY = {
  searches: [],
  count: 0,
  loading: false,
  create: async () => null,
  setFrequency: async () => {},
  remove: async () => {},
  refresh: async () => [],
};
