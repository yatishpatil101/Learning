import { test, expect } from '@playwright/test';

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
  test('renders five slots on Home, pointing at the right routes, each a 44px target, with Post opening the shared sheet', async ({ page }) => {
    await page.goto('/');
    await expect(bar(page)).toBeVisible();

    await test.step('renders with all five slots on Home', async () => {
      for (const t of TABS) {
        await expect(bar(page).getByRole('link', { name: t.name })).toBeVisible();
      }
      await expect(bar(page).getByRole('button', { name: /post property/i })).toBeVisible();
    });

    await test.step('tabs point at the right routes', async () => {
      for (const t of TABS) {
        await expect(bar(page).getByRole('link', { name: t.name })).toHaveAttribute('href', t.href);
      }
    });

    await test.step('every tap target clears 44px', async () => {
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

    await test.step('Post opens the shared posting sheet instead of jumping straight to one form', async () => {
      // Guests choose a posting type before the selected flow applies its sign-in gate.
      await bar(page).getByRole('button', { name: /post property/i }).click();
      await expect(page.getByRole('dialog', { name: /What do you want to post/ })).toBeVisible();
      await expect(page).toHaveURL(/\/$/);
    });
  });

  test('the active tab is marked, the indicator follows it, and no route mounts a search sheet', async ({ page }) => {
    test.slow(); // four cold navigations while the dev server compiles routes for the other workers.
    const pill = page.locator('.dz-bottom-nav__indicator');
    const noSheet = async (route) => {
      await expect(page.locator('.dz-search-sheet'), `${route} should mount no search sheet`).toHaveCount(0);
    };

    await test.step('Home owns no slot, so nothing is current and the indicator stays hidden', async () => {
      await page.goto('/');
      for (const t of TABS) {
        await expect(bar(page).getByRole('link', { name: t.name })).not.toHaveAttribute('aria-current', 'page');
      }
      await expect(pill).toHaveCSS('opacity', '0');
      await noSheet('/');
    });

    await test.step('Search is current and the single indicator sits on it', async () => {
      await page.goto('/listings');
      await expect(bar(page).getByRole('link', { name: /^Search$/ })).toHaveAttribute('aria-current', 'page');
      await expect(bar(page).getByRole('link', { name: /^Flatmates$/ })).not.toHaveAttribute('aria-current', 'page');
      await expect(pill).toHaveCount(1);
      const search = await bar(page).getByRole('link', { name: /^Search$/ }).boundingBox();
      const box = await pill.boundingBox();
      expect(Math.abs(box.x - search.x), 'indicator sits on Search').toBeLessThan(4);
      await noSheet('/listings');
    });

    await test.step('the indicator travels to Services', async () => {
      await page.goto('/services');
      const services = await bar(page).getByRole('link', { name: /^Services$/ }).boundingBox();
      const box = await pill.boundingBox();
      expect(Math.abs(box.x - services.x), 'indicator sits on Services').toBeLessThan(4);
    });

    await test.step('Flatmates becomes current and Search is released', async () => {
      await page.goto('/flatmates');
      await expect(bar(page).getByRole('link', { name: /^Flatmates$/ })).toHaveAttribute('aria-current', 'page');
      await expect(bar(page).getByRole('link', { name: /^Search$/ })).not.toHaveAttribute('aria-current', 'page');
      await noSheet('/flatmates');
    });
  });

  test('Search navigates to the listings page from Home, not into a modal', async ({ page }) => {
    // Search always opens the listings surface so its controls remain consistent across routes.
    await page.goto('/');
    await expect(page.locator('.hero-search-wrap')).toBeHidden();

    await bar(page).getByRole('link', { name: /^Search$/ }).click();
    await expect(page).toHaveURL(/\/listings/);
    await expect(page.locator('.dz-search-sheet')).toHaveCount(0);

    // The Buy/Rent switch is a radiogroup, not a pair of buttons.
    await expect(page.getByRole('radio', { name: /^Buy$/ }).first()).toBeVisible();
    await expect(page.getByRole('radio', { name: /^Rent$/ }).first()).toBeVisible();
  });

  test('is absent on the routes that strip chrome', async ({ page }) => {
    for (const route of ['/signin', '/signup']) {
      await page.goto(route);
      await expect(bar(page), `${route} should have no bottom nav`).toHaveCount(0);
    }
  });

  test('Reels keeps the bar as one of its own tabs, runs media under it, and keeps its caption clear', async ({ page }) => {
    // Without the bar the user lands inside Reels with no route back to the other four.
    await page.goto('/reels');
    await expect(bar(page)).toBeVisible();
    await expect(bar(page).getByRole('link', { name: /^Reels$/ })).toHaveAttribute('aria-current', 'page');

    // Media deliberately passes *under* the floating capsule — reserving a strip drew a dead
    // band across every reel — so the claim is only that nothing readable or tappable is buried.
    const reel = page.locator('.reels-page .reel').first();
    await expect(reel).toBeVisible();

    const barBox = await bar(page).boundingBox();
    const reelBox = await reel.boundingBox();
    expect(reelBox.y + reelBox.height, 'the media must reach past the bar')
      .toBeGreaterThan(barBox.y);

    // The caption block spans to the screen edge by design (it is the media's scrim), so what has
    // to clear the bar is its last line, whose padding-bottom is sized off --dz-bottom-inset.
    const lastLine = await reel.locator('.reel-info p').last().boundingBox();
    expect(lastLine.y + lastLine.height, 'the caption text must end above the bar')
      .toBeLessThanOrEqual(barBox.y + 1);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollHeight - window.innerHeight,
    );
    expect(overflow, 'the page itself must not scroll').toBeLessThanOrEqual(1);
  });
});