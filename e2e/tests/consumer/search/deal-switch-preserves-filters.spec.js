import { test, expect } from '@playwright/test';

/* Flipping Rent <-> Buy must preserve everything the two journeys share (localities, societies,
   amenities, badges, size band, radius) while dropping deal-specific price and tenancy filters.
   There are two resets, not one: `switchDeal` on the toggle, and an effect on `urlDeal` change. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

/* Phone width: the toggle is `lg:hidden`, so the button path does not exist on a desktop viewport.
   The URL path below is the one a desktop user reaches, and it is asserted separately. */
test.use({ viewport: { width: 390, height: 844 } });

const toggle = (page) => page.getByRole('radiogroup', { name: /switch between renting and buying/i });

/* Anchored: the panel behind the toggle carries a "Buy" heading and "For Sale" prose, so an
   unanchored pattern matches more than the radio. */
const buyRadio = (page) => toggle(page).getByRole('radio', { name: /^buy$/i });

const chip = (page, text) => page.getByRole('button', { name: new RegExp(text, 'i') });

const urlOf = (page) => new URL(page.url());

test('the toggle keeps the filters that mean the same thing on both sides', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=rent&loc=balewadi&amen=gym&v=owner&area=1000-6000&rent=10000-40000&owneronly=1`);
  await expect(toggle(page)).toBeVisible();

  await buyRadio(page).click();

  // The address bar is the state, so it is the assertion. `replace: true` writes it synchronously
  // after the transition, hence the poll rather than a bare read.
  await expect.poll(() => urlOf(page).searchParams.get('deal'), { timeout: 15000 }).toBe('buy');

  const q = urlOf(page).searchParams;
  expect(q.get('loc')).toBe('balewadi');
  expect(q.get('amen')).toBe('gym');
  expect(q.get('v')).toBe('owner');
  expect(q.get('area')).toBe('1000-6000');
  // Who posted a listing is a fact about the person, not about the deal, so it crosses. Asserted
  // here because only this path runs `switchDealFilters`; a `goto` re-derives state from the URL.
  expect(q.get('owneronly')).toBe('1');
  // A monthly-rent band is not a sale budget. Carrying it over would read as a ₹40,000 flat.
  expect(q.has('rent')).toBe(false);
  expect(q.has('budget')).toBe(false);
});

test('a land use survives the switch, because a zone means the same on a lease as on a sale', async ({ page }) => {
  // Plot and farmland are offered on both deals, so the zone question outlives the switch. It is
  // asserted apart from the others because it is the one shared key written outside the deal split.
  await page.goto(`${BASE}/listings?deal=rent&ptype=plot&landuse=residential&loc=balewadi`);

  await buyRadio(page).click();
  await expect.poll(() => urlOf(page).searchParams.get('deal'), { timeout: 15000 }).toBe('buy');

  const q = urlOf(page).searchParams;
  expect(q.get('ptype')).toBe('plot');
  expect(q.get('landuse')).toBe('residential');
});

test('a rent-only filter is dropped rather than carried into a sale search', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=rent&loc=balewadi&tenants=family&pets=1&availfrom=now`);

  await buyRadio(page).click();
  await expect.poll(() => urlOf(page).searchParams.get('deal'), { timeout: 15000 }).toBe('buy');

  const q = urlOf(page).searchParams;
  expect(q.get('loc')).toBe('balewadi');
  // None of these has a sale equivalent, so keeping them would filter on a question nobody asked.
  expect(q.has('tenants')).toBe(false);
  expect(q.has('pets')).toBe(false);
  expect(q.has('availfrom')).toBe(false);
});

test('BHK is coerced across the deals rather than discarded', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=rent&bhk=3plus&loc=balewadi`);

  await buyRadio(page).click();
  await expect.poll(() => urlOf(page).searchParams.get('deal'), { timeout: 15000 }).toBe('buy');

  // Buy has no `3plus` bucket; the nearest it can express is 3 BHK, which is what a deep link
  // carrying the same token already resolves to.
  expect(urlOf(page).searchParams.get('bhk')).toBe('3');
});

test('an in-app Rent/Buy link preserves as much as the toggle does', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=rent&loc=balewadi&amen=gym`);
  await expect(page.locator('p:has-text("Showing")').first()).toBeVisible();

  /* A client-side navigation, not a reload: `goto` would re-read the whole state from the new URL
     and pass whatever the effect did. This is the desktop header path, where the toggle is hidden. */
  await page.evaluate(() => window.history.pushState({}, '', '/listings?deal=buy'));
  await page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')));

  await expect.poll(() => urlOf(page).searchParams.get('loc'), { timeout: 15000 }).toBe('balewadi');
  expect(urlOf(page).searchParams.get('amen')).toBe('gym');
  expect(urlOf(page).searchParams.get('deal')).toBe('buy');
});

test('a link that names its own filters arrives clean, not carrying the previous search', async ({ page }) => {
  /* Carrying filters over is right for a bare deal change, and wrong the moment the link narrows
     something itself: "Buy plots" must not quietly mean "buy plots in Balewadi with a gym". */
  await page.goto(`${BASE}/listings?deal=rent&loc=balewadi&amen=gym`);
  await expect(page.locator('p:has-text("Showing")').first()).toBeVisible();

  await page.evaluate(() => window.history.pushState({}, '', '/listings?deal=buy&ptype=plot'));
  await page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')));

  await expect.poll(() => urlOf(page).searchParams.get('deal'), { timeout: 15000 }).toBe('buy');
  const q = urlOf(page).searchParams;
  expect(q.get('ptype')).toBe('plot');
  expect(q.get('loc')).toBeNull();
  expect(q.get('amen')).toBeNull();
});
