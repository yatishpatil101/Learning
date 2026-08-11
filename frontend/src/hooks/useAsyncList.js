import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * One async list with an honest lifecycle: `status` is `'loading'` until the first settle, then
 * `'ready'` or `'error'`. A failed load surfaces as an error the caller can render and retry —
 * never as a confident empty list, which is what made a broken `GET /me/documents/requests` read
 * as "no requests" and a broken vault read paint a wrong 0/N checklist (D125-1).
 *
 * `enabled=false` resolves straight to an empty ready list (the http `'portfolio'` bucket has no
 * server vault). `setList` applies a mutation's provider return value directly, so an
 * upload/delete/grant updates one list in place instead of a global refetch of all three (D125-4).
 * `retry` re-runs the loader, which is what the caller's error affordance is wired to.
 *
 * `refresh` is the same re-run without the skeletons, for pull-to-refresh: the list the user is
 * looking at stays on screen and a failure leaves it there rather than replacing it with an error
 * screen, because nothing was lost — they still have the results they had a moment ago. Crucially
 * it goes through the **same** sequencing as the effect, so whichever read started last is the one
 * that lands. Refreshing outside the hook (`loader().then(setList)`) cannot do that: an earlier
 * load still in flight would settle afterwards and overwrite, or reject and wipe, results that are
 * newer than it is.
 *
 * This hook does **not** touch the connectivity store. It used to (D128), which quietly made the
 * app-wide banner a function of which surfaces happened to use this hook; the nudge now fires in
 * `services/http.js`, under every provider call whether it is loaded through here or not (D166).
 * So a loader backed by the mock seam correctly reports nothing, and a live one reports once.
 *
 * @param {() => Promise<unknown[]>} loader
 * @param {unknown[]} deps      re-run the loader when any of these change
 * @param {boolean} [enabled]   false resolves to an empty ready list without calling `loader`
 * @returns {[unknown[], 'loading'|'ready'|'error', Function, () => void, unknown, () => Promise<void>]}
 *          `[list, status, setList, retry, error, refresh]` — `error` is the rejection value, so a
 *          caller that wants to word its message differently for an unreachable server can pass it
 *          to `isReachabilityFailure`.
 */
export default function useAsyncList(loader, deps, enabled = true) {
  const [state, setState] = useState({ list: [], status: 'loading', error: null });
  const [nonce, setNonce] = useState(0);
  /* Every read takes a ticket, and only the newest ticket may write. One shared counter across
     the effect and `refresh` is what makes them order each other instead of racing. */
  const seq = useRef(0);
  const mounted = useRef(true);
  /* Set on the way in as well as cleared on the way out. StrictMode mounts, unmounts and remounts
     the same instance in dev, and a ref survives that — clearing only on unmount would leave this
     false for the remount's load, so every list would sit on skeletons forever in development. */
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  useEffect(() => {
    if (!enabled) { setState({ list: [], status: 'ready', error: null }); return undefined; }
    seq.current += 1;
    const ticket = seq.current;
    const current = () => mounted.current && seq.current === ticket;
    setState((s) => ({ list: s.list, status: 'loading', error: null }));
    loader()
      .then((d) => {
        if (current()) setState({ list: d || [], status: 'ready', error: null });
      })
      .catch((err) => {
        if (current()) setState({ list: [], status: 'error', error: err });
      });
    return () => { seq.current += 1; };
  }, [...deps, enabled, nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const setList = useCallback(
    (u) => setState((s) => ({ list: typeof u === 'function' ? u(s.list) : u, status: 'ready', error: null })),
    [],
  );
  const retry = useCallback(() => setNonce((n) => n + 1), []);
  const refresh = useCallback(() => {
    seq.current += 1;
    const ticket = seq.current;
    return loaderRef.current()
      .then((d) => {
        if (mounted.current && seq.current === ticket) {
          setState({ list: d || [], status: 'ready', error: null });
        }
      })
      /* Deliberately silent. The caller already has a list on screen; a failed refresh means it
         is stale, not wrong, and an error screen would be a worse answer than the stale one. */
      .catch(() => {});
  }, []);
  return [state.list, state.status, setList, retry, state.error, refresh];
}
