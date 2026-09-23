import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { listSaved, saveProperty, unsaveProperty } from '../services/savedService.js';
import { useAuth } from './AuthContext.jsx';

/* Membership is held as a Set so a results page answers "is this saved?" thirty times from memory
   rather than with thirty requests. Writes are optimistic and roll back on failure; signed out
   holds an empty set, since the API 401s without a session. */
const SavedContext = createContext(null);

const PAGE_SIZE = 500;

export function SavedProvider({ children }) {
  const { isIn } = useAuth();
  const [items, setItems] = useState([]);
  const [ids, setIds] = useState(() => new Set());
  const [loading, setLoading] = useState(false);

  /* One large page rather than paging: a paged id set would leave hearts wrong on the results
     page for anyone who has saved more than one page worth. */
  const loadAll = useCallback(async () => {
    const res = await listSaved({ size: PAGE_SIZE });
    setItems(res.items);
    setIds(new Set(res.items.map((p) => p.id)));
    return res;
  }, []);

  useEffect(() => {
    if (!isIn) {
      setItems([]);
      setIds(new Set());
      return undefined;
    }
    let alive = true;
    setLoading(true);
    listSaved({ size: PAGE_SIZE })
      .then((res) => {
        if (!alive) return;
        setItems(res.items);
        setIds(new Set(res.items.map((p) => p.id)));
      })
      // An unreachable shortlist renders as empty hearts, never as filled ones: a filled heart
      // claims a save that may not exist.
      .catch(() => {
        if (!alive) return;
        setItems([]);
        setIds(new Set());
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [isIn]);

  const has = useCallback((id) => ids.has(id), [ids]);

  /* Two identifiers, deliberately: `id` is the routing token this context keys on, `uuid` the row's
     primary key. `PUT|DELETE /me/saved/{propId}` binds a UUID, so addressing the write with the
     routing token answers 400 and the optimistic heart silently rolls back. */
  const toggle = useCallback(async (id, uuid) => {
    const wasSaved = ids.has(id);
    const next = !wasSaved;
    const address = uuid || items.find((p) => p.id === id)?.uuid || id;

    // Optimistic: the heart fills on tap. `items` is updated too, so the Saved page reorders in the
    // same frame instead of waiting for a refetch.
    setIds((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(id); else copy.delete(id);
      return copy;
    });
    if (!next) setItems((prev) => prev.filter((p) => p.id !== id));

    try {
      if (next) await saveProperty(address); else await unsaveProperty(address);
      // A save adds a card the shortlist has no body for yet. Refetch rather than assemble a
      // lookalike summary from whatever the card happened to be holding.
      if (next) await loadAll();
      return next;
    } catch {
      setIds((prev) => {
        const copy = new Set(prev);
        if (next) copy.delete(id); else copy.add(id);
        return copy;
      });
      if (!next) await loadAll().catch(() => {});
      return wasSaved;
    }
  }, [ids, items, loadAll]);

  const value = useMemo(
    () => ({ items, ids, count: ids.size, loading, has, toggle, refresh: loadAll }),
    [items, ids, loading, has, toggle, loadAll],
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
  has: () => false,
  toggle: async () => false,
  refresh: async () => {},
};
