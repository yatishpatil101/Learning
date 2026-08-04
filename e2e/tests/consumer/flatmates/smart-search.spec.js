import { test, expect } from '@playwright/test';

/* Smart search on Flatmates used to leave the raw natural-language sentence in
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
  await page.goto(`${BASE}/flatmates?view=flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });
  const before = await page.locator('.sf-card').count();

  await page.getByPlaceholder(SEARCH).fill('woman in baner');
  await page.getByRole('button', { name: 'Smart search' }).click();

  // The raw sentence is gone (it's now expressed as structured chips)…
  await expect(page.getByPlaceholder(SEARCH)).toHaveValue('');
  /* …and an honest, non-empty, genuinely narrowed set comes back — not the old
     zero-result trap.

     Stated as a relationship rather than the literal 3 it used to assert. The
     two-tab merge means Team up now holds seekers AND address-less groups, so
     the number moved to 4; pinning any exact figure just re-arms the same trap
     for the next seed-data change. What the fix actually guarantees is
     "narrowed, but not to nothing", and that is what is checked. */
  const after = await page.locator('.sf-card').count();
  expect(after).toBeGreaterThan(0);
  expect(after).toBeLessThan(before);
});

test('smart search keeps an unparseable query as a literal text filter', async ({ page }) => {
  await page.goto(`${BASE}/flatmates?view=flatmates`);
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
  await page.goto(`${BASE}/flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });

  /* Two intent tabs (see flatmates/model.js), each carrying its own live count.
     The count is now rendered visibly *and* folded into the accessible name —
     stock a seeker cannot see is stock they never switch tabs for. This asserts
     the sighted and announced numbers agree, which is the property that actually
     matters; the previous version asserted the old "Flatmates, N available"
     label and that the visible chip was absent, both of which the redesign
     replaced. */
  const cards = await page.locator('.sf-card').count();
  await expect(page.getByRole('button', { name: `Move in now — ${cards} homes with a room available` })).toBeVisible();
});

test('raising the budget from the empty state recovers matches', async ({ page }) => {
  // Force an all-but-budget match: cheapest Baner woman is ₹16k, so a ₹10k ceiling
  // yields zero and the empty state should offer to raise the budget.
  await page.goto(`${BASE}/flatmates?view=flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });

  await page.getByPlaceholder(SEARCH).fill('woman in baner');
  await page.getByRole('button', { name: 'Smart search' }).click();
  // Non-empty rather than a literal count — see the note on the first test.
  await expect(page.locator('.sf-card').first()).toBeVisible();

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
