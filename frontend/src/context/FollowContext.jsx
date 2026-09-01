import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { followSociety, listFollowedSocieties, unfollowSociety } from '../services/societyService.js';
import { useAuth } from './AuthContext.jsx';

/**
 * The societies the caller follows, held once for the whole app (D227).
 *
 * ## Why this exists at all
 *
 * Following was `pnFollowedSocieties`, a localStorage array read synchronously by five separate
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
 * ## Societies this browser invented
 *
 * `mintDemandSociety` creates a society in localStorage and follows it, so a seeker can be alerted
 * about a building PuneNest does not have yet. The server 404s a follow on a slug it has never
 * heard of, and correctly — it will not write a dangling foreign key.
 *
 * Those follows are therefore kept in a **local** set, and that is not a concession. The society
 * itself does not exist on the other device either; syncing the follow would put a row on the phone
 * pointing at nothing, which is worse than not syncing it. What the mint does do is drop an ops
 * lead, and if ops promote it to a real society the follow is promoted with it — {@link promote}
 * retries the local ones on every load, so the follow lands the first time the slug becomes real
 * without the user doing anything.
 */
const FollowContext = createContext(null);

/** Where follows for browser-only societies live until the server knows the slug. */
const LOCAL_KEY = 'pnLocalSocietyFollows';

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
      // A follow the server refuses is a society only this browser has (see the class note). Keep
      // it locally rather than rolling back, so the user who just minted their building stays
      // subscribed to it. An unfollow that fails has nothing to keep — drop it either way, since
      // the local set is the only place it could have lived.
      const local = readLocal();
      if (next) {
        if (!local.includes(slug)) writeLocal([slug, ...local]);
        return true;
      }
      writeLocal(local.filter((s) => s !== slug));
      return false;
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
