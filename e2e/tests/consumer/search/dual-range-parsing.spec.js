import { test, expect } from '../../../fixtures/base.js';

/* DualRange manual entry — the currency parser.
 *
 * `filter-slider-manual-entry` covers the one case that shipped a bug: typing a
 * value above the visual ceiling. The parser it goes through (`defaultParse` in
 * DualRange.jsx) understands far more than plain digits — ₹, commas, and the
 * Cr / L / Lakh / Lac / K suffixes an Indian buyer actually types. None of that
 * was asserted, and neither was the failure mode: garbage input must be IGNORED
 * (the previous bound stands), never coerced to 0, which would silently empty
 * the result set.
 *
 * Scoped to the desktop sidebar, matching type-aware-filters.spec.js.
 */

const filters = (page) => page.locator('aside:has(h3:has-text("Filters"))');
const maxLabel = (page, name) => filters(page).getByRole('button', { name: new RegExp(`${name} maximum`) });
const maxInput = (page, name) => filters(page).getByRole('textbox', { name: `${name} maximum value` });

/** Type `text` into the max label of `name` and commit with Enter. */
async function typeMax(page, name, text) {
  await maxLabel(page, name).click();
  const input = maxInput(page, name);
  await input.fill(text);
  await input.press('Enter');
}

test.describe('DualRange currency parsing', () => {
  test('the Cr / L / K suffixes resolve to the right magnitude', async ({ page }) => {
    await page.goto('/listings?deal=buy');

    // Budget is formatted in Indian units, so each suffix has a checkable readout.
    await typeMax(page, 'Budget Range', '2.5cr');
    await expect(maxLabel(page, 'Budget Range')).toHaveText('₹2.50 Cr');

    await typeMax(page, 'Budget Range', '75L');
    await expect(maxLabel(page, 'Budget Range')).toHaveText('₹75 L');

    // "lakh" and "lac" are the same unit spelled how people actually write it.
    await typeMax(page, 'Budget Range', '90 lakh');
    await expect(maxLabel(page, 'Budget Range')).toHaveText('₹90 L');

    await typeMax(page, 'Budget Range', '1.2 crore');
    await expect(maxLabel(page, 'Budget Range')).toHaveText('₹1.20 Cr');
  });

  test('₹ symbols, commas and spaces are stripped rather than rejected', async ({ page }) => {
    await page.goto('/listings?deal=rent');

    // A user re-typing what the label already showed must not break it.
    await typeMax(page, 'Monthly Rent', '₹85,000');
    await expect(maxLabel(page, 'Monthly Rent')).toHaveText('₹85,000');

    await typeMax(page, 'Monthly Rent', ' 60 000 ');
    await expect(maxLabel(page, 'Monthly Rent')).toHaveText('₹60,000');
  });

  test('unparseable input leaves the previous bound standing', async ({ page }) => {
    await page.goto('/listings?deal=rent');

    await typeMax(page, 'Monthly Rent', '75000');
    await expect(maxLabel(page, 'Monthly Rent')).toHaveText('₹75,000');

    // Garbage must be ignored — coercing it to 0 would empty the results with no
    // explanation, which is the worst possible outcome for a filter.
    for (const junk of ['abc', '', '₹']) {
      await typeMax(page, 'Monthly Rent', junk);
      await expect(maxLabel(page, 'Monthly Rent')).toHaveText('₹75,000');
    }
  });

  test('Escape abandons an edit and Enter commits it', async ({ page }) => {
    await page.goto('/listings?deal=rent');

    await typeMax(page, 'Monthly Rent', '50000');
    await expect(maxLabel(page, 'Monthly Rent')).toHaveText('₹50,000');

    await maxLabel(page, 'Monthly Rent').click();
    const input = maxInput(page, 'Monthly Rent');
    await input.fill('12345');
    await input.press('Escape');
    await expect(maxLabel(page, 'Monthly Rent')).toHaveText('₹50,000');
  });

  test('a typed minimum above the current maximum does not silently swap the bounds', async ({ page }) => {
    await page.goto('/listings?deal=rent');

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
