import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { listSaved, listSavedKeys, saveProperty, unsaveProperty } from '../services/savedService.js';
import { useAuth } from './AuthContext.jsx';

/* Saved membership is held as keys, so result cards answer from memory and the shell never
   downloads the cards themselves; the pages that draw them read `useSavedItems`. */
const SavedContext = createContext(null);

const ITEMS_PAGE_SIZE = 100;
const FOREGROUND_RELOAD_MS = 30000;

export function SavedProvider({ children }) {
  const { isIn } = useAuth();
  // routing token (slug || uuid) -> uuid, because the writes take the uuid
  const [keys, setKeys] = useState(() => new Map());
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState(isIn ? 'loading' : 'ready');
  const [error, setError] = useState(null);
  const [busyIds, setBusyIds] = useState(() => new Set());
  const keysRef = useRef(keys);
  const busyRef = useRef(new Set());
  const lastForegroundReload = useRef(0);

  useEffect(() => { keysRef.current = keys; }, [keys]);

  const applyKeys = useCallback((rows) => {
    setKeys(new Map(rows.map((k) => [k.token, k.uuid])));
    setError(null);
    setStatus('ready');
  }, []);

  const loadAll = useCallback(async ({ silent = false } = {}) => {
    if (!isIn) {
      applyKeys([]);
      return [];
    }
    if (!silent) {
      setLoading(true);
      setStatus('loading');
    }
    const rows = await listSavedKeys();
    applyKeys(rows);
    if (!silent) setLoading(false);
    return rows;
  }, [applyKeys, isIn]);

  useEffect(() => {
    if (!isIn) {
      applyKeys([]);
      setLoading(false);
      return undefined;
    }
    let alive = true;
    setLoading(true);
    setStatus('loading');
    listSavedKeys()
      .then((rows) => { if (alive) applyKeys(rows); })
      .catch((err) => {
        if (!alive) return;
        setError(err);
        setStatus('error');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [applyKeys, isIn]);

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

  const ids = useMemo(() => new Set(keys.keys()), [keys]);
  const has = useCallback((id) => keys.has(id), [keys]);

  const setBusy = useCallback((id, busy) => {
    if (busy) busyRef.current.add(id);
    else busyRef.current.delete(id);
    setBusyIds(new Set(busyRef.current));
  }, []);

  const write = useCallback(async (id, uuid, next) => {
    if (!id || busyRef.current.has(id)) return false;
    const wasSaved = keysRef.current.has(id);
    if (wasSaved === next) return true;
    const address = uuid || keysRef.current.get(id) || id;
    const flip = (on) => setKeys((prev) => {
      const copy = new Map(prev);
      if (on) copy.set(id, address); else copy.delete(id);
      return copy;
    });

    setBusy(id, true);
    setError(null);
    flip(next);
    try {
      if (next) await saveProperty(address); else await unsaveProperty(address);
      return true;
    } catch (err) {
      setError(err);
      flip(!next);
      return false;
    } finally {
      setBusy(id, false);
    }
  }, [setBusy]);

  const save = useCallback((id, uuid) => write(id, uuid, true), [write]);
  const unsave = useCallback((id, uuid) => write(id, uuid, false), [write]);

  /** Two identifiers, deliberately: `id` is the routing token this context keys on, `uuid` the row's primary key. */
  const toggle = useCallback(async (id, uuid) => {
    const next = !keysRef.current.has(id);
    const ok = await write(id, uuid, next);
    return ok ? next : keysRef.current.has(id);
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
    () => ({ ids, count: ids.size, loading, status, error, busyIds, has, save, unsave, toggle, reload, refresh: reload }),
    [ids, loading, status, error, busyIds, has, save, unsave, toggle, reload],
  );
  return <SavedContext.Provider value={value}>{children}</SavedContext.Provider>;
}

/* Null-safe stub outside the provider so a component rendered in isolation degrades to "nothing
   saved" instead of throwing on `.has`. */
export function useSaved() {
  return useContext(SavedContext) ?? EMPTY;
}

/** The shortlist's cards, for the pages that draw them. Re-read only when the key set gains an id
 * (or, for a short `size`, loses one that may have hidden others); removals filter locally. */
export function useSavedItems({ size = ITEMS_PAGE_SIZE } = {}) {
  const saved = useSaved();
  const { isIn } = useAuth();
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState(isIn ? 'loading' : 'ready');
  const loadedFor = useRef(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const n = ++seq.current;
    try {
      const res = await listSaved({ size });
      if (n === seq.current) {
        setRows(res.items);
        setStatus('ready');
      }
      return res;
    } catch (err) {
      if (n === seq.current) setStatus('error');
      throw err;
    }
  }, [size]);

  const { ids, status: keysStatus, busyIds, reload: reloadKeys } = saved;

  useEffect(() => {
    if (!isIn) {
      loadedFor.current = null;
      setRows([]);
      setStatus('ready');
      return;
    }
    // A heart mid-write is in `ids` before the server has the row; read once the write settles.
    if (keysStatus !== 'ready' || busyIds.size) return;
    const prev = loadedFor.current;
    const stale = !prev
      || [...ids].some((id) => !prev.has(id))
      || (ids.size < prev.size && prev.size > size);
    if (!stale) return;
    loadedFor.current = ids;
    load().catch(() => {});
  }, [isIn, keysStatus, busyIds, ids, size, load]);

  const items = useMemo(() => rows.filter((p) => ids.has(p.id)), [rows, ids]);
  const reload = useCallback(() => Promise.all([reloadKeys(), load()]), [reloadKeys, load]);
  const merged = saved.status === 'error' ? 'error' : saved.status === 'loading' ? 'loading' : status;
  return { ...saved, items, status: merged, reload, refresh: reload };
}

const EMPTY = {
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