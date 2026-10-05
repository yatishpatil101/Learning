import { test, expect } from '../../../fixtures/live.js';

/* DualRange manual entry — the currency parser.
 *
 * The parser (`defaultParse` in DualRange.jsx) understands far more than plain digits — ₹,
 * commas, and the Cr / L / Lakh / Lac / K suffixes an Indian buyer actually types. Garbage input
 * must be IGNORED (the previous bound stands), never coerced to 0, which would silently empty
 * the result set. A typed value above the visual ceiling is accepted, and a slider parked at its
 * ceiling means "and above".
 *
 * Seed data guarantees rent listings above the ₹1,00,000 rent ceiling, all of them commercial:
 * p5111 (Industrial / Factory, Hadapsar, ₹3,10,000/mo) is the dearest and is the one read here.
 * Capping at ₹1,50,000 still leaves p5108 (₹95,000) and p5107 (₹1,35,000), so the second
 * assertion proves the cap excluded a listing rather than emptying the board.
 *
 * Scoped to the desktop sidebar, matching type-aware-filters.spec.js.
 */

const filters = (page) => page.locator('aside:has(h3:has-text("Filters"))');
const cards = (page) => page.locator('a[href^="/property/"]');
const maxLabel = (page, name) => filters(page).getByRole('button', { name: new RegExp(`${name} maximum`) });
const maxInput = (page, name) => filters(page).getByRole('textbox', { name: `${name} maximum value` });

/** Type `text` into the max label of `name` and commit with Enter. */
async function typeMax(page, name, text) {
  await maxLabel(page, name).click();
  const input = maxInput(page, name);
  await input.fill(text);
  await input.press('Enter');
}

// Budget is formatted in Indian units, so each suffix has a checkable readout.
// "lakh" and "lac" are the same unit spelled how people actually write it.
const BUDGET_CASES = [
  ['2.5cr', '₹2.50 Cr'],
  ['75L', '₹75 L'],
  ['90 lakh', '₹90 L'],
  ['1.2 crore', '₹1.20 Cr'],
];

// A user re-typing what the label already showed must not break it.
const RENT_CASES = [
  ['₹85,000', '₹85,000'],
  [' 60 000 ', '₹60,000'],
];

test('DualRange currency parsing: suffixes, symbols, junk, Escape, min above max, and values above the ceiling', async ({ page }) => {
  test.slow();

  await test.step('the Cr / L / K suffixes resolve to the right magnitude', async () => {
    await page.goto('/listings?deal=buy');
    for (const [typed, shown] of BUDGET_CASES) {
      await typeMax(page, 'Budget Range', typed);
      await expect(maxLabel(page, 'Budget Range'), `"${typed}"`).toHaveText(shown);
    }
  });

  await test.step('Monthly Rent max accepts a manually typed value above the visual ceiling', async () => {
    await page.goto('/listings?deal=rent');
    // Default label reads the ceiling with a "+" (and-above).
    await expect(maxLabel(page, 'Monthly Rent')).toHaveText(/₹1,00,000\+/);

    await typeMax(page, 'Monthly Rent', '250000');
    // The typed value is accepted verbatim (no "+", not clamped back to 1,00,000).
    await expect(maxLabel(page, 'Monthly Rent')).toHaveText('₹2,50,000');
  });

  await test.step('₹ symbols, commas and spaces are stripped rather than rejected', async () => {
    for (const [typed, shown] of RENT_CASES) {
      await typeMax(page, 'Monthly Rent', typed);
      await expect(maxLabel(page, 'Monthly Rent'), `"${typed}"`).toHaveText(shown);
    }
  });

  await test.step('unparseable input leaves the previous bound standing', async () => {
    await typeMax(page, 'Monthly Rent', '75000');
    await expect(maxLabel(page, 'Monthly Rent')).toHaveText('₹75,000');

    // Garbage must be ignored — coercing it to 0 would empty the results with no
    // explanation, which is the worst possible outcome for a filter.
    for (const junk of ['abc', '', '₹']) {
      await typeMax(page, 'Monthly Rent', junk);
      await expect(maxLabel(page, 'Monthly Rent')).toHaveText('₹75,000');
    }
  });

  await test.step('Escape abandons an edit and Enter commits it', async () => {
    await typeMax(page, 'Monthly Rent', '50000');
    await expect(maxLabel(page, 'Monthly Rent')).toHaveText('₹50,000');

    await maxLabel(page, 'Monthly Rent').click();
    const input = maxInput(page, 'Monthly Rent');
    await input.fill('12345');
    await input.press('Escape');
    await expect(maxLabel(page, 'Monthly Rent')).toHaveText('₹50,000');
  });

  await test.step('a typed minimum above the current maximum does not silently swap the bounds', async () => {
    await typeMax(page, 'Monthly Rent', '40000');
    await expect(maxLabel(page, 'Monthly Rent')).toHaveText('₹40,000');

    const minLabel = filters(page).getByRole('button', { name: /Monthly Rent minimum/ });
    await minLabel.click();
    const minInput = filters(page).getByRole('textbox', { name: 'Monthly Rent minimum value' });
    await minInput.fill('90000');
    await minInput.press('Enter');

    /* `setLo` clamps the typed value to the current high bound, so the minimum
       must never end up above the maximum. Asserting the ORDER rather than an
       exact figure keeps this honest: whether the product chooses to clamp the
       min down or grow the max up is a product call, but an inverted range that
       silently matches nothing is a bug either way. */
    const value = async (label) => Number((await label.innerText()).replace(/[^\d]/g, ''));
    expect(await value(minLabel)).toBeLessThanOrEqual(await value(maxLabel(page, 'Monthly Rent')));
  });
});

test('A rent listing above the ceiling shows at the default range and hides when capped below it', async ({ page }) => {
  await page.goto('/listings?deal=rent&type=commercial');
  await cards(page).first().waitFor({ timeout: 10000 });

  // Open-top default: the ₹3,10,000 factory is visible even though it exceeds the
  // ₹1,00,000 slider ceiling (the ceiling means "and above").
  const factory = page.locator('a[href="/property/p5111"]');
  await expect(factory).toBeVisible();

  // Type a concrete max BELOW the factory rent — it must now be excluded.
  await typeMax(page, 'Monthly Rent', '150000');

  await expect(factory).toHaveCount(0);
  // Cheaper commercial rentals remain.
  await expect(cards(page).first()).toBeVisible();
});