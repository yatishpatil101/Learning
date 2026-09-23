import { useCallback, useEffect, useRef, useState } from 'react';

/* A failed load surfaces as an error the caller can render and retry, never as a confident empty
   list. `refresh` re-runs without the skeletons and shares the effect's sequencing, so whichever
   read started last is the one that lands; `enabled=false` resolves to an empty ready list.
   Returns `[list, status, setList, retry, error, refresh]`. */
export default function useAsyncList(loader, deps, enabled = true) {
  const [state, setState] = useState({ list: [], status: 'loading', error: null });
  const [nonce, setNonce] = useState(0);
  /* Every read takes a ticket, and only the newest ticket may write. One shared counter across
     the effect and `refresh` is what makes them order each other instead of racing. */
  const seq = useRef(0);
  const mounted = useRef(true);
  /* Set on the way in as well as cleared on the way out: StrictMode remounts the same instance, so
     clearing only on unmount would leave every list on skeletons forever in development. */
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
