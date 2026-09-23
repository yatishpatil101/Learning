/* Whether the API this tab has been talking to has since been replaced by a deploy, so an open tab
   can be told before it spends a form on a request the new contract will reject.

   The first `X-Draazy-Build` seen is the baseline and any different value latches. The latch is
   load-bearing: Cloud Run drains old instances, so the stamp alternates for a few seconds and an
   unlatched banner would flap through every deploy. Nothing is persisted, nothing polls (an idle
   tab has no stale contract), and it never auto-reloads — the wizard holds its steps in memory. */
import { useSyncExternalStore } from 'react';
import { observeBuildStamp } from '../services/http.js';

/** First stamp this tab saw. Null until the first response that carried one. */
let baseline = null;

/** A stamp different from the baseline, once seen. Latched — see the header. */
let pending = null;

/** The `pending` value the user dismissed, so a later, different deploy can still speak up. */
let dismissed = null;

let snapshot = { updateReady: false };

const listeners = new Set();

function publish() {
  const updateReady = pending !== null && pending !== dismissed;
  // `useSyncExternalStore` compares snapshots by identity, so this must only be rebuilt when the
  // value actually changes — returning a fresh object per read loops forever.
  if (updateReady === snapshot.updateReady) return;
  snapshot = { updateReady };
  for (const notify of listeners) notify();
}

/* A null stamp means "no information", never "unchanged": that is the steady state against a
   backend built outside the Maven lifecycle. */
function noteBuildStamp(stamp) {
  if (!stamp) return;
  if (baseline === null) {
    baseline = stamp;
    return;
  }
  if (stamp === baseline || stamp === pending) return;
  pending = stamp;
  publish();
}

/** Hide the prompt until a *further* deploy lands. The user has declined this one, not all of them. */
export function dismissUpdate() {
  dismissed = pending;
  publish();
}

/* Early enough only because the sole reader, `ConnectivityBanner`, is a *static* import of both
   layouts. Making either layout `React.lazy` would move this into a route chunk and take the
   baseline from whichever response happens to arrive after that chunk lands. */
observeBuildStamp(noteBuildStamp);

function subscribe(onChange) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

const getSnapshot = () => snapshot;

/** `{ updateReady }` — true once a different build has answered and the user has not waved it off. */
export function useAppUpdate() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
