/** Queue, timer and rules for page-view collection. Batching keeps the beacon far under `WriteRateLimitFilter`'s
 * 120 writes a minute, so telemetry cannot cause a 429 on a visitor's enquiry. */
import { recordPageViews } from '../../services/pageViewService.js';
import { CONSENT_CHANGE, hasAnalyticsConsent } from '../../components/CookieConsent.jsx';
import { toRoutePattern, isBackOffice } from './routePatterns.js';

/** sessionStorage, never localStorage: the id dies with the tab
 * so sessions can't be correlated into a browsing profile. */
const SESSION_KEY = 'pn.pv.sid';

const FLUSH_INTERVAL_MS = 60_000;

/** Stays below the server's cap of 50: a queue that fills between the length check and the send would 400 and discard the whole flush. */
const MAX_QUEUED = 40;

const TABLET_MIN_PX = 768;
const DESKTOP_MIN_PX = 1024;

let queue = [];
// The consent state the queued views and the current session id were collected under.
let queueAttributed = null;
let timer = null;
let started = false;
let memorySessionId = null;

/** 32 URL-safe chars; avoids `crypto.randomUUID` (absent on insecure LAN origins used for phone testing), and only needs to not collide. */
const mintId = () => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  const size = 32;
  const out = new Array(size);

  const values = new Uint8Array(size);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(values);
  } else {
    for (let i = 0; i < size; i += 1) values[i] = Math.floor(Math.random() * 256);
  }
  for (let i = 0; i < size; i += 1) out[i] = alphabet[values[i] % alphabet.length];
  return out.join('');
};

/** Storage access is wrapped: reading it throws in Safari
 * private mode, and analytics must not break navigation.  */
const sessionId = () => {
  try {
    const existing = globalThis.sessionStorage?.getItem(SESSION_KEY);
    if (existing) return existing;
    const minted = mintId();
    globalThis.sessionStorage?.setItem(SESSION_KEY, minted);
    return minted;
  } catch {
    if (!memorySessionId) memorySessionId = mintId();
    return memorySessionId;
  }
};

/** Read at emit time: rotation or moving to another monitor changes the experience being measured mid-session. */
const device = () => {
  const width = globalThis.innerWidth || DESKTOP_MIN_PX;
  if (width < TABLET_MIN_PX) return 'mobile';
  if (width < DESKTOP_MIN_PX) return 'tablet';
  return 'desktop';
};

/** Same-origin referrers are dropped, or every internal
 * navigation would make the site its own top traffic source.  */
const referrerHost = () => {
  try {
    const raw = globalThis.document?.referrer;
    if (!raw) return undefined;
    const host = new URL(raw).hostname;
    if (!host || host === globalThis.location?.hostname) return undefined;
    return host;
  } catch {
    return undefined;
  }
};

/** A failed batch is not re-queued: retrying on a flaky link would
 * turn a degraded network into a load spike on the server. */
const flush = () => {
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];

  const at = Date.now();
  recordPageViews({
    sessionId: sessionId(),
    events: batch.map((e) => ({
      path: e.path,
      referrerHost: e.referrerHost,
      device: e.device,
      // Floored because a clock that steps backwards between the two readings would otherwise
      // produce a negative, which the server rejects -- losing the whole batch over an artefact.
      agoMs: Math.max(0, at - e.at),
    })),
    attributed: queueAttributed === true,
  });
};

/** A consent change ends the session so views sent under the old answer cannot be joined to attributed ones through `session_id`. */
const followConsent = () => {
  const attributed = hasAnalyticsConsent();
  if (attributed === queueAttributed) return;
  if (queueAttributed !== null) {
    flush();
    memorySessionId = null;
    try { globalThis.sessionStorage?.removeItem(SESSION_KEY); } catch { /* storage blocked */ }
  }
  queueAttributed = attributed;
};

/** Records one page view per route change; back-office routes return before queueing, so no per-session record of which staff opened which queue exists. */
export const recordPageView = (pathname) => {
  const path = toRoutePattern(pathname);
  if (isBackOffice(path)) return;

  followConsent();
  queue.push({
    path,
    referrerHost: referrerHost(),
    device: device(),
    at: Date.now(),
  });

  if (queue.length >= MAX_QUEUED) flush();
};

/** Starts the flush timer (idempotent; returns its teardown). Uses `visibilitychange`, not `beforeunload`, which is unreliable on mobile and defeats the back/forward cache. */
export const startPageViewBeacon = () => {
  if (started) return () => {};
  started = true;

  const onHidden = () => {
    if (globalThis.document?.visibilityState === 'hidden') flush();
  };

  timer = globalThis.setInterval(flush, FLUSH_INTERVAL_MS);
  globalThis.document?.addEventListener('visibilitychange', onHidden);
  // At the change, not the next view: a reload in between would keep the old id under the new answer.
  globalThis.addEventListener?.(CONSENT_CHANGE, followConsent);

  return () => {
    started = false;
    if (timer) globalThis.clearInterval(timer);
    timer = null;
    globalThis.document?.removeEventListener('visibilitychange', onHidden);
    globalThis.removeEventListener?.(CONSENT_CHANGE, followConsent);
    flush();
  };
};
