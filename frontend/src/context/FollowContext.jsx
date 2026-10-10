import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { followSociety, listFollowedSocieties, unfollowSociety } from '../services/societyService.js';
import { useAuth } from './AuthContext.jsx';

/** Fetched once so `has(slug)` answers from memory; a per-row request would be one per search result. */
const FollowContext = createContext(null);

/** Where follows for browser-only societies live until the server knows the slug. */
const LOCAL_KEY = 'dzLocalSocietyFollows';

const readLocal = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((s) => typeof s === 'string') : [];
  } catch {
    return [];
  }
};

const writeLocal = (slugs) => {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(slugs));
  } catch {
    // A full or blocked localStorage costs this browser its pending follows, not the session.
  }
};

export function FollowProvider({ children }) {
  const { isIn } = useAuth();
  const [slugs, setSlugs] = useState(() => new Set());
  // slug -> {slug, name, localitySlug, listingCount}, for the dashboard panel; `slugs` stays the toggle's truth.
  const [rows, setRows] = useState(() => new Map());
  const [loading, setLoading] = useState(false);
  const [writes, setWrites] = useState(0);
  // Read only once a screen asks: the shell itself draws no follow state.
  const [wanted, setWanted] = useState(false);
  const want = useCallback(() => setWanted(true), []);

  /** A 404 means the slug is still browser-local (expected); a success is a society ops have since created. */
  const promote = useCallback(async (pending) => {
    if (!pending.length) return pending;
    const settled = await Promise.all(pending.map(async (slug) => {
      try {
        await followSociety(slug);
        return null;
      } catch {
        return slug;
      }
    }));
    const still = settled.filter(Boolean);
    if (still.length !== pending.length) writeLocal(still);
    return still;
  }, []);

  const loadAll = useCallback(async () => {
    const remote = await listFollowedSocieties();
    const still = await promote(readLocal());
    const next = new Set([...remote.map((r) => r.slug), ...still]);
    setRows(new Map(remote.map((r) => [r.slug, r])));
    setSlugs(next);
    return next;
  }, [promote]);

  // Describes rows only; `slugs` is left to the optimistic toggle so a read racing a write cannot undo it.
  const refreshRows = useCallback(async () => {
    const remote = await listFollowedSocieties();
    setRows(new Map(remote.map((r) => [r.slug, r])));
  }, []);

  useEffect(() => {
    if (!isIn) {
      setSlugs(new Set());
      setRows(new Map());
      return undefined;
    }
    if (!wanted) return undefined;
    let alive = true;
    setLoading(true);
    loadAll()
      // An unreachable follow list reads as nothing followed: a
      // 'Following' badge would claim an alert that may not exist.
      .catch(() => { if (alive) setSlugs(new Set()); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [isIn, wanted, loadAll]);

  const has = useCallback((slug) => slugs.has(slug), [slugs]);

  /** Flips by slug (never the UUID id); resolves to the settled state so a rollback is reported accurately. */
  const toggle = useCallback(async (slug) => {
    if (!slug) return false;
    const wasFollowed = slugs.has(slug);
    const next = !wasFollowed;

    setSlugs((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(slug); else copy.delete(slug);
      return copy;
    });

    setWrites((n) => n + 1);
    try {
      if (next) await followSociety(slug); else await unfollowSociety(slug);
      // A successful server write means the slug is real, so drop any local placeholder for it.
      const local = readLocal();
      if (local.includes(slug)) writeLocal(local.filter((s) => s !== slug));
      return next;
    } catch {
      /* Roll back and drop any local placeholder: showing the member
         subscribed to alerts they won't receive is the outcome to avoid. */
      const local = readLocal();
      if (local.includes(slug)) writeLocal(local.filter((s) => s !== slug));
      setSlugs((prev) => {
        const copy = new Set(prev);
        if (next) copy.delete(slug); else copy.add(slug);
        return copy;
      });
      return !next;
    } finally {
      setWrites((n) => n - 1);
    }
  }, [slugs]);

  const value = useMemo(
    () => ({ slugs, rows, count: slugs.size, loading, busy: writes > 0, want, has, toggle, refresh: loadAll, refreshRows }),
    [slugs, rows, loading, writes, want, has, toggle, loadAll, refreshRows],
  );
  return <FollowContext.Provider value={value}>{children}</FollowContext.Provider>;
}

/** Outside the provider a null-safe stub means nothing followed, so isolated renders don't throw on `.has`. */
export function useFollows() {
  const ctx = useContext(FollowContext);
  const want = ctx?.want;
  useEffect(() => { want?.(); }, [want]);
  return ctx ?? EMPTY;
}

const EMPTY = {
  slugs: new Set(),
  rows: new Map(),
  count: 0,
  loading: false,
  busy: false,
  has: () => false,
  toggle: async () => false,
  refresh: async () => new Set(),
  refreshRows: async () => {},
};
