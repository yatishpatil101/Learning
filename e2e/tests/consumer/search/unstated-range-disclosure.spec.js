import { test, expect } from '@playwright/test';

/* Age and floor are optional on a listing, and most of the catalogue leaves them blank. A bare SQL
   bound evaluates as false against NULL, so nudging either slider used to delete every silent row —
   the buyer narrowed "age" by one year and lost the silent majority, none of which had said
   anything that contradicted them.

   They are kept now, which makes the disclosure the load-bearing part: a result set that quietly
   mixes "stated, and in range" with "never said" is a different claim from the one the filter
   appears to make. The count line names how many never answered, counted over the whole match
   rather than the page, so it does not change as the buyer pages through.

   Totals are compared against the live API response so a shared non-reset lane can still prove the
   UI is not reading silence as "brand new". */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

const cards = (page) => page.locator('a[href^="/property/"]');
const countLine = (page) => page.locator('p:has-text("Showing")').first();
const apiTotals = async (request, params) => {
  const url = new URL(`${BASE}/api/properties`);
  Object.entries({ ...params, size: '1' }).forEach(([key, value]) => url.searchParams.set(key, value));
  const res = await request.get(url.toString());
  expect(res.ok()).toBeTruthy();
  return await res.json();
};

const hrefs = async (page) => cards(page).evaluateAll((els) => els.map((el) => el.getAttribute('href')));

/* The grid renders from `useDeferredValue(f)` while the URL applies immediately, so a one-shot
   read can catch the pre-filter paint and pass by luck. Always poll. */
const expectShowing = async (page, total) => {
  await expect.poll(async () => (await countLine(page).innerText()).replace(/\s+/g, ' '), { timeout: 15000 })
    .toMatch(new RegExp(`Showing ${total} propert`, 'i'));
};

test('an age bound keeps the listings that never stated an age, and says how many', async ({ page, request }) => {
  const expected = await apiTotals(request, { deal: 'buy', maxAge: '3' });
  await page.goto(`${BASE}/listings?deal=buy&age=0-3`);

  await expectShowing(page, expected.totalElements);
  await expect(countLine(page)).toContainText(new RegExp(`${expected.unstatedElements} don't state this`, 'i'));

  const shown = await hrefs(page);
  expect(shown).toEqual(expect.arrayContaining(['/property/p5133', '/property/p5130', '/property/p5023']));
});

test('a floor bound keeps the listings that never stated a floor, and says how many', async ({ page, request }) => {
  const expected = await apiTotals(request, { deal: 'buy', minFloor: '8' });
  await page.goto(`${BASE}/listings?deal=buy&floor=8-40`);

  await expectShowing(page, expected.totalElements);
  await expect(countLine(page)).toContainText(new RegExp(`${expected.unstatedElements} don't state this`, 'i'));

  const shown = await hrefs(page);
  expect(shown).toEqual(expect.arrayContaining(['/property/p5008', '/property/p5120']));
});

test('the disclosure is absent when neither slider was moved', async ({ page, request }) => {
  const expected = await apiTotals(request, { deal: 'buy' });
  await page.goto(`${BASE}/listings?deal=buy`);
  await expectShowing(page, expected.totalElements);
  // Nothing was asked about age or floor, so nobody is silent on a question that was put to them.
  await expect(countLine(page)).not.toContainText(/state this/i);
});
