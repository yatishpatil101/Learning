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

   Nullable deposits make the disclosure load-bearing: silent rows are kept (silence is not an
   offer of zero) and counted out, exactly as `unstated-range-disclosure` establishes for age and
   floor. Area is never null on a rental, so the same page must show no disclosure at all. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

const countLine = (page) => page.locator('p:has-text("Showing")').first();
const apiTotals = async (request, params) => {
  const url = new URL(`${BASE}/api/properties`);
  Object.entries({ ...params, size: '1' }).forEach(([key, value]) => url.searchParams.set(key, value));
  const res = await request.get(url.toString());
  expect(res.ok()).toBeTruthy();
  return await res.json();
};

/* The grid renders from `useDeferredValue(f)` while the URL applies immediately, so a one-shot
   read can catch the pre-filter paint and pass by luck. Always poll. */
const expectShowing = async (page, total) => {
  await expect.poll(async () => (await countLine(page).innerText()).replace(/\s+/g, ' '), { timeout: 15000 })
    .toMatch(new RegExp(`Showing ${total} propert`, 'i'));
};

/* What the browser actually sent. A range that round-trips through the URL but never reaches the
   query string is the failure this spec exists to catch, and it is invisible from the result count
   alone whenever the seed happens to agree. */
const facetRequest = (page, match = () => true) => page.waitForRequest((r) => {
  if (!r.url().includes('/properties?')) return false;
  return match(new URL(r.url()).searchParams);
}, { timeout: 15000 });

test('a rent search can narrow by carpet area, sends the bound, and shows the area control on the rent panel', async ({ page, request }) => {
  await test.step('a rent search can narrow by carpet area, and sends the bound', async () => {
    const expected = await apiTotals(request, { deal: 'rent', minArea: '1000' });
    const sent = facetRequest(page, (q) => q.get('minArea') === '1000');
    await page.goto(`${BASE}/listings?deal=rent&area=1000-6000`);

    const url = new URL((await sent).url());
    expect(url.searchParams.get('minArea')).toBe('1000');
    // 6000 is the slider ceiling, so the upper thumb means "and above" and must not be sent.
    expect(url.searchParams.has('maxArea')).toBe(false);

    await expectShowing(page, expected.totalElements);

    // Area is stated on every rental, so nothing here is silent on the question that was asked.
    await expect(countLine(page)).not.toContainText(/state this/i);
  });

  await test.step('the area control is on the rent panel, not only the buy one', async () => {
    await page.goto(`${BASE}/listings?deal=rent`);
    await page.getByRole('button', { name: /filters/i }).first().click().catch(() => {});
    // The section moved into the deal-agnostic panel; a rent search that cannot see it cannot use it,
    // however correct the wire happens to be. The step above pins the same control to minArea.
    await expect(page.getByRole('button', { name: /^area/i }).first()).toBeVisible();
  });
});

test('the deposit filter sends its bounds, discloses the silent rentals, and is never asked of a sale', async ({ page, request }) => {
  test.slow();
  await test.step('a deposit bound keeps the rentals that never stated one, and says how many', async () => {
    const expected = await apiTotals(request, { deal: 'rent', maxDeposit: '100000' });
    const sent = facetRequest(page, (q) => q.get('maxDeposit') === '100000');
    await page.goto(`${BASE}/listings?deal=rent&deposit=0-100000`);

    const url = new URL((await sent).url());
    expect(url.searchParams.get('maxDeposit')).toBe('100000');
    expect(url.searchParams.has('minDeposit')).toBe(false);

    await expectShowing(page, expected.totalElements);
    await expect(countLine(page)).toContainText(new RegExp(`${expected.unstatedElements} don't state this`, 'i'));
  });

  await test.step('a high deposit band excludes the stated cheap ones and keeps the silent', async () => {
    const expected = await apiTotals(request, { deal: 'rent', minDeposit: '500000' });
    await page.goto(`${BASE}/listings?deal=rent&deposit=500000-1000000`);

    await expectShowing(page, expected.totalElements);
    await expect(countLine(page)).toContainText(new RegExp(`${expected.unstatedElements} don't state this`, 'i'));
  });

  await test.step('an untouched deposit slider asks nothing and discloses nothing', async () => {
    const expected = await apiTotals(request, { deal: 'rent' });
    const sent = facetRequest(page, (q) => q.get('deal') === 'rent' && !q.has('minDeposit') && !q.has('maxDeposit'));
    await page.goto(`${BASE}/listings?deal=rent`);

    const url = new URL((await sent).url());
    expect(url.searchParams.has('minDeposit')).toBe(false);
    expect(url.searchParams.has('maxDeposit')).toBe(false);

    await expectShowing(page, expected.totalElements);
    // Nobody was asked about the deposit, so nobody is silent on it.
    await expect(countLine(page)).not.toContainText(/state this/i);
  });

  await test.step('the deposit is a rent-side question and is never asked of a sale', async () => {
    const sent = facetRequest(page, (q) => q.get('deal') === 'buy' && !q.has('maxDeposit'));
    await page.goto(`${BASE}/listings?deal=buy&deposit=0-100000`);

    // `deposit` is not a buy-side param, so a hand-edited link carrying one must not reach the wire
    // and quietly shrink a sale search by a column no sale listing fills in.
    const url = new URL((await sent).url());
    expect(url.searchParams.has('maxDeposit')).toBe(false);
  });
});
