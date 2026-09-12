/**
 * The page view beacon — a queue, a timer, and the rules about what is worth recording.
 *
 * Collection only. What may be sent lives in `routePatterns.js`; where it goes lives in
 * `services/pageViewService.js`; why any of it exists lives in that service's docblock.
 *
 * ## Why it batches
 *
 * A request per route change would spend a visitor's entire write budget on telemetry.
 * `WriteRateLimitFilter` allows 120 mutating requests a minute per caller, shared with everything
 * else they do, and clicking through listings produces route changes at a rate that competes with
 * that. The first casualty would not be the analytics — it would be the enquiry the visitor tried to
 * send afterwards, refused with a 429 because a beacon had already spent the budget. It would also
 * 429 the e2e suite, which navigates faster than any human, and the tests it broke would have
 * nothing to do with the change that broke them.
 *
 * Fifteen seconds and forty events turn that into roughly four requests a minute.
 */
import { recordPageViews } from '../../services/pageViewService.js';
import { toRoutePattern, isBackOffice } from './routePatterns.js';

/**
 * `sessionStorage`, deliberately, and never `localStorage`.
 *
 * The id dies with the tab. That is the privacy property the whole table rests on: sessions are
 * never correlated across visits, so the rows can never accumulate into a profile of one person's
 * browsing over weeks. A `localStorage` key would silently turn identical code into exactly that.
 */
const SESSION_KEY = 'pn.pv.sid';

const FLUSH_INTERVAL_MS = 15_000;

/**
 * Below the server's cap of 50, not equal to it. A queue that filled between the length check and
 * the send would otherwise produce a 400 that discards the whole flush — a rare, load-dependent
 * failure that would be nearly impossible to reproduce from the symptom.
 */
const MAX_QUEUED = 40;

const TABLET_MIN_PX = 768;
const DESKTOP_MIN_PX = 1024;

let queue = [];
let timer = null;
let started = false;
let memorySessionId = null;

/**
 * 32 characters of URL-safe randomness.
 *
 * `crypto.randomUUID` is deliberately not used: it is unavailable on insecure origins, which
 * includes the LAN address the app is opened on when testing from a phone — the one situation where
 * a mobile/desktop split is worth measuring. `getRandomValues` has no such restriction, and the
 * `Math.random` fallback below it is fine because this token needs to be unguessable by nobody; it
 * only needs to not collide.
 */
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

/**
 * The current tab's session id, minting one on first use.
 *
 * Every access is wrapped, because `sessionStorage` does not merely return null when unavailable —
 * reading it *throws* in Safari private mode and wherever storage is blocked by policy. An
 * unguarded access here would take down the route change that called it, which is a visible
 * navigation failure caused entirely by analytics. The memory fallback keeps the session coherent
 * for as long as the page lives, which is all it was ever for.
 */
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

/**
 * Viewport bucket, read at emit time rather than once at startup.
 *
 * A tablet rotating and a window being dragged onto a second monitor genuinely change the experience
 * being measured, and a session that starts narrow and ends wide is a real thing that a
 * once-per-session reading would misreport for its entire length.
 */
const device = () => {
  const width = globalThis.innerWidth || DESKTOP_MIN_PX;
  if (width < TABLET_MIN_PX) return 'mobile';
  if (width < DESKTOP_MIN_PX) return 'tablet';
  return 'desktop';
};

/**
 * Host of the referring page, or undefined.
 *
 * Same-origin referrers are dropped: every internal navigation would otherwise report the site as
 * its own largest traffic source, which is both useless and actively misleading in a chart whose
 * entire job is to say where visitors come from.
 */
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

/**
 * Send whatever is queued.
 *
 * The queue is swapped out before the await, so views recorded while the request is in flight join
 * the next flush rather than being dropped by the reassignment when this one returns.
 *
 * **A failed batch is not re-queued.** That looks like data loss and is the right trade: retaining it
 * means a visitor on a flaky connection accumulates an unsendable queue and re-sends the whole thing
 * every fifteen seconds, so a degraded network becomes a self-inflicted load spike against the
 * server that is already struggling. Losing a handful of page views costs a rounding error in a
 * chart.
 */
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
  });
};

/**
 * Record one page view. Called on every route change.
 *
 * Back-office routes return before anything is queued. Filtering at the reader instead would still
 * have stored a per-session record of which moderator opened which queue and when — a staff activity
 * log arriving by accident, in a table that has no access controls designed for one. The only way to
 * not hold that data is to not collect it.
 *
 * @param {string} pathname
 */
export const recordPageView = (pathname) => {
  const path = toRoutePattern(pathname);
  if (isBackOffice(path)) return;

  queue.push({
    path,
    referrerHost: referrerHost(),
    device: device(),
    at: Date.now(),
  });

  if (queue.length >= MAX_QUEUED) flush();
};

/**
 * Start the flush timer. Idempotent; returns its own teardown.
 *
 * ## Why `visibilitychange` and not `beforeunload`
 *
 * `beforeunload` and `unload` are unreliable on mobile, where a tab is usually backgrounded and
 * killed rather than closed — so the last flush of a phone session, which is most sessions, would
 * simply not happen. Worse, registering a `beforeunload` listener suppresses the back/forward cache
 * in some browsers, and an analytics beacon that slows down every back button is not a trade worth
 * making. `visibilitychange` fires on the backgrounding that actually happens.
 *
 * @returns {() => void}
 */
export const startPageViewBeacon = () => {
  if (started) return () => {};
  started = true;

  const onHidden = () => {
    if (globalThis.document?.visibilityState === 'hidden') flush();
  };

  timer = globalThis.setInterval(flush, FLUSH_INTERVAL_MS);
  globalThis.document?.addEventListener('visibilitychange', onHidden);

  return () => {
    started = false;
    if (timer) globalThis.clearInterval(timer);
    timer = null;
    globalThis.document?.removeEventListener('visibilitychange', onHidden);
    flush();
  };
};
