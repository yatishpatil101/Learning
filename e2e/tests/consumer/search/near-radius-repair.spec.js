import { test, expect } from '@playwright/test';

/* The Near-a-Place radius, at its two edges.

   Clearing the number field used to store `''`. `nearParams` treats a non-numeric radius as no
   radius and returns `{}` — which drops the CENTRE POINT with it, so the whole proximity filter
   went silently off while the chip and the place name stayed on screen. The buyer is looking at a
   search that says "within N km of Hinjawadi" and reading results from all of Pune.

   The repair keeps the half-typed text out of the filter rather than writing a repaired value into
   it: a blank field is a keystroke on the way somewhere, so the radius already in effect stands
   until a legal one replaces it. Pinned as "no request ever left without the point", because the
   bug produced a perfectly healthy-looking screen — nothing in the DOM distinguishes it.

   The other edge is the ceiling. The controls offer 25 km and the server clamps at 50, so a
   hand-edited or shared `?nearr=9999` would otherwise render a slider pinned at a number the
   search never honoured. What is displayed must be what was asked. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

// Hinjawadi IT Park — a real point in the seeded catalogue's city, so the search is answerable.
const POINT = 'near=18.5913%2C73.7389&nearlabel=Hinjawadi+IT+Park';

const filters = (page) => page.locator('aside:has(h3:has-text("Filters"))').first();
/* Scoped to the group, not the page: the desktop aside and the mobile drawer both mount the whole
   panel, so every control inside it exists twice. */
const radiusField = (group) => group.getByLabel('Search radius value');

async function openNear(page, query) {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`${BASE}/listings?${query}`);
  await filters(page).waitFor({ timeout: 15000 });
  const group = filters(page).locator('.filter-group:has(button.fg-header:has-text("Near a Place"))').first();
  /* The section ships collapsed, but that is a product call rather than a contract: read the
     state instead of assuming it, or the click that opens it today closes it tomorrow. */
  const header = group.locator('button.fg-header').first();
  if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click();
  await expect(radiusField(group)).toBeVisible({ timeout: 10000 });
  return group;
}

test('clearing the radius repairs it instead of dropping the proximity filter', async ({ page }) => {
  const group = await openNear(page, `${POINT}&nearr=12`);
  await expect(radiusField(group)).toHaveValue('12');

  /* Every search the page runs from here on. The bug was an ABSENCE on the wire, so the assertion
     has to be over all of them — a single later request carrying the point proves nothing about
     the one that went out while the field was blank. */
  const unscoped = [];
  page.on('request', (r) => {
    if (!/\/properties\?/.test(r.url())) return;
    const p = new URL(r.url()).searchParams;
    if (!p.has('nearLat') || !p.has('nearLng') || !p.has('nearRadiusKm')) unscoped.push(r.url());
  });

  await radiusField(group).fill('');
  // Long enough for a search the blank would have triggered to reach the network.
  await page.waitForTimeout(1500);
  expect(unscoped, 'a search left without the proximity point while the radius field was blank').toEqual([]);

  // Typing resumes from empty without the field fighting back: 1, then 2, is twelve.
  await radiusField(group).pressSequentially('12');
  await expect(radiusField(group)).toHaveValue('12');
  await radiusField(group).blur();
  await expect(radiusField(group)).toHaveValue('12');
  await expect(page.locator('.af-chip', { hasText: 'Hinjawadi IT Park' }).first()).toBeVisible();
  expect(unscoped, 'a search left without the proximity point').toEqual([]);
});

test('a radius from outside the controls is clamped to the widest one offered', async ({ page }) => {
  const group = await openNear(page, `${POINT}&nearr=9999`);
  await expect(radiusField(group)).toHaveValue('25');
  await expect(group.locator('input[type="range"]')).toHaveAttribute('max', '25');
});
