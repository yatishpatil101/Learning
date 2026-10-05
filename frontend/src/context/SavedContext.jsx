import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { listSaved, saveProperty, unsaveProperty } from '../services/savedService.js';
import { useAuth } from './AuthContext.jsx';

/* Saved membership is a Set so result cards answer from memory, not thirty requests. */
const SavedContext = createContext(null);

const PAGE_SIZE = 500;
const FOREGROUND_RELOAD_MS = 30000;

export function SavedProvider({ children }) {
  const { isIn } = useAuth();
  const [items, setItems] = useState([]);
  const [ids, setIds] = useState(() => new Set());
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(isIn ? 'loading' : 'ready');
  const [error, setError] = useState(null);
  const [busyIds, setBusyIds] = useState(() => new Set());
  const idsRef = useRef(ids);
  const itemsRef = useRef(items);
  const busyRef = useRef(new Set());
  const lastForegroundReload = useRef(0);

  useEffect(() => { idsRef.current = ids; }, [ids]);
  useEffect(() => { itemsRef.current = items; }, [items]);

  const applyRows = useCallback((rows) => {
    setItems(rows);
    setIds(new Set(rows.map((p) => p.id)));
    setError(null);
    setStatus('ready');
  }, []);

  /* One large page rather than paging: a paged id set would leave hearts wrong on the results
     page for anyone who has saved more than one page worth. */
  const loadAll = useCallback(async ({ silent = false } = {}) => {
    if (!isIn) {
      applyRows([]);
      return { items: [] };
    }
    if (!silent) {
      setLoading(true);
      setStatus('loading');
    }
    const res = await listSaved({ size: PAGE_SIZE });
    applyRows(res.items);
    if (!silent) setLoading(false);
    return res;
  }, [applyRows, isIn]);

  useEffect(() => {
    if (!isIn) {
      applyRows([]);
      setLoading(false);
      return undefined;
    }
    let alive = true;
    setLoading(true);
    setStatus('loading');
    listSaved({ size: PAGE_SIZE })
      .then((res) => {
        if (!alive) return;
        applyRows(res.items);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err);
        setStatus('error');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [applyRows, isIn]);

  useEffect(() => {
    if (!isIn) return undefined;
    const maybeReload = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastForegroundReload.current < FOREGROUND_RELOAD_MS) return;
      lastForegroundReload.current = now;
      loadAll({ silent: true }).catch(() => {});
    };
    document.addEventListener('visibilitychange', maybeReload);
    window.addEventListener('focus', maybeReload);
    return () => {
      document.removeEventListener('visibilitychange', maybeReload);
      window.removeEventListener('focus', maybeReload);
    };
  }, [isIn, loadAll]);

  const has = useCallback((id) => ids.has(id), [ids]);

  const setBusy = useCallback((id, busy) => {
    if (busy) busyRef.current.add(id);
    else busyRef.current.delete(id);
    setBusyIds(new Set(busyRef.current));
  }, []);

  const write = useCallback(async (id, uuid, next) => {
    if (!id || busyRef.current.has(id)) return false;
    const wasSaved = idsRef.current.has(id);
    if (wasSaved === next) return true;
    const address = uuid || itemsRef.current.find((p) => p.id === id)?.uuid || id;
    const previousItem = itemsRef.current.find((p) => p.id === id);

    setBusy(id, true);
    setError(null);
    setIds((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(id); else copy.delete(id);
      return copy;
    });
    if (!next) setItems((prev) => prev.filter((p) => p.id !== id));

    try {
      if (next) await saveProperty(address); else await unsaveProperty(address);
      if (next) await loadAll({ silent: true }).catch(() => {});
      return true;
    } catch (err) {
      setError(err);
      setIds((prev) => {
        const copy = new Set(prev);
        if (next) copy.delete(id); else copy.add(id);
        return copy;
      });
      if (!next && previousItem) {
        setItems((prev) => (prev.some((p) => p.id === id) ? prev : [previousItem, ...prev]));
      }
      return false;
    } finally {
      setBusy(id, false);
    }
  }, [loadAll, setBusy]);

  const save = useCallback((id, uuid) => write(id, uuid, true), [write]);
  const unsave = useCallback((id, uuid) => write(id, uuid, false), [write]);

  /** Two identifiers, deliberately: `id` is the routing token this context keys on, `uuid` the row's primary key. */
  const toggle = useCallback(async (id, uuid) => {
    const next = !idsRef.current.has(id);
    const ok = await write(id, uuid, next);
    return ok ? next : idsRef.current.has(id);
  }, [write]);

  const reload = useCallback(async () => {
    try {
      return await loadAll();
    } catch (err) {
      setError(err);
      setStatus('error');
      setLoading(false);
      throw err;
    }
  }, [loadAll]);

  const value = useMemo(
    () => ({ items, ids, count: ids.size, loading, status, error, busyIds, has, save, unsave, toggle, reload, refresh: reload }),
    [items, ids, loading, status, error, busyIds, has, save, unsave, toggle, reload],
  );
  return <SavedContext.Provider value={value}>{children}</SavedContext.Provider>;
}

/* Null-safe stub outside the provider so a component rendered in isolation degrades to "nothing
   saved" instead of throwing on `.has`. */
export function useSaved() {
  return useContext(SavedContext) ?? EMPTY;
}

const EMPTY = {
  items: [],
  ids: new Set(),
  count: 0,
  loading: false,
  status: 'ready',
  error: null,
  busyIds: new Set(),
  has: () => false,
  save: async () => false,
  unsave: async () => false,
  toggle: async () => false,
  reload: async () => {},
  refresh: async () => {},
};
