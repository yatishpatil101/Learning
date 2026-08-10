import { test, expect } from '../../fixtures/base.js';
import { open } from '../../helpers/app.js';

/* Connectivity: the offline banner, the *unreachable* hedge, and the list retry (D165).
 *
 * The register's objection to covering this was that it could not be covered: the mock providers
 * never reject and headless `navigator.onLine` is always true, so nothing a spec could do would
 * drive `hooks/useConnectivity.js` out of `'online'`. Both halves of that are answerable, and they
 * are answered differently, which is the point of this file.
 *
 *   offline      `context.setOffline(true)` really does flip `navigator.onLine` and fire the
 *                window events the store subscribes to. No network call is involved at all —
 *                the confident branch is a browser fact, so it is tested as one, on the plain
 *                mock-mode app.
 *
 *   unreachable  needs a request that leaves the app and fails, and in mock mode there is none:
 *                `page.route` can only intercept what the page actually sends. So these tests put
 *                exactly one domain (`property`) onto the http seam for the duration of the test
 *                — see `goLive()` — and then fault-inject `GET /api/properties`.
 *
 * The distinction between those two is the whole feature. `navigator.onLine === true` only means an
 * interface exists, not that the internet is behind it, so a failed request while the browser still
 * believes it is online must produce the hedged "Can't reach the server", never "You're offline".
 * Test 2 asserts `navigator.onLine` is *still true* at the moment the hedged copy is on screen, so
 * it cannot pass by accidentally having gone offline; test 1 asserts the confident copy appears
 * only when it really is false. Neither test can satisfy the other's assertions.
 *
 * And test 3 is the one that stops the banner crying wolf: a 500 means the request arrived, so it
 * is not a connectivity fact and must paint no banner at all — while the list still says something
 * went wrong, because it did.
 */

/* Copy is asserted verbatim from `i18n/locales/en/{common,listings,dashboard}.json`. These are
   existing strings — nothing here adds a key. */
const OFFLINE_TITLE = "You're offline.";
const UNREACHABLE_TITLE = "Can't reach the server.";
const RESTORED_TITLE = 'Back online.';
const LIST_UNREACHABLE = "We couldn't reach the server. Check your connection and try again.";
const LIST_SERVER_ERROR = "We couldn't load listings just now.";
const COUNT_UNAVAILABLE = 'Results unavailable';

/** The always-mounted live region from `components/ConnectivityBanner.jsx`. */
const region = (page) => page.locator('div[role="status"][aria-live="polite"][aria-atomic="true"]');
/** The card inside it, present only when there is something to say. */
const banner = (page) => page.locator('.pn-connectivity-card');
/** The list's failure affordance from `components/LoadError.jsx`. */
const retryButton = (page) => page.getByRole('button', { name: 'Retry' });
/* ResultsArea renders the count line twice — a `sm:hidden` phone copy and a desktop one — so both
   are in the DOM at every viewport and only one is ever painted. Filtering on visibility keeps the
   assertion exact (one line, on screen) instead of picking a copy by DOM order and hoping. */
const countLine = (page, text) => page.getByText(text, { exact: true }).filter({ visible: true });

const PROBE_SLUG = 'connectivity-probe-flat';

/* One `PropertySummary` on the wire, shaped for `providers/http/propertyMapper.js`. Deliberately a
   `buy`/`approved` row inside every default filter bound, so a successful retry has something to
   render and the assertion can be "the server's row is on screen" rather than the weaker "the
   error card went away". */
const PROBE_PAGE = {
  content: [
    {
      id: '00000000-0000-4000-8000-00000000d165',
      slug: PROBE_SLUG,
      title: 'Connectivity Probe Residency',
      deal: 'buy',
      status: 'approved',
      dealStatus: 'active',
      propertyType: 'Apartment',
      price: 9_500_000,
      priceUnit: 'total',
      area: 1150,
      areaUnit: 'sqft',
      bhk: 3,
      furnishing: 'semi',
      locality: 'Baner',
      localitySlug: 'baner',
      city: 'Pune',
      lat: 18.559,
      lng: 73.7868,
      possession: 'ready-to-move',
      coverImage: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2',
      images: [],
      amenities: [],
      owner: { id: '00000000-0000-4000-8000-00000000000a', name: 'Probe Owner', mobile: '98XXXXX210' },
      createdAt: '2026-01-01T00:00:00Z',
    },
  ],
  page: 0,
  size: 24,
  totalElements: 1,
  totalPages: 1,
};

