import { test, expect } from '@playwright/test';

/* The mobile bottom tab bar. The critical invariant is the last test: the bar must not exist at
   desktop widths, since everything else here is additive. */

/* The four link slots, in DOM order; Post is the raised centre slot, asserted separately by its
   aria-label. Home is deliberately not a slot — the wordmark already goes home. */
const TABS = [
  { name: /^Reels$/, href: '/reels' },
  { name: /^Search$/, href: '/listings' },
  { name: /^Flatmates$/, href: '/flatmates' },
  { name: /^Services$/, href: '/services' },
];

const bar = (page) => page.locator('nav.dz-bottom-nav');

test.describe('Mobile bottom nav', () => {
  test('renders with all five slots on Home', async ({ page }) => {
    await page.goto('/');
    await expect(bar(page)).toBeVisible();
    for (const t of TABS) {
      await expect(bar(page).getByRole('link', { name: t.name })).toBeVisible();
    }
    // Post is the raised centre slot; it is labelled, not named by its text, and it opens the
    // app-wide posting sheet rather than navigating — see the dedicated test below.
    await expect(bar(page).getByRole('button', { name: /post property/i })).toBeVisible();
  });

  test('tabs point at the right routes', async ({ page }) => {
    await page.goto('/');
    for (const t of TABS) {
      await expect(bar(page).getByRole('link', { name: t.name })).toHaveAttribute('href', t.href);
    }
  });

  test('the active tab is marked', async ({ page }) => {
    /* Three cold navigations; on the 360x640 project that runs past the 30s default while the dev
       server compiles routes for the other workers. */
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
    const pill = page.locator('.dz-bottom-nav__indicator');

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
    // Four links plus the centre Post button, which is a button because it opens a sheet.
    const slots = bar(page).getByRole('link').or(bar(page).getByRole('button'));
    const n = await slots.count();
    expect(n).toBe(5);
    for (let i = 0; i < n; i++) {
      const box = await slots.nth(i).boundingBox();
      expect(box.width, `tab ${i} width`).toBeGreaterThanOrEqual(44);
      expect(box.height, `tab ${i} height`).toBeGreaterThanOrEqual(44);
    }
  });

  test('Post opens the shared posting sheet instead of jumping straight to one form', async ({ page }) => {
    // Guests choose a posting type before the selected flow applies its sign-in gate.
    await page.goto('/');
    await bar(page).getByRole('button', { name: /post property/i }).click();

    await expect(page.getByRole('dialog', { name: /What do you want to post/ })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test('Search navigates to the listings page from Home, not into a modal', async ({ page }) => {
    // Search always opens the listings surface so its controls remain consistent across routes.
    await page.goto('/');
    await expect(page.locator('.hero-search-wrap')).toBeHidden();

    await bar(page).getByRole('link', { name: /^Search$/ }).click();
    await expect(page).toHaveURL(/\/listings/);
    await expect(page.locator('.dz-search-sheet')).toHaveCount(0);

    /* The destination has to actually be searchable, or this is just a worse sheet.
       The Buy/Rent switch is a radiogroup, not a pair of buttons. */
    await expect(page.getByRole('radio', { name: /^Buy$/ }).first()).toBeVisible();
    await expect(page.getByRole('radio', { name: /^Rent$/ }).first()).toBeVisible();
  });

  test('the search sheet is gone from every route', async ({ page }) => {
    test.slow(); // three cold navigations.
    for (const route of ['/', '/listings', '/flatmates']) {
      await page.goto(route);
      await expect(page.locator('.dz-search-sheet'), `${route} should mount no search sheet`).toHaveCount(0);
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

  test('Reels runs its media under the bar but keeps its caption clear of it', async ({ page }) => {
    // Reels media deliberately passes *under* the floating capsule — reserving a strip drew a dead
    // band across every reel — so the claim is only that nothing readable or tappable is buried.
    await page.goto('/reels');
    const reel = page.locator('.reels-page .reel').first();
    await expect(reel).toBeVisible();

    const barBox = await bar(page).boundingBox();
    const reelBox = await reel.boundingBox();
    expect(reelBox.y + reelBox.height, 'the media must reach past the bar')
      .toBeGreaterThan(barBox.y);

    // The caption block spans to the screen edge by design (it is the media's scrim), so what has
    // to clear the bar is its last line, whose padding-bottom is sized off --dz-bottom-inset.
    const lastLine = await page.locator('.reels-page .reel').first()
      .locator('.reel-info p').last().boundingBox();
    expect(lastLine.y + lastLine.height, 'the caption text must end above the bar')
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
