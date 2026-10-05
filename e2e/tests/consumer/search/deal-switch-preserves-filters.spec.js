import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
/* Phone width: the toggle is `lg:hidden`, so the button path does not exist on a desktop viewport.
   The URL path below is the one a desktop user reaches, and it is asserted separately. */
test.use({ viewport: { width: 390, height: 844 } });

const toggle = (page) => page.getByRole('radiogroup', { name: /switch between renting and buying/i });
/* Anchored: the panel behind the toggle carries a "Buy" heading and "For Sale" prose, so an
   unanchored pattern matches more than the radio. */

const buyRadio = (page) => toggle(page).getByRole('radio', { name: /^buy$/i });
const rentRadio = (page) => toggle(page).getByRole('radio', { name: /^rent$/i });

const chip = (page, text) => page.getByRole('button', { name: new RegExp(text, 'i') });

const urlOf = (page) => new URL(page.url());

test('the deal toggle carries over the filters that mean the same on both sides, drops the rest and coerces BHK', async ({ page }) => {
  test.slow();
  await test.step('the toggle keeps the filters that mean the same thing on both sides', async () => {
    await page.goto(`${BASE}/listings?deal=rent&loc=balewadi&amen=gym&v=owner&area=1000-6000&rent=10000-40000`);
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
    expect(q.has('rent')).toBe(false);
    expect(q.has('budget')).toBe(false);
  });

  await test.step('a land use survives the switch, because a zone means the same on a lease as on a sale', async () => {
    // Plot and farmland are offered on both deals, so the zone question outlives the switch. It is
    // asserted apart from the others because it is the one shared key written outside the deal split.
    await page.goto(`${BASE}/listings?deal=rent&ptype=plot&landuse=residential&loc=balewadi`);

    await buyRadio(page).click();
    await expect.poll(() => urlOf(page).searchParams.get('deal'), { timeout: 15000 }).toBe('buy');

    const q = urlOf(page).searchParams;
    expect(q.get('ptype')).toBe('plot');
    expect(q.get('landuse')).toBe('residential');
  });

  await test.step('a rent-only filter is dropped rather than carried into a sale search', async () => {
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

  await test.step('BHK is coerced across the deals rather than discarded', async () => {
    await page.goto(`${BASE}/listings?deal=rent&bhk=3plus&loc=balewadi`);

    await buyRadio(page).click();
    await expect.poll(() => urlOf(page).searchParams.get('deal'), { timeout: 15000 }).toBe('buy');

    expect(urlOf(page).searchParams.get('bhks')).toBe('3,4,5plus');
    expect(urlOf(page).searchParams.has('bhk')).toBe(false);
  });

  await test.step('Buy 5+ BHK falls back to Rent 4+ BHK', async () => {
    await page.goto(`${BASE}/listings?deal=buy&bhks=5plus&loc=balewadi`);

    await rentRadio(page).click();
    await expect.poll(() => urlOf(page).searchParams.get('deal'), { timeout: 15000 }).toBe('rent');

    expect(urlOf(page).searchParams.get('bhks')).toBe('4plus');
  });
});

test('an in-app Rent/Buy link preserves as much as the toggle does, but a link naming its own filters arrives clean', async ({ page }) => {
  test.slow();
  await test.step('an in-app Rent/Buy link preserves as much as the toggle does', async () => {
    /* Carrying filters over is right for a bare deal change, and wrong the moment the link narrows
       something itself: "Buy plots" must not quietly mean "buy plots in Balewadi with a gym". */
    await page.goto(`${BASE}/listings?deal=rent&loc=balewadi&amen=gym`);
    await expect(page.locator('p:has-text("Showing")').first()).toBeVisible();

    await page.evaluate(() => window.history.pushState({}, '', '/listings?deal=buy'));
    await page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')));

    await expect.poll(() => {
      const q = urlOf(page).searchParams;
      return `${q.get('deal')}|${q.get('loc')}|${q.get('amen')}`;
    }, { timeout: 15000 }).toBe('buy|balewadi|gym');
    const q = urlOf(page).searchParams;
    expect(q.get('loc')).toBe('balewadi');
    expect(q.get('amen')).toBe('gym');
  });

  await test.step('a link that names its own filters arrives clean, not carrying the previous search', async () => {
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
});
