import { test, expect } from '@playwright/test';

/* --pn-bottom-inset is the linchpin of the mobile bottom-chrome system: every
   bottom-anchored widget positions from it instead of a hardcoded `bottom-*`.
   These tests assert the thing that actually matters — nothing overlaps the bar.

   Note: computed custom properties come back as un-evaluated calc() strings, so
   every assertion here measures real geometry rather than reading the variable.
   The desktop half of this contract lives in desktop-mobile-guardrails.spec.js. */

/* The consent bar hides the collapsed assistant FAB below sm (they would overlap),
   so pre-seed a choice on any test that needs the FAB. */
/* Two things fight a naive scrollTo here: Home keeps growing as lazy sections load,
   and the app enables smooth scrolling, so each call only animates partway. Loop
   until the document height has settled AND we are genuinely at the end. */
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
      'pn_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() })
    );
  });
}

test.describe('Bottom-chrome inset system', () => {
  test('the layout reserves the bar plus the gap it floats above the edge', async ({ page }) => {
    await page.goto('/');
    const wrapper = page.locator('.has-bottom-nav');
    await expect(wrapper).toHaveCount(1);
    const pad = await wrapper.evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
    const navBox = await page.locator('nav.pn-bottom-nav').boundingBox();
    const viewportH = page.viewportSize().height;

    expect(navBox.height, 'the bar is still one --pn-bottom-nav-h tall').toBe(56);
    /* The bar floats, so reserving only its height would leave the last card sitting in
       the gap underneath it. The reservation that actually matters is the distance from
       the bar's top edge to the bottom of the viewport — assert that rather than a
       literal, so the float gap can be retuned without editing this test. */
    expect(pad).toBeCloseTo(viewportH - navBox.y, 0);
  });

  test('the end of the page is not trapped behind the bar', async ({ page }) => {
    await page.goto('/');
    await scrollToSettledBottom(page);
    const clear = await page.evaluate(() => {
      const footer = document.querySelector('.has-bottom-nav > footer');
      const nav = document.querySelector('nav.pn-bottom-nav');
      return nav.getBoundingClientRect().top - footer.getBoundingClientRect().bottom;
    });
    // Sub-pixel tolerance: the reservation is derived from the bar's height and float
    // gap, but fractional layout rounding can leave them ~0.2px apart. Anything beyond
    // a pixel would be a genuine overlap and still fails here.
    expect(clear).toBeGreaterThan(-1);
  });

  test('the assistant FAB sits above the bar, not behind it', async ({ page }) => {
    await withConsent(page);
    await page.goto('/');
    const fab = page.locator('.pn-assistant-slot > div');
    const nav = page.locator('nav.pn-bottom-nav');
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
    const navBox = await page.locator('nav.pn-bottom-nav').boundingBox();
    expect(cBox.y + cBox.height).toBeLessThanOrEqual(navBox.y + 1);
  });
});
