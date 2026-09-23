import { test, expect } from '@playwright/test';

/* Availability and Construction Status narrow the same column, so a buyer can set them to
   contradict — "Under Construction" on one control, "Ready to Move" on the other. The intersection
   is empty, and an empty intersection is a genuinely empty result.

   It used to be the opposite. The facet builder returned `[]`, the query serialiser drops an empty
   array, and an absent param means "not filtered" — so the impossible filter was answered with the
   ENTIRE catalogue. That is the failure mode that looks most like success: a full grid, two chips
   on screen, and nothing to suggest the filters were discarded. Pinned here as an exact count of
   zero plus the absence of any card, because "fewer results" passes under both behaviours. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

const filters = (page) => page.locator('aside:has(h3:has-text("Filters"))').first();
const cards = (page) => page.locator('a[href^="/property/"]');
const countLine = (page) => page.locator('p:has-text("Showing")').first();
const group = (page, title) => filters(page).locator(`.filter-group:has(button.fg-header:has-text("${title}"))`).first();

/* The inputs themselves are visually hidden and styled through their labels, so a `check()` on the
   control never becomes visible. Click what a buyer clicks. */
const option = (g, label) => g.locator('label', { hasText: new RegExp(`^${label}$`) }).first();

/* `FilterGroup` collapses some sections by default and the set is tuned by product, so neither
   "it is open" nor "click to open" is safe to assume: clicking an already-open one closes it. */
async function expand(g) {
  const header = g.locator('button.fg-header').first();
  if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click();
}

async function openListings(page) {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`${BASE}/listings?deal=buy`);
  await filters(page).waitFor({ timeout: 15000 });
  await expect(cards(page).first()).toBeVisible({ timeout: 15000 });
}

test('two controls over one column that contradict return nothing, not everything', async ({ page }) => {
  await openListings(page);
  const before = await cards(page).count();
  expect(before, 'the unfiltered buy catalogue is empty; the seed did not run').toBeGreaterThan(1);

  const avail = group(page, 'Availability');
  await expand(avail);
  await option(avail, 'Under Construction').click();

  /* The request that carries the contradiction. Asserted on the wire because the bug lived in the
     serialiser, not in the grid: a param that never leaves the browser cannot be seen downstream. */
  const asked = page.waitForRequest((r) => /\/properties\?/.test(r.url())
    && new URL(r.url()).searchParams.get('construction') === 'no.such.possession');

  const constr = group(page, 'Construction Status');
  await expand(constr);
  await option(constr, 'Ready to Move').click();

  await asked;
  /* Read the header's text rather than asserting a count element is visible: the results header is
     mounted once per breakpoint, so half the matches are hidden by design at any viewport. */
  await expect.poll(async () => (await countLine(page).innerText()).replace(/\s+/g, ' '), { timeout: 15000 })
    .toMatch(/Showing 0 propert/i);
  await expect(cards(page)).toHaveCount(0);
});