/**
 * Put the `property` domain on the http seam for this page only.
 *
 * `services/config.js` reads `VITE_API_DOMAINS` from `import.meta.env` at module load, which is
 * fixed when the dev server boots — a spec cannot change it, and the suite must keep running
 * against the shared mock-mode server. So the module itself is rewritten in flight: the served
 * source's `RAW_DOMAINS` assignment is replaced, and everything downstream of it (the allow-list
 * parse, the unknown-domain validation, `createProvider`) then runs for real and resolves
 * `property` to `providers/http/propertyProvider.js`.
 *
 * This is a test-only interception — no production file changes, and the rewrite is confined to
 * one `const` on one module. The returned assertion is not optional: without it a regex that
 * stopped matching would leave the app silently on mocks, no request would ever be sent, and a
 * test asserting "the banner appeared" would be asserting nothing at all.
 *
 * @returns {() => void} call after navigating; throws unless the rewrite really was applied.
 */
async function goLive(page) {
  let patched = false;
  await page.route(/\/src\/services\/config\.js(\?.*)?$/, async (route) => {
    // Drop the conditional headers so Vite cannot answer 304 with an empty body.
    const headers = { ...route.request().headers() };
    delete headers['if-none-match'];
    delete headers['if-modified-since'];
    const response = await route.fetch({ headers });
    const source = await response.text();
    const next = source.replace(/const RAW_DOMAINS = [^;]*;/, "const RAW_DOMAINS = 'property';");
    if (next !== source) patched = true;
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/javascript', 'cache-control': 'no-store' },
      body: next,
    });
  });
  return () => {
    expect(patched, 'services/config.js was never rewritten — the app is still on mocks, so this test would assert nothing').toBe(true);
  };
}

/**
 * Fault-inject the one endpoint `/listings` reads.
 *
 * Scoped to `/api/properties*` rather than `/api/**` on purpose: the dev server also serves
 * `/api/__persist/*` for the mock store, and swallowing that would break the app in a way that has
 * nothing to do with connectivity.
 *
 * @returns {{ setMode: (m: 'abort'|'error'|'ok') => void, hits: () => number }}
 */
async function faultInjectProperties(page, initialMode) {
  let mode = initialMode;
  let hits = 0;
  await page.route('**/api/properties**', async (route) => {
    hits += 1;
    if (mode === 'abort') return route.abort('failed');
    if (mode === 'error') {
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'internal_error', message: 'Injected server failure', traceId: 'd165-probe' }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PROBE_PAGE) });
  });
  return { setMode: (m) => { mode = m; }, hits: () => hits };
}

