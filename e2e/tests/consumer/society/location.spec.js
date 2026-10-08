import { test, expect } from '../../../fixtures/live.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const SEEDED = 'skyline-heights-baner'; // read-only; pin 18.5602 / 73.7861

/** The Location tab, found by its own heading rather than by the page's. */
function locationSection(page) {
  return page.locator('section', { has: page.getByRole('heading', { name: /Location & connectivity/i }) });
}

test('society hub shows a Get-directions deep link to the society coordinates', async ({ page }) => {
  await page.goto(`${BASE}/society/${SEEDED}?tab=location`);
  await expect(page.getByRole('heading', { level: 1, name: /Skyline Heights/i })).toBeVisible({ timeout: 15_000 });

  const dir = locationSection(page).getByRole('link', { name: /Get directions/i });
  await expect(dir).toBeVisible({ timeout: 8000 });

  /* Literal coordinates, not read back out of the page: a catalogue that drops `lat`/`lng` and
     falls back to a city centre would otherwise satisfy this by agreeing with itself. */
  await expect(dir).toHaveAttribute('href', /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=18\.5602,73\.7861/);
  await expect(dir).toHaveAttribute('target', '_blank');
  await expect(dir).toHaveAttribute('rel', /noopener/);
});

test('the Location tab has no resident-only "suggest a correction" control', async ({ page }) => {
  await page.goto(`${BASE}/society/${SEEDED}?tab=location`);
  await expect(locationSection(page).getByRole('link', { name: /Get directions/i })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: /Suggest correct location/i })).toHaveCount(0);
  await expect(page.getByText(/Location fix under review/i)).toHaveCount(0);
});
