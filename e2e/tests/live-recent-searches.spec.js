// @ts-check
/**
 * LIVE: signed-in recent searches against the real API (D248).
 *
 * The "pick up where you left off" rail was a `localStorage` key bucketed by mobile —
 * `dzRecentSearches:<mobile>`. That key *promises* per-account continuity and a browser is the one
 * place that cannot deliver it: the search a seeker ran on their phone at lunch was simply not
 * there on the laptop that evening, and clearing site data threw the lot away. It is now a server
 * table for signed-in users, and this spec proves the endpoints.
 *
 * A mock spec cannot: the mock provider writes the same browser key it used to, so every
 * single-context assertion stays green whether or not the port happened. Everything below therefore
 * either watches the wire, re-reads through the API, or looks again from a **second browser
 * context** — which is the whole feature stated as a test.
 *
 * Anonymous history deliberately stays device-local, so the last test asserts the *absence* of any
 * call, anchored by a positive: the same search still lands in the same rail, locally.
 *
 * Not covered here: the URL allow-list and the 422s for absolute/foreign/overlong URLs. Those are
 * pinned in `RecentSearchTest`, where a rejected write leaves nothing behind.
 */
import { test, expect } from '@playwright/test';
import { IGNORE as SHARED_IGNORE } from '../helpers/console.js';
import { signedInAs, signedInAsNew, authHeaders, API } from '../helpers/liveAuth.js';

/** See the long note in `live-property-integration.spec.js`: live runs cross a TLS-intercepting proxy. */
const IGNORE = new RegExp(`${SHARED_IGNORE.source}|CDN|net::ERR|ERR_CERT`, 'i');

const RAIL = `${API}/me/recent-searches`;
const RAIL_PATH = '/api/me/recent-searches';

/** The server's own cap. Seven writes must leave six rows. */
const CAP = 6;

/** Read the caller's rail straight from the API, bypassing every screen. */
async function railOf(mobile) {
  const res = await fetch(RAIL, { headers: await authHeaders(mobile) });
  expect(res.status).toBe(200);
  return res.json();
}

/** Record a search over HTTP — for building a rail, not for asserting the UI writes one. */
async function record(mobile, label, url) {
  const res = await fetch(RAIL, {
    method: 'PUT',
    headers: await authHeaders(mobile),
    body: JSON.stringify({ label, url }),
  });
  expect(res.status).toBe(200);
  return res.json();
}

/** Type a free-text query into the hero and hit Search. Returns the label the rail should carry. */
async function searchFromHome(page, text) {
  await page.getByLabel(/Search localities, societies or landmarks/i).fill(text);
  await page.getByRole('button', { name: /^Search$/ }).click();
  await page.waitForURL(/\/listings\?/, { timeout: 20000 });
  return text;
}

