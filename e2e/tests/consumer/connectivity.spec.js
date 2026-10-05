import { test, expect } from '../../fixtures/base.js';
import { open } from '../../helpers/app.js';

const OFFLINE_TITLE = "You're offline.";
const UNREACHABLE_TITLE = "Can't reach the server.";
const RESTORED_TITLE = 'Back online.';
const LIST_UNREACHABLE = "We couldn't reach the server. Check your connection and try again.";
const LIST_SERVER_ERROR = "We couldn't load listings just now.";
const COUNT_UNAVAILABLE = 'Results unavailable';

const region = (page) => page.locator('div[role="status"][aria-live="polite"][aria-atomic="true"]');
const banner = (page) => page.locator('.dz-connectivity-card');
const retryButton = (page) => page.getByRole('button', { name: 'Retry' });
const countLine = (page, text) => page.getByText(text, { exact: true }).filter({ visible: true });

const PROBE_SLUG = 'connectivity-probe-flat';

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

async function faultInjectProperties(page, initialMode, { isolateApiRequests = false } = {}) {
  let mode = initialMode;
  let hits = 0;
  await page.route('**/api/**', async (route) => {
    const isPropertiesRequest = new URL(route.request().url()).pathname.startsWith('/api/properties');
    if (!isPropertiesRequest && !isolateApiRequests) return route.continue();
    if (isPropertiesRequest) hits += 1;
    if (mode === 'abort') return route.abort('failed');
    if (!isPropertiesRequest && mode === 'error') {
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'internal_error', message: 'Injected server failure', traceId: 'd165-probe' }),
      });
    }
    if (!isPropertiesRequest) return route.continue();
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
    // The confident wording is licensed by the OS signal and nothing else.
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    await expect(banner(page)).not.toContainText(UNREACHABLE_TITLE);

    await context.setOffline(false);
    // The interface is back, so the recovery is stated rather than left for the user to guess at…
    await expect(banner(page)).toContainText(RESTORED_TITLE);
    await expect(banner(page)).toHaveCount(0, { timeout: 10_000 });
  });

  test('a request that never reaches the server hedges — and never claims the user is offline', async ({ page }) => {
    const api = await faultInjectProperties(page, 'abort', { isolateApiRequests: true });

    await open(page, '/listings');

    await expect(banner(page)).toContainText(UNREACHABLE_TITLE);

    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
    await expect(banner(page)).not.toContainText(OFFLINE_TITLE);
    await expect(page.getByText(OFFLINE_TITLE, { exact: true })).toHaveCount(0);

    await expect.poll(() => api.hits()).toBeGreaterThan(0);

    await expect(page.getByText(LIST_UNREACHABLE, { exact: true })).toBeVisible();
    await expect(page.getByText(LIST_SERVER_ERROR, { exact: true })).toHaveCount(0);
  });

  test('a server error answers, so no connectivity banner is painted at all', async ({ page }) => {
    const api = await faultInjectProperties(page, 'error', { isolateApiRequests: true });

    await open(page, '/listings');
    /* The read failed and the list says so — this is not a test that quietly passed because nothing
       happened. */

    await expect(page.getByText(LIST_SERVER_ERROR, { exact: true })).toBeVisible();
    expect(api.hits()).toBeGreaterThan(0);
    // But a 500 is proof the connection works, so the banner stays silent…
    await expect(region(page)).toHaveCount(1);
    await expect(banner(page)).toHaveCount(0);
    await expect(page.getByText(LIST_UNREACHABLE, { exact: true })).toHaveCount(0);
  });

  test('a failed load offers a retry rather than an empty state, and the retry succeeds once the network returns', async ({ page }) => {
    const api = await faultInjectProperties(page, 'abort', { isolateApiRequests: true });

    await open(page, '/listings');

    await expect(countLine(page, COUNT_UNAVAILABLE)).toHaveCount(1);
    await expect(retryButton(page)).toBeVisible();
    await expect(banner(page)).toContainText(UNREACHABLE_TITLE);

    const failedHits = api.hits();
    api.setMode('ok');

    await expect(async () => {
      if (await retryButton(page).count()) await retryButton(page).click({ timeout: 2_000 });
      await expect(page.locator(`a[href="/property/${PROBE_SLUG}"]`).first()).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    // The retry re-ran the read…
    expect(api.hits()).toBeGreaterThan(failedHits);
    await expect(retryButton(page)).toHaveCount(0);
    await expect(page.getByText(COUNT_UNAVAILABLE, { exact: true })).toHaveCount(0);
    // …and a request that reached the server announces recovery, then retracts the standing
    // verdict. A bare absence check would pass if the retry never moved connectivity at all.
    await expect(banner(page)).toContainText(RESTORED_TITLE);
    await expect(banner(page)).toHaveCount(0, { timeout: 5_000 });
  });

  test('the live region is mounted before it has anything to say, and announcing does not move focus', async ({ page, context }) => {
    await open(page, '/listings');
    // So the region must already be there while it is still empty.
    const live = region(page);
    await expect(live).toHaveCount(1);
    await expect(live).toHaveText('');

    const grid = page.getByRole('button', { name: 'Grid view' });
    await grid.focus();
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Grid view');

    await context.setOffline(true);
    await expect(live).toContainText(OFFLINE_TITLE);

    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Grid view');

    await context.setOffline(false);
  });
});
