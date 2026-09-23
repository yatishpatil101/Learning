import { test, expect } from '../../fixtures/base.js';
import { open } from '../../helpers/app.js';

/* The stamp is a digest of the running build, so it cannot be made to change from inside the app;
   `page.route` fakes a deploy by answering with the real response and `X-Draazy-Build` rewritten. */

/* Verbatim from `i18n/locales/en/common.json` — this spec adds no key. */
const UPDATE_TITLE = 'A new version is available.';
const OFFLINE_TITLE = "You're offline.";
const RESTORED_TITLE = 'Back online.';

/** The card inside the always-mounted live region of `components/ConnectivityBanner.jsx`. */
const banner = (page) => page.locator('.dz-connectivity-card');
const reloadButton = (page) => page.getByTestId('app-update-reload');
const dismissButton = (page) => page.getByTestId('app-update-dismiss');

const BUILD_BOOT = 'a1b2c3d4e5f6';
const BUILD_DEPLOYED = '0f1e2d3c4b5a';

/* First answer carries `BUILD_BOOT` and every later one `BUILD_DEPLOYED`, so the deploy lands on
   traffic the page was going to send anyway; `hits` is asserted so a one-call boot fails loudly. */
async function stampBuild(page) {
  let hits = 0;
  let frozen = false;
  await page.route('**/api/**', async (route) => {
    /* `route.fetch` throws once the context is offline, and an unhandled rejection here fails the
       test for the wrong reason. Aborting is what an offline browser does anyway. */
    let response;
    try {
      response = await route.fetch();
    } catch {
      await route.abort();
      return;
    }
    hits += 1;
    const build = frozen || hits === 1 ? BUILD_BOOT : BUILD_DEPLOYED;
    /* The reload under test tears the document down mid-flight, which disposes responses still in
       the handler. Nothing is owed to a request whose page no longer exists. */
    try {
      await route.fulfill({ response, headers: { ...response.headers(), 'X-Draazy-Build': build } });
    } catch {
      /* ignore */
    }
  });
  return { hits: () => hits, freeze: () => { frozen = true; } };
}

/* Survives a reload, unlike anything on `window`, so it can tell "the page reloaded" from "the page
   was set up twice". Written by an init script, which runs once per document. */
const countBoots = async (page) => {
  await page.addInitScript(() => {
    const n = Number(sessionStorage.getItem('dz:e2e:boots') || 0) + 1;
    sessionStorage.setItem('dz:e2e:boots', String(n));
  });
  return () => page.evaluate(() => Number(sessionStorage.getItem('dz:e2e:boots') || 0));
};

test.describe('App update banner', () => {
  test('a deploy mid-session offers a reload, takes none by itself, and reloads when asked', async ({ page }) => {
    const boots = await countBoots(page);
    const api = await stampBuild(page);

    await open(page, '/listings');

    await expect(banner(page)).toContainText(UPDATE_TITLE);
    /* The banner is answering a real change of build, not an absent header or a single lonely
       request that happened to be enough. */
    expect(api.hits()).toBeGreaterThan(1);

    /* The assertion this file exists for: the tab is still the tab the user was working in. Every
       await above is real elapsed time, so an auto-reload would already have fired. */
    expect(await boots()).toBe(1);

    await reloadButton(page).click();

    /* The click navigates, so the execution context `boots` evaluates in is torn down and rebuilt.
       Polling across that window reads a destroyed context and throws rather than retrying. */
    await page.waitForLoadState('domcontentloaded');
    await expect.poll(boots).toBe(2);
    /* On the new document every answer carries `BUILD_DEPLOYED`, so a banner still up here would
       mean the latch outlived the build it was complaining about. */
    await expect(banner(page)).toHaveCount(0);
  });

  test('the offer can be waved off, and does not come back for the same build', async ({ page }) => {
    const boots = await countBoots(page);
    const api = await stampBuild(page);

    await open(page, '/listings');
    await expect(banner(page)).toContainText(UPDATE_TITLE);

    await dismissButton(page).click();

    await expect(banner(page)).toHaveCount(0);
    /* Dismissing is not a reload in disguise: the half-filled form the user was protecting is
       exactly what they chose to keep. */
    expect(await boots()).toBe(1);

    /* Must be a detail page: `lib/searchCache.js` answers a repeat search from memory, so a nav
       back to an already-seen list sends nothing and this would be measuring the cache. */
    const hitsBefore = api.hits();
    await page.locator('a[href^="/property/"]').first().click();
    await expect(page).toHaveURL(/\/property\//);
    expect(await boots()).toBe(1);
    /* Polled: the URL changes the moment the router does, while the fetch it triggers lands a tick
       or two later, so reading the counter straight after the navigation races it. */
    await expect.poll(api.hits).toBeGreaterThan(hitsBefore);
    await expect(banner(page)).toHaveCount(0);
  });

  test('a connectivity problem outranks the offer, and the offer survives it', async ({ page, context }) => {
    await stampBuild(page);

    await open(page, '/listings');
    await expect(banner(page)).toContainText(UPDATE_TITLE);

    await context.setOffline(true);

    /* The ranking: offering "reload for the new version" to someone with no connection advises a
       reload that lands them on a blank page. */
    await expect(banner(page)).toContainText(OFFLINE_TITLE);
    await expect(banner(page)).not.toContainText(UPDATE_TITLE);

    await context.setOffline(false);
    await expect(banner(page)).toContainText(RESTORED_TITLE);

    /* Outranked, not discarded: once the recovery notice clears (RECOVERY_MS = 4s) the deploy is
       still un-actioned and still worth saying. */
    await expect(banner(page)).toContainText(UPDATE_TITLE, { timeout: 10_000 });
  });

  test('an unchanged build says nothing', async ({ page }) => {
    const api = await stampBuild(page);
    api.freeze();

    await open(page, '/listings');

    /* The control: without it the suite could not tell a working latch from a banner that is
       simply always on. */
    expect(api.hits()).toBeGreaterThan(1);
    await expect(banner(page)).toHaveCount(0);
  });
});
