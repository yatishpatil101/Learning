import { test, expect } from '@playwright/test';

/* Every way smart search can lose the user's input is silent: the toast still fires, so the page
   looks like it answered a question it never asked. That is what these three pin.

   The registry is stubbed so the assertions do not depend on whichever localities are live today;
   the page underneath is real. Scoped to the API path, because the dev server also serves
   `src/data/localities.js` and a looser glob fulfils that module request with JSON. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

const REGISTRY = [
  { slug: 'baner', name: 'Baner', city: 'Pune' },
  { slug: 'kharadi', name: 'Kharadi', city: 'Pune' },
];

const stubRegistry = (page) => page.route('**/api/localities', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(REGISTRY),
}));

const smartSearch = async (page, text) => {
  const field = page.locator('.lst-search-field').first();
  await expect(field).toBeVisible({ timeout: 15000 });
  await field.fill(text);
  await page.getByRole('button', { name: 'Smart search' }).first().click();
};

test('a typed query merges onto the filters already set, instead of resetting them', async ({ page }) => {
  await stubRegistry(page);
  await page.setViewportSize({ width: 1366, height: 900 });

  // Arrives with one filter already applied, exactly as it would after a click in the panel.
  await page.goto(`${BASE}/listings?deal=rent&furn=furnished`);
  await expect(page.locator('.af-chip', { hasText: /\bFurnished\b/i }).first()).toBeVisible({ timeout: 15000 });

  await smartSearch(page, '2 bhk baner');

  // The two the query asked for, and the one it said nothing about — that last one is the bug.
  await expect(page.locator('.af-chip', { hasText: /2 BHK/i }).first()).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.af-chip', { hasText: /Baner/i }).first()).toBeVisible();
  await expect(page.locator('.af-chip', { hasText: /\bFurnished\b/i }).first()).toBeVisible();
});

test('words no filter can hold are forwarded as free text and stay removable', async ({ page }) => {
  await stubRegistry(page);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`${BASE}/listings?deal=rent`);

  // The term the server is asked for, captured rather than inferred: the whole point of the
  // remainder is that it is searched, and a chip alone would not prove it left the browser.
  const sent = page.waitForRequest((r) => {
    const u = new URL(r.url());
    return u.pathname.endsWith('/properties') && u.searchParams.get('q') === 'kumar princeville';
  });

  // "kumar princeville" is a society: no facet holds it, so it must reach the server's text match.
  await smartSearch(page, '2 bhk baner kumar princeville');

  const chip = page.locator('.af-chip', { hasText: /kumar princeville/i }).first();
  await expect(chip).toBeVisible({ timeout: 10000 });
  // Both words, not a prefix: dropping "princeville" would search a builder's whole portfolio.
  await expect(page).toHaveURL(/[?&]q=kumar\+princeville(&|$)/);
  await sent;

  /* `q` is not a filter, so nothing in the panel clears it: without this control it would keep
     narrowing every later search invisibly. */
  await chip.click();
  // Anchored on a chip that must survive, so "no q" cannot pass by having navigated away.
  await expect(page.locator('.af-chip', { hasText: /Baner/i }).first()).toBeVisible();
  await expect(page).not.toHaveURL(/[?&]q=/);
});

test('an amount the current tab cannot express switches tab rather than clamping to its maximum', async ({ page }) => {
  await stubRegistry(page);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`${BASE}/listings?deal=rent`);

  await smartSearch(page, '3 bhk under 80 lakh');

  // ₹80 L is eight times the rent slider's whole range, so it can only have meant Buy.
  await expect(page).toHaveURL(/[?&]deal=buy/, { timeout: 10000 });
  await expect(page).toHaveURL(/[?&]budget=0-8000000/);
  await expect(page.locator('.af-chip', { hasText: /3 BHK/i }).first()).toBeVisible();
});

test('a rent typed just above the rent slider is still read as a sale price', async ({ page }) => {
  await stubRegistry(page);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`${BASE}/listings?deal=rent`);

  /* The band just over the ceiling is where clamping is least visible: ₹5 L lands on the Rent
     slider's own maximum, so the URL changes, the toast fires, and the result set does not move. */
  await smartSearch(page, '2 bhk under 5 lakh');

  await expect(page).toHaveURL(/[?&]deal=buy/, { timeout: 10000 });
  await expect(page).toHaveURL(/[?&]budget=0-500000/);
});
