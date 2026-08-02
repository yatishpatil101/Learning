import { test, expect } from '@playwright/test';

/* The mobile bottom tab bar — PuneNest's primary wayfinding surface on phones.

   The critical invariant is the last test: the bar must not exist at desktop widths.
   Everything else in this phase is additive, so a desktop regression could only come
   from the bar leaking past `lg`. */

/* The five slots, in DOM order. Post is the raised centre slot and is named by its
   aria-label rather than visible text, so it is asserted separately.

   Home is deliberately not a slot — the wordmark in the top bar already goes home,
   so a Home tab would spend one of five scarce slots on a destination nobody
   navigates *to* mid-session. See the rationale comment in BottomNav.jsx. */
const TABS = [
  { name: /^Reels$/, href: '/reels' },
  { name: /^Search$/, href: '/listings' },
  { name: /^Flatmates$/, href: '/flatmates' },
  { name: /^Services$/, href: '/services' },
];

const bar = (page) => page.locator('nav.pn-bottom-nav');

test.describe('Mobile bottom nav', () => {
  test('renders with all five slots on Home', async ({ page }) => {
    await page.goto('/');
    await expect(bar(page)).toBeVisible();
    for (const t of TABS) {
      await expect(bar(page).getByRole('link', { name: t.name })).toBeVisible();
    }
    // Post is the raised centre slot; it is labelled, not named by its text.
    await expect(bar(page).getByRole('link', { name: /post property/i })).toBeVisible();
  });

  test('tabs point at the right routes', async ({ page }) => {
    await page.goto('/');
    for (const t of TABS) {
      await expect(bar(page).getByRole('link', { name: t.name })).toHaveAttribute('href', t.href);
    }
  });

  test('the active tab is marked', async ({ page }) => {
    /* Three cold navigations in one test; on the 360x640 project that regularly
       runs past the 30s default while the dev server is compiling routes for the
       other workers. The assertions are cheap — it is the loads that are slow. */
    test.slow();
    // Home is not a slot, so nothing is current on `/`.
    await page.goto('/');
    for (const t of TABS) {
      await expect(bar(page).getByRole('link', { name: t.name })).not.toHaveAttribute('aria-current', 'page');
    }

    await page.goto('/listings');
    await expect(bar(page).getByRole('link', { name: /^Search$/ })).toHaveAttribute('aria-current', 'page');
    await expect(bar(page).getByRole('link', { name: /^Flatmates$/ })).not.toHaveAttribute('aria-current', 'page');

    await page.goto('/flatmates');
    await expect(bar(page).getByRole('link', { name: /^Flatmates$/ })).toHaveAttribute('aria-current', 'page');
    await expect(bar(page).getByRole('link', { name: /^Search$/ })).not.toHaveAttribute('aria-current', 'page');
  });

  test('the indicator follows the active tab', async ({ page }) => {
    // One indicator that travels, not five that cross-fade — so the assertion is that
    // there is exactly one, and that it lands on whichever slot is current.
    test.slow(); // three cold navigations, same reason as the test above.
    const pill = page.locator('.pn-bottom-nav__indicator');

    await page.goto('/listings');
    await expect(pill).toHaveCount(1);
    const search = await bar(page).getByRole('link', { name: /^Search$/ }).boundingBox();
    let box = await pill.boundingBox();
    expect(Math.abs(box.x - search.x), 'indicator sits on Search').toBeLessThan(4);

    await page.goto('/services');
    const services = await bar(page).getByRole('link', { name: /^Services$/ }).boundingBox();
    box = await pill.boundingBox();
    expect(Math.abs(box.x - services.x), 'indicator sits on Services').toBeLessThan(4);

    // Home owns no slot, so the indicator must not claim one.
    await page.goto('/');
    await expect(pill).toHaveCSS('opacity', '0');
  });

  test('every tap target clears 44px', async ({ page }) => {
    await page.goto('/');
    const links = bar(page).getByRole('link');
    const n = await links.count();
    expect(n).toBe(5);
    for (let i = 0; i < n; i++) {
      const box = await links.nth(i).boundingBox();
      expect(box.width, `tab ${i} width`).toBeGreaterThanOrEqual(44);
      expect(box.height, `tab ${i} height`).toBeGreaterThanOrEqual(44);
    }
  });

  test('Post routes signed-out users through sign-in instead of the route guard', async ({ page }) => {
    await page.goto('/');
    await expect(bar(page).getByRole('link', { name: /post property/i }))
      .toHaveAttribute('href', '/signin?next=/list-property');
  });

  test('Search navigates to the listings page from Home, not into a modal', async ({ page }) => {
    /* Search used to open a full-screen sheet on Home only. /listings already carries
       the same Buy/Rent tabs and query box above live results, so the sheet was an
       extra tap and a second copy of the same controls — and a tab that navigates on
       four routes but opens a modal on the fifth reads as unpredictable. */
    await page.goto('/');
    await expect(page.locator('.hero-search-wrap')).toBeHidden();

    await bar(page).getByRole('link', { name: /^Search$/ }).click();
    await expect(page).toHaveURL(/\/listings/);
    await expect(page.locator('.pn-search-sheet')).toHaveCount(0);

    /* The destination has to actually be searchable, or this is just a worse sheet.
       The Buy/Rent switch is a radiogroup, not a pair of buttons. */
    await expect(page.getByRole('radio', { name: /^Buy$/ }).first()).toBeVisible();
    await expect(page.getByRole('radio', { name: /^Rent$/ }).first()).toBeVisible();
  });

  test('the search sheet is gone from every route', async ({ page }) => {
    test.slow(); // three cold navigations.
    for (const route of ['/', '/listings', '/flatmates']) {
      await page.goto(route);
      await expect(page.locator('.pn-search-sheet'), `${route} should mount no search sheet`).toHaveCount(0);
    }
  });

  test('is absent on the routes that strip chrome', async ({ page }) => {
    for (const route of ['/signin', '/signup']) {
      await page.goto(route);
      await expect(bar(page), `${route} should have no bottom nav`).toHaveCount(0);
    }
  });

  test('survives on Reels, which is one of its own tabs', async ({ page }) => {
    // Reels is full-bleed in every other respect, but it is a tab destination: without
    // the bar the user lands inside it with no route back to the other four.
    await page.goto('/reels');
    await expect(bar(page)).toBeVisible();
    await expect(bar(page).getByRole('link', { name: /^Reels$/ })).toHaveAttribute('aria-current', 'page');
  });

  test('Reels reserves the bar instead of hiding under it', async ({ page }) => {
    // The reel is a snap target sized off the viewport. If it ignored the bar's inset
    // the page would grow past 100dvh and a second scroller would fight the snap.
    await page.goto('/reels');
    const reel = page.locator('.reels-page .reel').first();
    await expect(reel).toBeVisible();

    const barBox = await bar(page).boundingBox();
    const reelBox = await reel.boundingBox();
    expect(reelBox.y + reelBox.height, 'the reel must end above the bar')
      .toBeLessThanOrEqual(barBox.y + 1);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollHeight - window.innerHeight,
    );
    expect(overflow, 'the page itself must not scroll').toBeLessThanOrEqual(1);
  });

  test('is not rendered at desktop widths', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    // The element is mounted but lg:hidden — what matters is that it occupies no space.
    await expect(bar(page)).toBeHidden();
  });
});
