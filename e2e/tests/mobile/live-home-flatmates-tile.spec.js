import { test, expect } from '@playwright/test';

/* Home's "Flatmates" tile on mobile.
 *
 * Contracts the layout must keep at both mobile widths (412 and 360):
 *
 *  1. The three trust features (Verified seekers / Women-only filter /
 *     No number sharing) sit on ONE line. They used to wrap to two, which put a
 *     ragged orphan under a card that is already tall. The row is
 *     flex-nowrap + overflow-x-auto, so "one line" means one line at every width:
 *     at 412 the content fits exactly, at 360 it swipes behind an edge mask.
 *
 *  2. Both CTAs are full-width and stacked below `sm`. Side-by-side pills of
 *     unequal width read as broken on a phone, and the primary action deserves
 *     the whole column.
 *
 *  3. The tile adds no horizontal page overflow.
 *
 * All are pure layout reads, so they are deterministic once the section paints. */

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