test.describe('LIVE: recent searches against the real API', () => {
  let errors;
  let apiFails;

  test.beforeEach(async ({ page }) => {
    errors = [];
    apiFails = [];
    page.on('response', (r) => {
      if (r.url().includes('/api/') && r.status() >= 400) apiFails.push(`${r.status()} ${new URL(r.url()).pathname}`);
    });
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
  });

  test.afterEach(() => {
    expect(errors.filter((e) => !IGNORE.test(e)), `failed API calls: ${apiFails.join(', ') || 'none'}`).toEqual([]);
  });

  test('a search from Home is written to the account and read back by a second browser', async ({ page, browser }) => {
    const mobile = await signedInAsNew(page);

    // A fresh account starts with nothing on the server. The positive anchor is one line down: the
    // very next thing this account does produces a row, so an empty rail here is a real empty rail
    // and not an endpoint that always answers `[]`.
    expect(await railOf(mobile)).toEqual([]);

    await page.goto('/');
    const written = page.waitForResponse(
      (r) => new URL(r.url()).pathname === RAIL_PATH && r.request().method() === 'PUT',
      { timeout: 20000 },
    );
    const text = 'qazwsx riverside';
    await searchFromHome(page, text);
    expect((await written).status()).toBe(200);

    const rows = await railOf(mobile);
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toContain(text);
    // A relative search URL, which is the only thing the server will store.
    expect(rows[0].url).toMatch(/^\/listings\?/);
    expect(rows[0].url).toContain('q=qazwsx');
    // Server-generated, not sent by the browser: the request body carries only `label` and `url`.
    expect(Date.parse(rows[0].at)).toBeGreaterThan(Date.now() - 5 * 60 * 1000);

    // The point of the whole port: a different browser, same account, same history.
    const other = await browser.newContext();
    try {
      const page2 = await other.newPage();
      await signedInAs(page2, mobile);

      await page2.goto('/');
      await expect(page2.getByText('Recent:')).toBeVisible({ timeout: 20000 });
      await expect(page2.getByRole('button', { name: new RegExp(text, 'i') })).toBeVisible();

      await page2.goto('/dashboard');
      const resume = page2.getByTestId('resume-search');
      await expect(resume).toBeVisible({ timeout: 20000 });
      await expect(resume.getByText(new RegExp(text, 'i'))).toBeVisible();
    } finally {
      await other.close();
    }
  });

  test('the rail keeps the newest six and drops the seventh-oldest', async ({ page }) => {
    const mobile = await signedInAsNew(page);

    /* Driven over HTTP rather than through seven round trips of the hero: the cap is a server rule,
       so this is the level it lives at, and the UI's ability to write one is already proved above.
       Sequential on purpose — the order is the thing under test. */
    for (let i = 1; i <= CAP + 1; i += 1) {
      await record(mobile, `Search ${i}`, `/listings?q=cap-${i}`);
    }

    const rows = await railOf(mobile);
    expect(rows).toHaveLength(CAP);
    // Newest first, and the oldest is gone. Asserting the full ordered set rather than just
    // "search-1 is absent" — an over-eager eviction that kept only the last one would satisfy the
    // absence on its own.
    expect(rows.map((r) => r.url)).toEqual([
      '/listings?q=cap-7',
      '/listings?q=cap-6',
      '/listings?q=cap-5',
      '/listings?q=cap-4',
      '/listings?q=cap-3',
      '/listings?q=cap-2',
    ]);

    // And the screen agrees with the API — the rail is not re-capped or re-sorted client-side.
    // Only the newest is checked here: the card renders four of the six rows, so the evicted
    // "Search 1" would be off-screen whether eviction happened or not, and asserting its absence
    // would pass with the cap deleted. The ordered-set assertion above is what proves eviction.
    await page.goto('/dashboard');
    const resume = page.getByTestId('resume-search');
    await expect(resume).toBeVisible({ timeout: 20000 });
    await expect(resume.getByText('Search 7')).toBeVisible();
  });

  test('re-running the same search moves it to the top instead of adding a row', async ({ page }) => {
    const mobile = await signedInAsNew(page);

    await record(mobile, 'Rent · Baner', '/listings?deal=rent&q=baner');
    await record(mobile, 'Rent · Wakad', '/listings?deal=rent&q=wakad');
    // Same URL, a different label. Dedupe is by URL and never by label: two searches that print the
    // same words can carry different filters, and collapsing those would lose one of them.
    await record(mobile, 'Baner rentals', '/listings?deal=rent&q=baner');

    const rows = await railOf(mobile);
    expect(rows).toHaveLength(2);
    expect(rows[0].url).toBe('/listings?deal=rent&q=baner');
    expect(rows[0].label).toBe('Baner rentals');
    expect(rows[1].url).toBe('/listings?deal=rent&q=wakad');

    await page.goto('/dashboard');
    const resume = page.getByTestId('resume-search');
    await expect(resume).toBeVisible({ timeout: 20000 });
    await expect(resume.getByText('Baner rentals')).toBeVisible();
  });

  test('a signed-out visitor keeps their history in the browser and never calls the API', async ({ page }) => {
    const calls = [];
    page.on('request', (r) => {
      if (new URL(r.url()).pathname === RAIL_PATH) calls.push(r.method());
    });

    await page.goto('/');
    const text = 'plmokn heights';
    await searchFromHome(page, text);

    // The positive anchor: the search *was* recorded, just not on any server. Without this the
    // absence below would pass equally well if recording had simply stopped working.
    await page.goto('/');
    await expect(page.getByText('Recent:')).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: new RegExp(text, 'i') })).toBeVisible();

    expect(calls, 'an anonymous visitor must not open a server-side browsing log').toEqual([]);
  });
});
