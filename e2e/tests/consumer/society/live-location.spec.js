import { test, expect } from '@playwright/test';

/* Society Hub — location, live half.
 *
 * The mock spec this was copied from covers six acceptance criteria: the read-only map and its
 * "Get directions" deep link, and then a resident-proposed location-correction flow — propose,
 * resident gating, badge-not-gate, bounds rejection, and ops approval writing through to the
 * public pin. Only the first of those is carried over here, and the omission is the point rather
 * than an oversight.
 *
 * The society's coordinates are server-owned: `societies.lat` / `societies.lng`, seeded at
 * 18.5602 / 73.7861 for this slug and read through the society provider. Asserting the directions
 * link against them is a real statement about the live stack, and it is the assertion this file
 * exists to make.
 *
 * The correction flow is not. There is no `proposeSocietyLocation` endpoint, no society-location
 * provider on either side of the seam, and nothing in the backend that knows the words at all —
 * the whole feature lives in `lib/store.js` and writes `pnSocietyLocationFixes` and
 * `pnSocietyOverlay` to localStorage. Under `VITE_API_DOMAINS=*` those five tests would still go
 * green, because the mock store they exercise is still loaded; they would simply be testing the
 * mock store from a file whose name promises otherwise. That is worse than not having them: a
 * green `live-` spec is read as evidence the server does this, and the server does not.
 *
 * They stay in the mock spec, which is where they are true. This file grows back to six the day
 * the flow gets a backend, and the mock-retirement note records it as an unmigrated feature so
 * the gap is tracked rather than merely absent.
 */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const SLUG = 'skyline-heights-baner';

test('society hub shows a Get-directions deep link to the society coordinates', async ({ page }) => {
  await page.goto(`${BASE}/society/${SLUG}?tab=location`);
  await expect(page.getByRole('heading', { level: 1, name: /Skyline Heights/i })).toBeVisible({ timeout: 15_000 });

  const section = page.locator('section', { has: page.getByRole('heading', { name: /Location & connectivity/i }) });
  const dir = section.getByRole('link', { name: /Get directions/i });
  await expect(dir).toBeVisible({ timeout: 8000 });

  /* The coordinates are asserted literally rather than read back out of the page, so that a
     provider which silently drops `lat`/`lng` and lets the map fall back to a city centre cannot
     satisfy this by agreeing with itself. They match the seeded row exactly. */
  await expect(dir).toHaveAttribute('href', /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=18\.5602,73\.7861/);
  await expect(dir).toHaveAttribute('target', '_blank');
  await expect(dir).toHaveAttribute('rel', /noopener/);
});
