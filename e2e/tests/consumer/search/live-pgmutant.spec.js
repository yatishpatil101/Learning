/* TEMPORARY mutation probe - delete after running.
   v1 of this probe was vacuous: both mutants asserted the PRE-filter set
   ['p5007','p5033'], and `expect.poll().toEqual(X)` succeeds the instant it sees X,
   which includes the paint before the filter applies. Both passed and proved nothing.
   Every assertion below now targets a state the pre-filter paint cannot satisfy. */
import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const filters = (page) => page.locator('aside:has(h3:has-text("Filters"))');
const sharingTrigger = (page) => filters(page).getByRole('button', { name: 'Sharing' });
const cards = (page) => page.locator('a[href^="/property/"]');

const slugs = async (page) => {
  const hrefs = await cards(page).evaluateAll((els) => els.map((el) => el.getAttribute('href')));
  return hrefs.map((h) => h.replace('/property/', '')).sort();
};
const expectSlugs = async (page, expected) => {
  await expect.poll(async () => await slugs(page), { timeout: 8000 }).toEqual([...expected].sort());
};

/* MUST FAIL. Picking Double leaves p5033 (which offers double+triple), not p5007
   (triple-only). If this passes, the grid is not being read at all. */
test('MUTANT-A must fail: Double yields p5007', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=rent&ptype=pg`);
  await expectSlugs(page, ['p5007', 'p5033']);
  await sharingTrigger(page).click();
  await page.getByRole('option', { name: 'Double Sharing' }).click();
  await expectSlugs(page, ['p5007']);
});

/* MUST PASS, and non-vacuously: it starts from a ONE-row filtered state and widens
   to two. The pre-filter paint cannot satisfy it because the page opens already
   narrowed by the deep link. This is what proves the dropdown commits the value
   picked rather than merely clearing the filter. */
test('MUTANT-B must pass: Double -> Triple widens back to both rows', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=rent&ptype=pg&sharing=double`);
  await expectSlugs(page, ['p5033']);
  await sharingTrigger(page).click();
  await page.getByRole('option', { name: 'Triple Sharing' }).click();
  await expectSlugs(page, ['p5007', 'p5033']);
});

/* MUST FAIL. Same widening, wrong destination. Guards MUTANT-B against passing
   because the pick simply cleared the filter to "any". */
test('MUTANT-C must fail: Triple yields only p5007', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=rent&ptype=pg&sharing=double`);
  await expectSlugs(page, ['p5033']);
  await sharingTrigger(page).click();
  await page.getByRole('option', { name: 'Triple Sharing' }).click();
  await expectSlugs(page, ['p5007']);
});
