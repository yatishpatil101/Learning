import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { followSociety, listFollowedSocieties, unfollowSociety } from '../services/societyService.js';
import { useAuth } from './AuthContext.jsx';

/**
 * The societies the caller follows, held once for the whole app (D227).
 *
 * ## Why this exists at all
 *
 * Following was `dzFollowedSocieties`, a localStorage array read synchronously by five separate
 * surfaces. Following on a laptop did not follow on a phone, and the hub's follower count — which
 * the server computes from `society_follows` — counted nobody, because nothing ever wrote a row.
 *
 * The five surfaces could not be ported one at a time, and the reason is worth stating because it
 * is not obvious: the server has had `followedByMe` on every society row since slice 8, so the
 * *directory* could have gone alone. The other four ask "which ones do I follow?" with no page of
 * societies to hang the question on — the dashboard tile counts them, the panel lists them, the
 * finder marks its own results. `GET /me/societies/following` is what makes those answerable, and
 * porting the directory without it would have left two follow sets disagreeing on one screen.
 *
 * ## Membership is not a request
 *
 * `SocietyFinder` asks `has(slug)` once per search result and the directory once per card. Against
 * a real API the naive conversion is one request per row. So the set is fetched once and `has`
 * answers from memory in O(1) — the same shape, and the same reason, as `SavedContext`.
 *
 * ## Writes are optimistic
 *
 * A follow button must respond to the tap. `toggle` flips the Set immediately, fires the write, and
 * puts it back if the write fails. Rolling back matters: without it a failed follow leaves a
 * "Following" badge over a society the server never recorded, and the user finds out by never
 * getting the alert they signed up for.
 *
 * ## Societies this browser invented — a set that is now drained, never filled
 *
 * Adding a missing society used to mint it into `localStorage` and nowhere else, so the server
 * 404'd a follow on a slug it had never heard of — correctly; it will not write a dangling foreign
 * key. Those follows were kept in a **local** set, which was the right call at the time: the
 * society did not exist on the other device either, and syncing the follow would have put a row on
 * the phone pointing at nothing.
 *
 * `POST /societies` now mints a real row, so a follow is refused only when something is genuinely
 * wrong, and a refusal is rolled back like any other failed write rather than quietly stored. The
 * local set stays for one reason: every browser that added a society before this migration still
 * holds those follows, and they are somebody's alerts for their own building. {@link promote}
 * retries them on load, so each one lands the moment ops give the slug a real row — and the set
 * empties itself and is never added to again.
 */
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
  const [loading, setLoading] = useState(false);

  /**
   * Retry the browser-only follows against the server.
   *
   * Each one is a society this browser minted. A 404 means the slug is still local, which is the
   * expected answer and not an error worth surfacing. Anything that succeeds is a society ops have
   * since created, so the follow moves to the server and stops being this browser's problem.
   *
   * @returns {Promise<string[]>} the ones still local afterwards
   */
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
    const next = new Set([...remote, ...still]);
    setSlugs(next);
    return next;
  }, [promote]);

  useEffect(() => {
    if (!isIn) {
      setSlugs(new Set());
      return undefined;
    }
    let alive = true;
    setLoading(true);
    loadAll()
      // An unreachable follow list renders as nothing followed, never as followed. That is the safe
      // direction: an unfollowed society invites a follow the server will accept, whereas a
      // "Following" badge claims an alert that may not exist.
      .catch(() => { if (alive) setSlugs(new Set()); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [isIn, loadAll]);

  const has = useCallback((slug) => slugs.has(slug), [slugs]);

  /**
   * Flip one society's followed state.
   *
   * @param {string} slug the society's public key — never an id. `soc.id` is the synthetic `S01`
   *   minted by `data/societies.js`; the server keys on a UUID and accepts the slug as the public
   *   alias. `SavedContext` documents the shipped bug that came of addressing a write with the
   *   wrong one of two identifiers.
   * @returns {Promise<boolean>} the state it settled on — `true` when now followed. Callers use
   *   this for their toast, so a rollback tells them what happened rather than what was attempted.
   */
  const toggle = useCallback(async (slug) => {
    if (!slug) return false;
    const wasFollowed = slugs.has(slug);
    const next = !wasFollowed;

    setSlugs((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(slug); else copy.delete(slug);
      return copy;
    });

    try {
      if (next) await followSociety(slug); else await unfollowSociety(slug);
      // A successful server write means the slug is real, so drop any local placeholder for it.
      const local = readLocal();
      if (local.includes(slug)) writeLocal(local.filter((s) => s !== slug));
      return next;
    } catch {
      /* Roll back, and drop any pre-migration local placeholder for this slug on the way.
         A refused follow used to be kept locally instead, because it meant "a society only this
         browser has". It cannot mean that any more — adding a society writes a real row before
         anybody follows it — so a refusal now means the write genuinely failed, and showing the
         member as subscribed to alerts they will not receive is the one outcome worth avoiding. */
      const local = readLocal();
      if (local.includes(slug)) writeLocal(local.filter((s) => s !== slug));
      setSlugs((prev) => {
        const copy = new Set(prev);
        if (next) copy.delete(slug); else copy.add(slug);
        return copy;
      });
      return !next;
    }
  }, [slugs]);

  const value = useMemo(
    () => ({ slugs, count: slugs.size, loading, has, toggle, refresh: loadAll }),
    [slugs, loading, has, toggle, loadAll],
  );
  return <FollowContext.Provider value={value}>{children}</FollowContext.Provider>;
}

/**
 * The follow set.
 *
 * Returns a null-safe stub outside the provider so a component rendered in isolation — a test
 * harness, a storybook page — degrades to "nothing followed" instead of throwing on `.has`.
 */
export function useFollows() {
  return useContext(FollowContext) ?? EMPTY;
}

const EMPTY = {
  slugs: new Set(),
  count: 0,
  loading: false,
  has: () => false,
  toggle: async () => false,
  refresh: async () => new Set(),
};
