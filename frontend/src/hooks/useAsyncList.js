import { useCallback, useEffect, useState } from 'react';

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
 * This hook does **not** touch the connectivity store. It used to (D128), which quietly made the
 * app-wide banner a function of which surfaces happened to use this hook; the nudge now fires in
 * `services/http.js`, under every provider call whether it is loaded through here or not (D166).
 * So a loader backed by the mock seam correctly reports nothing, and a live one reports once.
 *
 * @param {() => Promise<unknown[]>} loader
 * @param {unknown[]} deps      re-run the loader when any of these change
 * @param {boolean} [enabled]   false resolves to an empty ready list without calling `loader`
 * @returns {[unknown[], 'loading'|'ready'|'error', Function, () => void, unknown]}
 *          `[list, status, setList, retry, error]` — `error` is the rejection value, so a caller
 *          that wants to word its message differently for an unreachable server can pass it to
 *          `isReachabilityFailure`.
 */
export default function useAsyncList(loader, deps, enabled = true) {
  const [state, setState] = useState({ list: [], status: 'loading', error: null });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!enabled) { setState({ list: [], status: 'ready', error: null }); return undefined; }
    let live = true;
    setState((s) => ({ list: s.list, status: 'loading', error: null }));
    loader()
      .then((d) => {
        if (live) setState({ list: d || [], status: 'ready', error: null });
      })
      .catch((err) => {
        if (live) setState({ list: [], status: 'error', error: err });
      });
    return () => { live = false; };
  }, [...deps, enabled, nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const setList = useCallback(
    (u) => setState((s) => ({ list: typeof u === 'function' ? u(s.list) : u, status: 'ready', error: null })),
    [],
  );
  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return [state.list, state.status, setList, retry, state.error];
}
