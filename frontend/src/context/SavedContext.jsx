import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { listSaved, saveProperty, unsaveProperty } from '../services/savedService.js';
import { useAuth } from './AuthContext.jsx';

/**
 * The caller's saved-property shortlist, held once for the whole app.
 *
 * ## Why this exists at all
 *
 * Every result card asks "is this one saved?" to draw its heart. That used to be a synchronous
 * localStorage read, so asking thirty times to render thirty cards cost nothing. Against a real API
 * the same question is a network call, and the naive conversion — `await isSaved(id)` per card — is
 * thirty requests to draw thirty hearts, on every scroll of every results page.
 *
 * So membership is not a request. The shortlist is fetched once, kept as a Set, and `has(id)`
 * answers from memory in O(1). The network is touched only when the user actually saves or unsaves
 * something. This mirrors `CompareContext`, which solves the same problem for the compare tray.
 *
 * ## Writes are optimistic
 *
 * A heart must respond to the tap, not to the round trip — a spinner on a heart is worse than the
 * feature. `toggle` flips the Set immediately, fires the write, and **puts the id back if the write
 * fails**. Rolling back matters more than it looks: without it a failed save leaves a filled heart
 * over a property the server never recorded, and the user only discovers it when the shortlist is
 * empty on their phone.
 *
 * ## Signed out
 *
 * The shortlist is caller-scoped, and the API 401s without a session. Every heart in the app already
 * redirects to sign-in before calling `toggle`, so this holds an empty set rather than a separate
 * anonymous shortlist — one that could never be merged into the real one on sign-in anyway.
 */
const SavedContext = createContext(null);

/** Large enough that a real shortlist arrives whole; see the note on `loadAll` below. */
const PAGE_SIZE = 500;

export function SavedProvider({ children }) {
  const { isIn } = useAuth();
  const [items, setItems] = useState([]);
  const [ids, setIds] = useState(() => new Set());
  const [loading, setLoading] = useState(false);

  /**
   * Fetch the whole shortlist in one page.
   *
   * A shortlist grows only through the user's own saves, so it is bounded by their own effort in a
   * way that, say, an owner's contact inbox is not — that one grows with other people's demand and
   * genuinely needs paging. One large page is the same bridge `propertyProvider` takes, for the same
   * reason: the alternative is a paged id set, which would leave hearts wrong on the results page
   * for anyone who has saved more than one page worth.
   */
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
      // An unreachable shortlist renders as empty hearts, never as filled ones. That is the safe
      // direction: an unfilled heart invites a save the server will accept, whereas a filled one
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

  /**
   * Flip one property's saved state.
   *
   * @returns {Promise<boolean>} the state it settled on — `true` when now saved. Callers use this
   *   for their toast, so on a rollback they are told what actually happened rather than what was
   *   attempted.
   */
  const toggle = useCallback(async (id) => {
    const wasSaved = ids.has(id);
    const next = !wasSaved;

    // Optimistic: the heart fills on tap. `items` is updated too, so the Saved page reorders in the
    // same frame instead of waiting for a refetch.
    setIds((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(id); else copy.delete(id);
      return copy;
    });
    if (!next) setItems((prev) => prev.filter((p) => p.id !== id));

    try {
      if (next) await saveProperty(id); else await unsaveProperty(id);
      // A save adds a card the shortlist does not have the body for yet. Refetch rather than guess
      // at the summary from whatever the card happened to be holding, so the Saved page shows the
      // server's row and not a locally assembled lookalike.
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
  }, [ids, loadAll]);

  const value = useMemo(
    () => ({ items, ids, count: ids.size, loading, has, toggle, refresh: loadAll }),
    [items, ids, loading, has, toggle, loadAll],
  );
  return <SavedContext.Provider value={value}>{children}</SavedContext.Provider>;
}

/**
 * The shortlist.
 *
 * Returns a null-safe stub outside the provider so a component rendered in isolation — a test
 * harness, a storybook page — degrades to "nothing saved" instead of throwing on `.has`.
 */
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
