import { test, expect } from '@playwright/test';

/* Paid placement is ranked and disclosed — but never over a sort the buyer chose (D59).
 *
 * A boost buys position in the default order. It must not buy position in an order the buyer
 * explicitly asked for, and it must never be silent: an unlabelled paid result is an undisclosed
 * advertisement. Both halves are asserted here against the mock store, which mirrors the server's
 * `PropertySpecs.boostedFirst` / `Property.isBoosted()` rule.
 *
 * The window is seeded as a future timestamp rather than a flag, deliberately: that is the shape
 * the store actually holds, so this also exercises the "compare against now" derivation instead of
 * a boolean someone could set and forget.
 *
 * Targets are chosen from the cards actually on screen rather than from the store. The first cut
 * picked the cheapest row in the database and it was a commercial listing the default tab filters
 * out — the promoted listing was never rendered and all three tests failed for a reason that had
 * nothing to do with ranking. */

const BASE = 'http://localhost:5173';
const DB_KEY = 'puneNestDB_v5';

const cards = (page) => page.locator('[href^="/property/"]');

/** The listing id a card links to, e.g. `/property/P5013` → `P5013`. */
async function idOf(card) {
  return (await card.getAttribute('href')).split('/').pop();
}

/** Open a promotion window on one listing, by id, and reload so the page reads it back. */
async function promote(page, id) {
  await page.evaluate(([key, target]) => {
    const db = JSON.parse(localStorage.getItem(key) || 'null');
    const row = db.listings.find((l) => l.id === target);
    row.boostedUntil = new Date(Date.now() + 7 * 864e5).toISOString();
    localStorage.setItem(key, JSON.stringify(db));
  }, [DB_KEY, id]);
  await page.reload();
  await cards(page).first().waitFor();
}

/** Drive the custom sort listbox (not a native `<select>`). Labels are matched exactly: both read
 *  "Price: Low to High" / "Price: High to Low", so a /low/i regex matches them both. */
async function sortBy(page, label) {
  await page.getByRole('button', { name: /sort/i }).first().click();
  await page.getByRole('option', { name: label, exact: true }).click();
  await cards(page).first().waitFor();
}

test.describe('Paid placement (D59)', () => {
  test.beforeEach(async ({ page }) => {
    // Load once so the app seeds the full default DB into localStorage before we edit it.
    await page.goto(`${BASE}/listings`);
    await cards(page).first().waitFor();
  });

  test('a boosted listing is ranked first and labelled Promoted', async ({ page }) => {
    // Promote a listing that is currently *last*, so first place can only come from the boost.
    const target = await idOf(cards(page).last());
    await promote(page, target);

    await expect(cards(page).first()).toHaveAttribute('href', `/property/${target}`);
    await expect(cards(page).first().getByText(/^Promoted$/i)).toBeVisible();
  });

  test('only the boosted listing carries the Promoted badge', async ({ page }) => {
    await promote(page, await idOf(cards(page).last()));

    // Exactly one listing was promoted, so exactly one badge may appear. A badge that rendered on
    // every card would still satisfy a "is visible" assertion on the boosted one.
    await expect(page.getByText(/^Promoted$/i)).toHaveCount(1);
  });

  test('an explicit price sort is honoured — money does not outrank the buyer\'s choice', async ({ page }) => {
    // The cheapest listing on screen, taken from the sorted view rather than assumed.
    await sortBy(page, 'Price: Low to High');
    const cheapest = await idOf(cards(page).first());

    await promote(page, cheapest);

    // Cheapest-first must still put it first — the boost neither helps nor hurts here. The badge
    // is asserted in this view rather than the next one because the results list is paged: under
    // dearest-first the cheapest listing falls off the rendered page entirely, so a badge count
    // there would read 0 whether the label was correct or missing.
    await sortBy(page, 'Price: Low to High');
    await expect(cards(page).first()).toHaveAttribute('href', `/property/${cheapest}`);
    await expect(cards(page).first().getByText(/^Promoted$/i)).toBeVisible();

    // And dearest-first must NOT pull it to the top. This is the assertion that fails if paid
    // placement is pinned regardless of the chosen order.
    await sortBy(page, 'Price: High to Low');
    await expect(cards(page).first()).not.toHaveAttribute('href', `/property/${cheapest}`);
  });
});
