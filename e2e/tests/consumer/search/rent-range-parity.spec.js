import { test, expect } from '@playwright/test';

/* Size and deposit are the two numbers a tenant actually shops on, and neither was filterable.

   Carpet area existed, but only on the buy side: the control lived in `BuyExtraSections`, the URL
   round-trip sat in the buy branch of `filtersToParams`, and `facetQuery` gated `minArea`/`maxArea`
   behind `isBuy`. Three separate gates, so relaxing any one of them alone would have produced a
   control that paints and then filters nothing — which is why the wire is asserted here and not
   just the presence of the slider.

   The deposit had no control on either side. It is the largest single sum an Indian tenant is
   asked for and routinely outweighs the difference in rent the budget slider does let them
   express, so "cheap rent" with no way to ask about the deposit is the wrong half of the price.

   The column is nullable and 9 of the 26 approved rentals leave it blank, which makes the
   disclosure load-bearing: those rows are kept (silence is not an offer of zero) and counted out,
   exactly as `unstated-range-disclosure` establishes for age and floor. Area is never null on
   a rental, so the same page must show no disclosure at all — that contrast is what proves the
   count is computed per question asked rather than emitted whenever a range is present. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

const countLine = (page) => page.locator('p:has-text("Showing")').first();

/* The grid renders from `useDeferredValue(f)` while the URL applies immediately, so a one-shot
   read can catch the pre-filter paint and pass by luck. Always poll. */
const expectShowing = async (page, total) => {
  await expect.poll(async () => (await countLine(page).innerText()).replace(/\s+/g, ' '), { timeout: 15000 })
    .toMatch(new RegExp(`Showing ${total} propert`, 'i'));
};

/* What the browser actually sent. A range that round-trips through the URL but never reaches the
   query string is the failure this spec exists to catch, and it is invisible from the result count
   alone whenever the seed happens to agree. */
const facetRequest = (page) => page.waitForRequest((r) => r.url().includes('/properties?'), { timeout: 15000 });

test('a rent search can narrow by carpet area, and sends the bound', async ({ page }) => {
  const sent = facetRequest(page);
  await page.goto(`${BASE}/listings?deal=rent&area=1000-6000`);

  const url = new URL((await sent).url());
  expect(url.searchParams.get('minArea')).toBe('1000');
  // 6000 is the slider ceiling, so the upper thumb means "and above" and must not be sent as a
  // bound — p5111 is 9000 sq.ft and belongs in this result.
  expect(url.searchParams.has('maxArea')).toBe(false);

  /* 16 of the 26 approved rentals are 1000 sq.ft or larger. Pinning the total is what proves the
     other 10 are the *only* exclusions; "fewer than before" would also pass against a server that
     had simply dropped rows. The three farm-land rows (1 and 2 acres, 30 guntha) are excluded on
     their stored number, which is the honest reading of a column the filter labels in sq.ft. */
  await expectShowing(page, 16);

  // Area is stated on every rental, so nothing here is silent on the question that was asked.
  await expect(countLine(page)).not.toContainText(/state this/i);
});

test('the carpet-area control is on the rent panel, not only the buy one', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=rent`);
  await page.getByRole('button', { name: /filters/i }).first().click().catch(() => {});
  // The section moved into the deal-agnostic panel; a rent search that cannot see it cannot use it,
  // however correct the wire happens to be.
  await expect(page.getByRole('button', { name: /carpet area/i }).first()).toBeVisible();
});

test('a deposit bound keeps the rentals that never stated one, and says how many', async ({ page }) => {
  const sent = facetRequest(page);
  await page.goto(`${BASE}/listings?deal=rent&deposit=0-100000`);

  const url = new URL((await sent).url());
  expect(url.searchParams.get('maxDeposit')).toBe('100000');
  expect(url.searchParams.has('minDeposit')).toBe(false);

  /* 8 rentals state a deposit of ₹1,00,000 or less (p5121, p5122, p5162, p5164, p5165, p5166,
     p5167, p5168) and 9 state none at all. 17, not 8: a row that never published a deposit has not
     thereby published a zero, and dropping it would answer "show me what I can afford" by hiding
     the listings whose deposit is simply unknown. 26 — the unfiltered rent catalogue — would mean
     the parameter was ignored. */
  await expectShowing(page, 17);
  await expect(countLine(page)).toContainText(/9 don't state this/i);
});

test('a high deposit band excludes the stated cheap ones and keeps the silent', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=rent&deposit=500000-1000000`);

  /* 6 stated deposits clear ₹5,00,000 (₹5.7L, ₹8.1L, ₹9.6L, ₹10.5L, ₹13.2L and ₹18.6L) plus the
     same 9 silent rows. The two above the slider's ceiling are still here because the upper thumb
     is at its maximum and so sends no bound — the band reads "₹5L and above", which is what the
     control shows. */
  await expectShowing(page, 15);
  await expect(countLine(page)).toContainText(/9 don't state this/i);
});

test('an untouched deposit slider asks nothing and discloses nothing', async ({ page }) => {
  const sent = facetRequest(page);
  await page.goto(`${BASE}/listings?deal=rent`);

  const url = new URL((await sent).url());
  expect(url.searchParams.has('minDeposit')).toBe(false);
  expect(url.searchParams.has('maxDeposit')).toBe(false);

  await expectShowing(page, 26);
  // Nobody was asked about the deposit, so nobody is silent on it.
  await expect(countLine(page)).not.toContainText(/state this/i);
});

test('the deposit is a rent-side question and is never asked of a sale', async ({ page }) => {
  const sent = facetRequest(page);
  await page.goto(`${BASE}/listings?deal=buy&deposit=0-100000`);

  // `deposit` is not a buy-side param, so a hand-edited link carrying one must not reach the wire
  // and quietly shrink a sale search by a column no sale listing fills in.
  const url = new URL((await sent).url());
  expect(url.searchParams.has('maxDeposit')).toBe(false);
});
