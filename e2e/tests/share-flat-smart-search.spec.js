import { test, expect } from '@playwright/test';

/* Smart search on Share-a-Flat used to leave the raw natural-language sentence in
   the search box, which ALSO acts as a live literal substring filter — so a parsed
   query like "woman in baner" applied the right chips but then the leftover sentence
   matched no card and silently zeroed the results. The fix clears the raw query once
   at least one structured filter is understood, and keeps it as a plain text search
   otherwise. These tests lock that behaviour in.

   Also covers the smarter empty state (active-filter chips + the live query) and the
   per-tab result-count badges. */

const BASE = 'http://localhost:5173';
const SEARCH = /Try: girl in baner/i;

test('smart search turns a sentence into filters and clears the raw query', async ({ page }) => {
  await page.goto(`${BASE}/share-flat?view=flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });

  await page.getByPlaceholder(SEARCH).fill('woman in baner');
  await page.getByRole('button', { name: 'Smart search' }).click();

  // The raw sentence is gone (it's now expressed as structured chips)…
  await expect(page.getByPlaceholder(SEARCH)).toHaveValue('');
  // …and the honest, non-empty result set is returned (3 Baner women seekers),
  // not the old zero-result trap.
  await expect(page.locator('.sf-card')).toHaveCount(3);
});

test('smart search keeps an unparseable query as a literal text filter', async ({ page }) => {
  await page.goto(`${BASE}/share-flat?view=flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });

  await page.getByPlaceholder(SEARCH).fill('zzznotarealmatch');
  await page.getByRole('button', { name: 'Smart search' }).click();

  // Nothing parsed, so the text stays as a plain substring search…
  await expect(page.getByPlaceholder(SEARCH)).toHaveValue('zzznotarealmatch');
  await expect(page.locator('.sf-card')).toHaveCount(0);
  // …and the empty state echoes the query so the user sees WHY it's empty.
  await expect(page.getByText(/zzznotarealmatch/).first()).toBeVisible();
});

test('each tab exposes its live result count to assistive tech', async ({ page }) => {
  await page.goto(`${BASE}/share-flat?view=flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });

  // The visible count chips were removed for a cleaner mobile tab strip; the
  // live count now lives on each tab's accessible name instead.
  await expect(page.locator('.sf-tabcount')).toHaveCount(0);

  const cards = await page.locator('.sf-card').count();
  await expect(page.getByRole('button', { name: `Flatmates, ${cards} available` })).toBeVisible();
});

test('raising the budget from the empty state recovers matches', async ({ page }) => {
  // Force an all-but-budget match: cheapest Baner woman is ₹16k, so a ₹10k ceiling
  // yields zero and the empty state should offer to raise the budget.
  await page.goto(`${BASE}/share-flat?view=flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });

  await page.getByPlaceholder(SEARCH).fill('woman in baner');
  await page.getByRole('button', { name: 'Smart search' }).click();
  await expect(page.locator('.sf-card')).toHaveCount(3);

  // Tighten the budget below the cheapest match via the smart box.
  await page.getByPlaceholder(SEARCH).fill('woman in baner under 10000');
  await page.getByRole('button', { name: 'Smart search' }).click();
  await expect(page.locator('.sf-card')).toHaveCount(0);

  const raise = page.getByRole('button', { name: /Raise budget to/i });
  await expect(raise).toBeVisible({ timeout: 5000 });
  await raise.click();

  // The list comes back once the budget clears the cheapest match.
  await expect(page.locator('.sf-card').first()).toBeVisible({ timeout: 5000 });
});
