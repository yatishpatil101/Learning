import { test, expect } from '@playwright/test';

/* Flatmates tile at 412 and 360: trust features stay on one line (nowrap, swipes at 360), CTAs stack
   full-width below `sm`, and the page gains no horizontal overflow. */

const FEATURES = ['Verified seekers', 'Women-only filter', 'No number sharing'];

async function gotoFlatmatesTile(page) {
  await page.goto('/');
  const cta = page.getByRole('button', { name: 'Find a flatmate' });
  await cta.scrollIntoViewIfNeeded();
  await expect(cta).toBeVisible();
  return cta;
}

test('the Flatmates tile keeps its trust features on one line, stacks full-width CTAs and adds no overflow', async ({ page }) => {
  const find = await gotoFlatmatesTile(page);

  await test.step('the three trust features stay on a single line', async () => {
    /* Read in one evaluate: the tile fades in on scroll, so tops sampled in separate round trips
       straddle the transform and differ by a few px on a layout that is one row. */
    const handles = await Promise.all(
      FEATURES.map((label) => page.getByText(label, { exact: true }).first().elementHandle())
    );
    const tops = await page.evaluate(
      (els) => els.map((el) => Math.round(el.getBoundingClientRect().top)),
      handles
    );

    // Same y for all three == one row. Sub-pixel drift is absorbed by the round.
    expect(new Set(tops).size).toBe(1);
  });

  await test.step('both CTAs are full-width and stacked', async () => {
    const post = page.getByRole('button', { name: 'Post your requirement' });

    const [findBox, postBox] = await Promise.all([find.boundingBox(), post.boundingBox()]);

    // Same width and same left edge == stacked in one column, not side by side.
    expect(Math.round(findBox.width)).toBe(Math.round(postBox.width));
    expect(Math.round(findBox.x)).toBe(Math.round(postBox.x));
    expect(postBox.y).toBeGreaterThan(findBox.y + findBox.height - 1);

    // Full-width: the buttons fill the tile's inner column.
    const columnWidth = await find.evaluate((el) => el.parentElement.parentElement.clientWidth);
    expect(findBox.width).toBeCloseTo(columnWidth, 0);
  });

  await test.step('the tile introduces no horizontal page overflow', async () => {
    const { scroll, client } = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(scroll).toBeLessThanOrEqual(client);
  });
});
