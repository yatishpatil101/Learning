import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  createSavedSearch,
  deleteSavedSearch,
  listSavedSearches,
  setAlertFrequency,
} from '../services/savedSearchService.js';
import { useAuth } from './AuthContext.jsx';

/* The API 401s without a session, so signed-out lead capture bypasses this context. */
const SavedSearchContext = createContext(null);
const FOREGROUND_RELOAD_MS = 30000;

export function SavedSearchProvider({ children }) {
  const { isIn } = useAuth();
  const [searches, setSearches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(isIn ? 'loading' : 'ready');
  const [error, setError] = useState(null);
  const lastForegroundReload = useRef(0);
  // Read only once a screen asks: the shell itself draws no alerts.
  const [wanted, setWanted] = useState(false);
  const want = useCallback(() => setWanted(true), []);

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (!isIn) {
      setSearches([]);
      setError(null);
      setStatus('ready');
      return [];
    }
    if (!silent) {
      setLoading(true);
      setStatus('loading');
    }
    const next = await listSavedSearches();
    setSearches(next);
    setError(null);
    setStatus('ready');
    if (!silent) setLoading(false);
    return next;
  }, [isIn]);

  useEffect(() => {
    if (!isIn) {
      setSearches([]);
      setError(null);
      setStatus('ready');
      return undefined;
    }
    if (!wanted) return undefined;
    let alive = true;
    setLoading(true);
    setStatus('loading');
    listSavedSearches()
      .then((next) => {
        if (!alive) return;
        setSearches(next);
        setError(null);
        setStatus('ready');
      })
      .catch((err) => {
        if (!alive) return;
        setError(err);
        setStatus('error');
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [isIn, wanted]);

  useEffect(() => {
    if (!isIn || !wanted) return undefined;
    const maybeReload = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastForegroundReload.current < FOREGROUND_RELOAD_MS) return;
      lastForegroundReload.current = now;
      refresh({ silent: true }).catch(() => {});
    };
    document.addEventListener('visibilitychange', maybeReload);
    window.addEventListener('focus', maybeReload);
    return () => {
      document.removeEventListener('visibilitychange', maybeReload);
      window.removeEventListener('focus', maybeReload);
    };
  }, [isIn, wanted, refresh]);

  const create = useCallback(async (record) => {
    const created = await createSavedSearch(record);
    // Prepend rather than refetch: the list is newest-first and we already hold the new row, so a
    // round trip here would only re-fetch what we just sent.
    if (created) {
      setSearches((prev) => [created, ...prev]);
      setError(null);
      setStatus('ready');
    }
    return created;
  }, []);

  const reload = useCallback(async () => {
    try {
      return await refresh();
    } catch (err) {
      setError(err);
      setStatus('error');
      setLoading(false);
      throw err;
    }
  }, [refresh]);

  /* Recompute `alerts` locally so the active count moves with the cadence picker. */
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
    () => ({ searches, count: searches.length, loading, status, error, want, create, setFrequency, remove, reload, refresh: reload }),
    [searches, loading, status, error, want, create, setFrequency, remove, reload],
  );
  return <SavedSearchContext.Provider value={value}>{children}</SavedSearchContext.Provider>;
}

/** Null-safe outside the provider, so a component rendered in isolation degrades to "no alerts". */
export function useSavedSearches() {
  const ctx = useContext(SavedSearchContext);
  const want = ctx?.want;
  useEffect(() => { want?.(); }, [want]);
  return ctx ?? EMPTY;
}

/** For screens that only create alerts: skips the list read, whose rows each run a match count. */
export function useSavedSearchCreate() {
  return (useContext(SavedSearchContext) ?? EMPTY).create;
}

const EMPTY = {
  searches: [],
  count: 0,
  loading: false,
  status: 'ready',
  error: null,
  create: async () => null,
  setFrequency: async () => {},
  remove: async () => {},
  reload: async () => [],
  refresh: async () => [],
};
