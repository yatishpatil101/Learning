import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

const cards = (page) => page.locator('a[href^="/property/"]');
/* Identity of every rendered card, sorted so the assertion does not also depend on
   the sort order (which `newest` makes a function of seed timestamps). */

const slugs = async (page) => {
  const hrefs = await cards(page).evaluateAll((els) => els.map((el) => el.getAttribute('href')));
  return hrefs.map((h) => h.replace('/property/', '')).sort();
};
/* The grid renders from `useDeferredValue(f)` while the URL applies immediately, so
   a one-shot read can catch the pre-filter paint and pass by luck. Always poll. */

const expectSlugs = async (page, expected) => {
  await expect.poll(async () => await slugs(page), { timeout: 15000 }).toEqual([...expected].sort());
};

test('Preferred-tenants filter reflects the stated policy, not a hash of the slug', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=rent&tenants=family`);
  await cards(page).first().waitFor({ timeout: 15000 });
  const shown = await slugs(page);
  for (const stated of ['p5121', 'p5123']) {
    expect(shown, `${stated} states it accepts families`).toContain(stated);
  }
  for (const other of ['p5122', 'p5007', 'p5014', 'p5033']) {
    expect(shown, `${other} states a preference that is not family`).not.toContain(other);
  }
});

test('Availability filter reflects the stated date, not a hash of the slug', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=rent&availfrom=now`);
  await expectSlugs(page, ['p5121', 'p5007']);
});

test('Pet-friendly filter reflects the stated policy, not a hash of the slug', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=rent&pets=1`);
  await cards(page).first().waitFor({ timeout: 15000 });
  const shown = await slugs(page);
  for (const stated of ['p5033', 'p5122']) {
    expect(shown, `${stated} states pets are allowed`).toContain(stated);
  }
  for (const other of ['p5007', 'p5123']) {
    expect(shown, `${other} does not state a pet-friendly policy`).not.toContain(other);
  }
});

test('Flatmates type comes from the stated room, not a coin flip on the slug', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=rent&ptype=flatmates`);
  await expectSlugs(page, ['p5007', 'p5014', 'p5033', 'p5122', 'p5165', 'p5166', 'p5167', 'p5168']);
});

test('listings that state nothing are excluded from narrowed searches, not defaulted in', async ({ page }) => {
  for (const url of ['deal=rent&availfrom=now', 'deal=rent&pets=1']) {
    await page.goto(`${BASE}/listings?${url}`);
    await cards(page).first().waitFor({ timeout: 15000 });
    expect(await slugs(page), `p5000 states no attributes and must not match ${url}`).not.toContain('p5000');
  }
});
