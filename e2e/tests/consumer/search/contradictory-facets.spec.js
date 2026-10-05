import { test, expect } from '@playwright/test';

/* Availability and Construction Status used to be two controls over one column. They are now one
   Possession filter, but old shared URLs can still carry both `avail` and `constr`. The migrated
   state must resolve that deterministically and still send a possession facet, never drop both and
   answer with the entire catalogue. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

const cards = (page) => page.locator('a[href^="/property/"]');
const countLine = (page) => page.locator('p:has-text("Showing")').first();

async function openListings(page) {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`${BASE}/listings?deal=buy`);
  await expect(cards(page).first()).toBeVisible({ timeout: 15000 });
}

test('legacy possession params that contradict do not widen to the full catalogue', async ({ page }) => {
  await openListings(page);
  const before = await cards(page).count();
  expect(before, 'the unfiltered buy catalogue is empty; the seed did not run').toBeGreaterThan(1);

  const asked = page.waitForRequest((r) => /\/properties\?/.test(r.url())
    && new URL(r.url()).searchParams.get('construction') === 'under-construction');

  await page.goto(`${BASE}/listings?deal=buy&avail=ready&constr=under`);
  await asked;
  await expect.poll(() => new URL(page.url()).searchParams.get('constr'), { timeout: 15000 }).toBe('under');
  await expect.poll(() => new URL(page.url()).searchParams.has('avail'), { timeout: 15000 }).toBe(false);

  await expect.poll(async () => (await countLine(page).innerText()).replace(/\s+/g, ' '), { timeout: 15000 })
    .toMatch(/Showing \d+ propert/i);
  await expect.poll(() => cards(page).count(), { timeout: 15000 }).toBeLessThan(before);
});
