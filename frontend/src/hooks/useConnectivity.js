/* Connectivity state for the whole app — one module-level store, two honest signals.
 *
 * D128: the app had no connectivity state at all (`navigator.onLine` returned zero matches across
 * `src/`). The service worker serves a cached shell, so on a dropped connection the app rendered
 * normally and every data call failed silently — the user got an empty page rather than an
 * explanation. On the target device (mid-range Android, patchy 4G) that is the common case, not
 * the edge case.
 *
 * Two signals, deliberately kept apart, because conflating them is how a UI starts lying:
 *
 *   offline      The OS says no interface is up — `navigator.onLine === false`, kept current by
 *                the window `online`/`offline` events. Confident: nothing is going to work.
 *
 *   unreachable  The OS says we are online but a request never reached the server.
 *                `navigator.onLine === true` only means *an interface exists*, not that the
 *                internet is behind it: a captive portal, a dead uplink, or a lapsed data pack all
 *                report online. So this verdict is a hedge, and the copy hedges with it — the
 *                banner says "can't reach Draazy", never "you are offline".
 *
 * What is NOT a connectivity failure: any answer from the server. A 500, a 404 or a 422 all mean
 * the request arrived, so painting a confident offline banner over one would be a *wrong*
 * explanation, which is only marginally better than none. Only {@link NetworkError} — thrown by
 * `services/http.js` when `fetch` itself rejects — counts.
 *
 * There is no heartbeat. Polling a health endpoint to keep this fresh would burn battery and data
 * on exactly the device this exists for, so the store is nudged by traffic the app was making
 * anyway: a request that fails to reach the server sets `unreachable`, a request that succeeds
 * clears it, and an `online` event clears it too (the interface is back, so the old verdict is
 * stale).
 *
 * That nudge now arrives from exactly one producer: `services/http.js`, which every provider call
 * passes through, via the {@link observeReachability} inversion at the bottom of this file (D166).
 * It used to be wired at call sites, which meant the two surfaces built on `useAsyncList` fed the
 * store and the other dozen did not — a dropped connection was explained on the document vault and
 * nowhere else. {@link noteNetworkFailure} / {@link noteNetworkSuccess} stay exported because they
 * are the store's write API and a non-http producer (a future WebSocket, say) would use them; they
 * are simply no longer something a call site has to remember.
 */
import { useSyncExternalStore } from 'react';
import { NetworkError, observeReachability } from '../services/http.js';

/** Set by {@link noteNetworkFailure}; cleared by a success or by the interface coming back. */
let unreachable = false;

/** Cached snapshot object. `useSyncExternalStore` compares by identity, so this must only be
 *  rebuilt when the value actually changes — returning a fresh object per read loops forever. */
let snapshot = { status: 'online' };

const listeners = new Set();

function readStatus() {
  // `navigator` is guarded for the parity harnesses, which load app modules under Node.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  return unreachable ? 'unreachable' : 'online';
}

function publish() {
  const status = readStatus();
  if (status === snapshot.status) return;
  snapshot = { status };
  for (const notify of listeners) notify();
}

/* The interface came back, so whatever we concluded from the last failed request is stale — give
   the network the benefit of the doubt rather than leaving a banner up that nothing will clear. */
function handleOnline() {
  unreachable = false;
  publish();
}

function subscribe(onChange) {
  listeners.add(onChange);
  // Window listeners are attached once for the whole app and torn down when the last consumer
  // unmounts, so this leaks nothing whether the banner is the only reader or one of several.
  if (listeners.size === 1) {
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', publish);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', publish);
    }
  };
}

const getSnapshot = () => snapshot;

/**
 * True when a rejected promise means "the request never reached the server", as opposed to "the
 * server answered and said no". Exported so a caller can branch on the same rule the banner uses
 * instead of re-deriving it — the two disagreeing is how a 500 would end up captioned "offline".
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isReachabilityFailure(err) {
  return err instanceof NetworkError;
}

/**
 * Tell the store a request just failed. Non-network failures (an `ApiError` of any status, a bug
 * in a mapper) are ignored, so a server error never paints a connectivity banner.
 *
 * @param {unknown} err the rejection value
 * @returns {boolean} whether it counted as a reachability failure
 */
export function noteNetworkFailure(err) {
  if (!isReachabilityFailure(err)) return false;
  unreachable = true;
  publish();
  return true;
}

/** Tell the store a request reached the server. Cheap no-op unless we were claiming otherwise. */
export function noteNetworkSuccess() {
  if (!unreachable) return;
  unreachable = false;
  publish();
}

/**
 * Subscribe to connectivity.
 *
 * @returns {{ status: 'online' | 'offline' | 'unreachable' }}
 */
export function useConnectivity() {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/* The one wire between the HTTP client and this store, registered on import rather than by a
   component, so the store is already listening before the first provider call — several fire from
   Context effects that mount above the banner. Importing this module is enough; nothing has to
   remember to switch it on.

   `err` is the rejection http.js is about to throw, or null for "the server answered", and it is
   run through the same {@link isReachabilityFailure} rule every other producer uses. Repeats are
   free: both writes below are latches that publish only on a real change, so the second report of
   a 401-recovered call (original attempt + replay) settles on the verdict the first one already
   reached. */
observeReachability((err) => {
  if (err) noteNetworkFailure(err);
  else noteNetworkSuccess();
});
