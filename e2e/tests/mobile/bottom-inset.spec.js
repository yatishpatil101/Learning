import { test, expect } from '@playwright/test';

/* Computed custom properties come back as unevaluated calc(), so assertions measure real geometry. */

/* The consent bar hides the collapsed assistant FAB below sm (they would overlap),
   so pre-seed a choice on any test that needs the FAB. */
/* Lazy sections keep growing Home and smooth scroll animates partway: loop until height settles at the end. */
async function scrollToSettledBottom(page) {
  let stable = 0;
  for (let i = 0; i < 60 && stable < 3; i++) {
    const before = await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
      return document.documentElement.scrollHeight;
    });
    await page.waitForTimeout(100);
    const atEnd = await page.evaluate(
      (h) =>
        document.documentElement.scrollHeight === h &&
        Math.ceil(window.scrollY) >= h - window.innerHeight - 1,
      before
    );
    stable = atEnd ? stable + 1 : 0;
  }
}

async function withConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'dz_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() })
    );
  });
}

test.describe('Bottom-chrome inset system', () => {
  test('the layout reserves the bar plus the gap it floats above the edge', async ({ page }) => {
    /* Consent is seeded because an un-dismissed consent bar adds its own band to the wrapper's
       reservation, so this equality would be measuring two reservations at once. */
    await withConsent(page);
    await page.goto('/');
    const wrapper = page.locator('.has-bottom-nav');
    await expect(wrapper).toHaveCount(1);
    const pad = await wrapper.evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
    const navBox = await page.locator('nav.dz-bottom-nav').boundingBox();
    const viewportH = page.viewportSize().height;

    expect(navBox.height, 'the bar is still one --dz-bottom-nav-h tall').toBe(56);
    /* The bar floats, so the reservation is the distance from its top edge to the viewport bottom;
       assert that rather than a literal so the float gap can be retuned freely. */
    expect(pad).toBeCloseTo(viewportH - navBox.y, 0);
  });

  test('the end of the page is not trapped behind the bar', async ({ page }) => {
    await page.goto('/');
    await scrollToSettledBottom(page);
    const clear = await page.evaluate(() => {
      const footer = document.querySelector('.has-bottom-nav > footer');
      const nav = document.querySelector('nav.dz-bottom-nav');
      return nav.getBoundingClientRect().top - footer.getBoundingClientRect().bottom;
    });
    // Sub-pixel tolerance: fractional layout rounding can leave bar height and float gap ~0.2px apart.
    expect(clear).toBeGreaterThan(-1);
  });

  test('the assistant FAB sits above the bar, not behind it', async ({ page }) => {
    await withConsent(page);
    await page.goto('/');
    const fab = page.locator('.dz-assistant-slot > div');
    const nav = page.locator('nav.dz-bottom-nav');
    await expect(fab).toBeVisible();
    const [fabBox, navBox] = [await fab.boundingBox(), await nav.boundingBox()];
    expect(fabBox.y + fabBox.height, 'FAB bottom edge must clear the nav top edge')
      .toBeLessThanOrEqual(navBox.y);
  });

  test('the cookie bar sits above the bar rather than under it', async ({ page }) => {
    await page.goto('/');
    const consent = page.getByRole('dialog', { name: /cookie preferences/i });
    await expect(consent).toBeVisible();
    const cBox = await consent.boundingBox();
    const navBox = await page.locator('nav.dz-bottom-nav').boundingBox();
    expect(cBox.y + cBox.height).toBeLessThanOrEqual(navBox.y + 1);
  });
});