test.describe('Connectivity banner (D165)', () => {
  test('the browser going offline says so confidently, and coming back is announced then cleared', async ({ page, context }) => {
    await open(page, '/listings');
    await expect(region(page)).toHaveCount(1);
    await expect(banner(page)).toHaveCount(0);

    await context.setOffline(true);
    await expect(banner(page)).toContainText(OFFLINE_TITLE);
    // The confident wording is licensed by the OS signal and nothing else.
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    await expect(banner(page)).not.toContainText(UNREACHABLE_TITLE);

    await context.setOffline(false);
    // The interface is back, so the recovery is stated rather than left for the user to guess at…
    await expect(banner(page)).toContainText(RESTORED_TITLE);
    // …and then gets out of the way (RECOVERY_MS = 4s in ConnectivityBanner.jsx).
    await expect(banner(page)).toHaveCount(0, { timeout: 10_000 });
  });

  test('a request that never reaches the server hedges — and never claims the user is offline', async ({ page }) => {
    const assertPatched = await goLive(page);
    const api = await faultInjectProperties(page, 'abort');

    await open(page, '/listings');
    assertPatched();

    await expect(banner(page)).toContainText(UNREACHABLE_TITLE);

    /* The assertion this whole item exists for. The browser still believes it is online — there is
       an interface, it is the uplink behind it that is gone — so the confident copy would be a
       false statement about the user's device, and must not appear. */
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
    await expect(banner(page)).not.toContainText(OFFLINE_TITLE);
    await expect(page.getByText(OFFLINE_TITLE, { exact: true })).toHaveCount(0);

    // And it was a real request that failed, not a state the test set by hand.
    expect(api.hits()).toBeGreaterThan(0);

    // The list agrees with the banner rather than blaming itself: same `isReachabilityFailure` rule.
    await expect(page.getByText(LIST_UNREACHABLE, { exact: true })).toBeVisible();
    await expect(page.getByText(LIST_SERVER_ERROR, { exact: true })).toHaveCount(0);
  });

  test('a server error answers, so no connectivity banner is painted at all', async ({ page }) => {
    const assertPatched = await goLive(page);
    const api = await faultInjectProperties(page, 'error');

    await open(page, '/listings');
    assertPatched();

    /* The read failed and the list says so — this is not a test that quietly passed because nothing
       happened. */
    await expect(page.getByText(LIST_SERVER_ERROR, { exact: true })).toBeVisible();
    expect(api.hits()).toBeGreaterThan(0);

    // But a 500 is proof the connection works, so the banner stays silent…
    await expect(region(page)).toHaveCount(1);
    await expect(banner(page)).toHaveCount(0);
    // …and the list does not borrow the connection's excuse either.
    await expect(page.getByText(LIST_UNREACHABLE, { exact: true })).toHaveCount(0);
  });

  test('a failed load offers a retry rather than an empty state, and the retry succeeds once the network returns', async ({ page }) => {
    const assertPatched = await goLive(page);
    const api = await faultInjectProperties(page, 'abort');

    await open(page, '/listings');
    assertPatched();

    /* "Showing 0 properties" would be a claim about Pune's inventory, and after a failed read it is
       a false one — so the count line must abstain and the card must offer the one action that can
       fix it. */
    await expect(countLine(page, COUNT_UNAVAILABLE)).toHaveCount(1);
    await expect(retryButton(page)).toBeVisible();
    await expect(banner(page)).toContainText(UNREACHABLE_TITLE);

    const failedHits = api.hits();
    api.setMode('ok');

    /* Retrying flips `useAsyncList` back to `'loading'`, so the card carrying this very button is
       swapped for skeletons the moment the click lands — which can detach the node inside
       Playwright's own actionability check and make a single `.click()` race. Drive it to the
       outcome instead: re-running the read is idempotent, so an extra click costs nothing and the
       assertion is still "the results arrived", not "the click was accepted". */
    await expect(async () => {
      if (await retryButton(page).count()) await retryButton(page).click({ timeout: 2_000 });
      await expect(page.locator(`a[href="/property/${PROBE_SLUG}"]`).first()).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });

    // The retry re-ran the read…
    expect(api.hits()).toBeGreaterThan(failedHits);
    // …the failure affordance is gone…
    await expect(retryButton(page)).toHaveCount(0);
    await expect(page.getByText(COUNT_UNAVAILABLE, { exact: true })).toHaveCount(0);
    // …and a request that reached the server retracts the standing "can't reach" verdict.
    await expect(banner(page)).toHaveCount(0);
  });

  test('the live region is mounted before it has anything to say, and announcing does not move focus', async ({ page, context }) => {
    await open(page, '/listings');

    /* Inserting the region and its text in the same tick is how announcements get missed — several
       screen readers only watch regions that were present when they built their model of the page.
       So the region must already be there while it is still empty. */
    const live = region(page);
    await expect(live).toHaveCount(1);
    await expect(live).toHaveText('');

    const grid = page.getByRole('button', { name: 'Grid view' });
    await grid.focus();
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Grid view');

    await context.setOffline(true);
    await expect(live).toContainText(OFFLINE_TITLE);

    // A polite live region announces where the user is; it does not drag them to the top of the page.
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Grid view');

    await context.setOffline(false);
  });
});
