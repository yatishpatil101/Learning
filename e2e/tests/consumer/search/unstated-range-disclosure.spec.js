import { test, expect } from '@playwright/test';

/* Age and floor are optional on a listing, and most of the catalogue leaves them blank. A bare SQL
   bound evaluates as false against NULL, so nudging either slider used to delete every silent row —
   the buyer narrowed "age" by one year and lost the silent majority, none of which had said
   anything that contradicted them.

   They are kept now, which makes the disclosure the load-bearing part: a result set that quietly
   mixes "stated, and in range" with "never said" is a different claim from the one the filter
   appears to make. The count line names how many never answered, counted over the whole match
   rather than the page, so it does not change as the buyer pages through.

   Numbers are pinned against the seed: "more results than before" would pass under a coalesce to
   zero, which is the other wrong answer (it reads silence as "brand new"). */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

const cards = (page) => page.locator('a[href^="/property/"]');
const countLine = (page) => page.locator('p:has-text("Showing")').first();

const hrefs = async (page) => cards(page).evaluateAll((els) => els.map((el) => el.getAttribute('href')));

/* The grid renders from `useDeferredValue(f)` while the URL applies immediately, so a one-shot
   read can catch the pre-filter paint and pass by luck. Always poll. */
const expectShowing = async (page, total) => {
  await expect.poll(async () => (await countLine(page).innerText()).replace(/\s+/g, ' '), { timeout: 15000 })
    .toMatch(new RegExp(`Showing ${total} propert`, 'i'));
};

test('an age bound keeps the listings that never stated an age, and says how many', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=buy&age=0-3`);

  /* 33 approved buy rows: 21 state no age at all, 4 state 0-3 years, and 8 state an age outside
     the bound (p5008=6, p5120=9, p5013=18, p5140=11, p5142=6, p5146=8, p5148=4, p5169=7). Pinning
     the total is what proves those eight are the *only* exclusions — absence from page one proves
     nothing at a page size of 24. It is also what rules out the hash these attributes were once
     derived from, which invented an age for every row and could not produce this split. */
  await expectShowing(page, 25);
  await expect(countLine(page)).toContainText(/21 don't state this/i);

  const shown = await hrefs(page);
  expect(shown).toEqual(expect.arrayContaining(['/property/p5133', '/property/p5130', '/property/p5023']));
});

test('a floor bound keeps the listings that never stated a floor, and says how many', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=buy&floor=8-40`);

  /* 23 state no floor; p5008=9, p5120=11 and p5146=10 clear the bound; p5133=3, p5023=5, p5013=2,
     p5140=3, p5142=7, p5144=1 and p5148=5 do not. */
  await expectShowing(page, 26);
  await expect(countLine(page)).toContainText(/23 don't state this/i);

  const shown = await hrefs(page);
  expect(shown).toEqual(expect.arrayContaining(['/property/p5008', '/property/p5120']));
});

test('the disclosure is absent when neither slider was moved', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=buy`);
  await expectShowing(page, 33);
  // Nothing was asked about age or floor, so nobody is silent on a question that was put to them.
  await expect(countLine(page)).not.toContainText(/state this/i);
});
