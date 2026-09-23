/* Two signals kept apart: `offline` is the OS saying no interface is up, `unreachable` is a request
   that never arrived while `navigator.onLine` still claims true — a captive portal or a dead uplink
   both report online, so the banner hedges with "can't reach Draazy".

   Any answer from the server, 500 included, means the request arrived and is not a connectivity
   failure. There is no heartbeat: the store is nudged by traffic the app was making anyway, from
   the single {@link observeReachability} producer at the bottom of this file. */
import { useSyncExternalStore } from 'react';
import { NetworkError, observeReachability } from '../services/http.js';

/** Set by {@link noteNetworkFailure}; cleared by a success or by the interface coming back. */
let unreachable = false;

/** Cached snapshot object. `useSyncExternalStore` compares by identity, so this must only be
 *  rebuilt when the value actually changes — returning a fresh object per read loops forever. */
let snapshot = { status: 'online' };

const listeners = new Set();

function readStatus() {
  // `navigator` is absent wherever this module is loaded outside a browser, so the guard is what
  // keeps an import from throwing rather than a statement about connectivity.
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

/* True when a rejected promise means the request never reached the server, as opposed to the
   server answering and saying no. Exported so a caller branches on the rule the banner uses. */
export function isReachabilityFailure(err) {
  return err instanceof NetworkError;
}

/* Non-network failures are ignored, so a server error never paints a connectivity banner. */
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

/** @returns {{ status: 'online' | 'offline' | 'unreachable' }} */
export function useConnectivity() {
  return useSyncExternalStore(subscribe, getSnapshot);
}

/* Registered on import rather than by a component, so the store is listening before the first
   provider call — several fire from Context effects that mount above the banner. Repeats are free:
   both writes are latches that publish only on a real change. */
observeReachability((err) => {
  if (err) noteNetworkFailure(err);
  else noteNetworkSuccess();
});
