// Console / page-error tracking shared across specs.
//
// Specs assert `expect(consoleErrors).toEqual([])`, so this file is what decides
// what "a real error" means. The bar is narrow in both directions: the assertion
// must not fail because the laptop is offline or a CDN blipped, and it must not
// swallow the app throwing — swallowing is the worse failure, because it turns a
// green suite into a lie.
//
// The rule is **provenance, not wording** (tech-debt D28). A failed network
// request is judged by *whose server failed*, which Playwright tells us:
// `ConsoleMessage.location().url` is the URL of the resource that failed. So a
// map tile, a CDN image or an offline DNS lookup is dropped, while the app's own
// origin returning 404/500 is still an error — that one is us. Only two things
// are dropped on wording alone, and both carry their justification below.

/** Where the app under test is served from — everything else is someone else's server. */
const APP_ORIGIN = (() => {
  try {
    return new URL(process.env.BASE_URL || 'http://localhost:5173').origin;
  } catch {
    return 'http://localhost:5173';
  }
})();

/* Third-party code that complains through the page console instead of through a
   failed request, so there is no URL to judge it by. Every entry is a hostname
   or a library banner that cannot plausibly appear inside one of our own
   messages. This started as the **union** of every hand-rolled copy that used to
   live in the specs (tech-debt D96) — the local lists were not all subsets, so
   merging rather than picking one is what stopped that cleanup from silently
   tightening several specs.

   Deliberately NOT here — bare `ERR_`, bare `maps`, and (since D28) the bare
   `cdn`/`unpkg` forms: each is short enough to appear inside a genuine
   application error and hide the bug it was meant to surface. The host-anchored
   forms `cdn\.` and `unpkg\.com` cannot, and match the same real noise.

   Also gone in D28: `Failed to load resource`, `net::ERR`, `ERR_INTERNET`,
   `ERR_NETWORK`. Those four were the blanket that gutted this filter — they
   dropped the app's own 404s and 500s along with the tiles. Network failures are
   now decided by origin below, which keeps the offline tolerance and gets the
   app's own failures back. */
export const IGNORE =
  /favicon|leaflet|unpkg\.com|tile\.|openstreetmap|maptiler|googleapis|gstatic|unsplash|cdn\.|React DevTools/i;

/** Chromium's wording for "a resource did not load", including `net::ERR_*` causes. */
const RESOURCE_FAILURE = /^Failed to load resource|net::ERR_/i;

/* The Vite dev server's HMR transport. Dropped because it does not exist in a
   production build — nothing it says is a statement about the product — and
   because the socket drops whenever the dev server restarts, which another
   developer or agent session can trigger in the middle of an unrelated run.
   Scoped to the *transport*: a `[vite]` compile/import error is not matched and
   still fails the spec. The WebSocket clause is anchored to the app's own host,
   so an application websocket failing would still be reported. */
const VITE_HMR = new RegExp(
  '\\[vite\\] (?:connecting|server connection lost|failed to connect to websocket)'
    + `|WebSocket connection to 'wss?://${APP_ORIGIN.replace(/^https?:\/\//, '').replace(/[.:]/g, '\\$&')}`,
  'i',
);

/* An uncaught fetch rejection carries no URL, so it cannot be attributed by
   origin on its own — see the `requestfailed` bookkeeping in trackErrors. These
   are the exact browser wordings for "the network refused", anchored end-to-end
   so an application error that merely *contains* the phrase is not matched. */
const NETWORK_REJECTION =
  /^(?:Uncaught \(in promise\) )?(?:TypeError: )?(?:Failed to fetch|NetworkError when attempting to fetch resource\.?|Load failed)$/i;

const isAppOrigin = (url) => typeof url === 'string' && url.startsWith(APP_ORIGIN);

/**
 * Start collecting real (non-noise) console errors + uncaught page errors.
 * @param {import('@playwright/test').Page} page
 * @returns {string[]} live array that fills as the page runs.
 */
export function trackErrors(page) {
  const errors = [];

  /* Which requests actually failed, split by whose server they were aimed at.
     This is how an uncaught `Failed to fetch` gets attributed: if the only
     requests that died in this test went to someone else's host, the rejection
     is the network. If one of *our* requests died, it stays an error. */
  let externalRequestFailures = 0;
  let appRequestFailures = 0;
  page.on('requestfailed', (r) => {
    if (isAppOrigin(r.url())) appRequestFailures += 1;
    else externalRequestFailures += 1;
  });

  page.on('pageerror', (e) => {
    /* Previously unfiltered, which is why an offline machine failed specs that
       had nothing to do with the network: every filter above applied to console
       messages only. */
    const text = e.message;
    if (IGNORE.test(text) || VITE_HMR.test(text)) return;
    if (NETWORK_REJECTION.test(text) && externalRequestFailures > 0 && appRequestFailures === 0) return;
    errors.push(text);
  });

  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (IGNORE.test(text) || VITE_HMR.test(text)) return;
    if (RESOURCE_FAILURE.test(text)) {
      /* Chromium puts the failing resource in `location().url` and says nothing
         useful in the message, so the URL is the only thing worth judging. Noise
         is either somebody else's server, or one of the assets named in IGNORE
         even when our own dev server is the one serving it — `/favicon.ico` is
         the standing example. Anything else on our origin is our 404/500. */
      const url = m.location()?.url;
      if (!isAppOrigin(url) || IGNORE.test(url)) return;
    }
    errors.push(text);
  });

  return errors;
}
