import { test, expect } from '../../fixtures/live.js';

/* Two claims no desktop project can see: the tab strip must scroll on one axis only (`overflow-x: auto` forces
   `overflow-y: auto`), and the header must lead with decision facts, reordered by CSS so selectors survive. */

const PROP = 'p5000'; // approved seed listing; lower-case — the server matches the slug exactly.
const SALE_FLAT = 'p5013'; // 1 BHK Flat, Baner — a buy, so the ₹/sq.ft tile is the one that renders.
// The page carries a second tablist inside one of the panels, so `[role="tablist"]` alone is
// ambiguous. The section strip is the one made of `.dz-detail-tab` buttons.
const STRIP = '[role="tablist"]:has(.dz-detail-tab)';

async function gotoProp(page, slug = PROP) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('dz_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() }));
    } catch { /* storage unavailable — the cookie bar just stays up */ }
  });
  await page.goto(`/property/${slug}`);
  await page.locator(STRIP).waitFor({ timeout: 15000 });
}

test.describe('Property detail — phone density', () => {
  test('the tab strip scrolls horizontally only', async ({ page }) => {
    await gotoProp(page);
    const strip = page.locator(STRIP);

    const m = await strip.evaluate((el) => ({
      coarse: matchMedia('(pointer: coarse)').matches,
      overflows: el.scrollWidth > el.clientWidth,
      overflowY: getComputedStyle(el).overflowY,
    }));
    expect(m.coarse, 'the mobile projects must emulate a coarse pointer, or the rule under test never applies').toBe(true);
    expect(m.overflows, 'the strip must still overflow horizontally, or the axis lock proves nothing').toBe(true);
    /* Not `scrollHeight - clientHeight`: an `overflow: hidden` box still reports its overflow region, so
       that stays non-zero either way. What the rule changes is draggability, which `overflowY` reports. */
    expect(m.overflowY, 'the strip must not be draggable on its cross axis').toBe('hidden');

    // Locking the axis must not swallow the gesture: the page still scrolls when
    // the pointer is over the strip. `touch-action: pan-x` would have failed this.
    const box = await strip.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 400);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });

  test('the header opens with decision facts and defers social proof', async ({ page }) => {
    await gotoProp(page);
    const vh = page.viewportSize().height;

    await expect(page.locator('[data-testid="property-price"]')).toBeVisible();
    const title = await page.locator('h1').first().boundingBox();
    expect(title.y + 24, `the title starts at ${Math.round(title.y)} and must be inside the ${vh}px fold`).toBeLessThan(vh);

    /* Against a neighbour rather than the viewport: the counter's absolute y depends on how tall the hero
       renders for this listing's photo count, so a seed change would read as an ordering regression. */
    const counter = await page.getByText('Shortlisted', { exact: true }).first().boundingBox();
    const assured = await page.getByText('Draazy Assured', { exact: true }).first().boundingBox();
    expect(counter.y, 'the shortlist counter is social proof and belongs below the Assured panel').toBeGreaterThan(assured.y);
  });

  test('the stat block reads as a ledger, not a grid of tiles', async ({ page }) => {
    await gotoProp(page);
    const rows = page.locator('.dz-stat-facts > *, .dz-stat-social > *');

    const shape = await rows.evaluateAll((els) => els
      .filter((el) => el.offsetParent !== null)
      .map((el) => {
        const s = getComputedStyle(el);
        const kids = [...el.children];
        return {
          boxed: s.borderTopWidth !== '0px' || s.backgroundColor !== 'rgba(0, 0, 0, 0)',
          oneLine: kids.length === 2 && Math.abs(kids[0].getBoundingClientRect().top - kids[1].getBoundingClientRect().top) < 12,
        };
      }));

    expect(shape.length, 'at least three stat rows should be on screen').toBeGreaterThanOrEqual(3);
    expect(shape.every((r) => !r.boxed), 'no stat row may keep its own tile surface on a phone').toBe(true);
    expect(shape.every((r) => r.oneLine), 'label and value share one line').toBe(true);
  });

  /* An EMI from an assumed rate belongs beside the inputs that produced it, and nobody compares rentals by
     the foot. Both deal types, because each rule is one-sided and a rent-only run cannot see an EMI line. */
  test('the price block carries only figures the buyer acts on', async ({ page }) => {
    await gotoProp(page, SALE_FLAT);
    await expect(page.getByText('EMI starts at')).toHaveCount(0);
    await expect(page.getByText('Est. EMI')).toHaveCount(0);
    await expect(page.locator('.dz-stat-facts').getByText('Price / sq.ft'), 'a buyer does compare by the foot').toBeVisible();

    await gotoProp(page);
    await expect(page.getByText('Rent / sq.ft')).toHaveCount(0);
    await expect(page.locator('.dz-stat-facts').getByText('Deposit')).toBeVisible();
  });

  /* The claim earns its place in the always-visible strip only if it is there *instead of*, not as well as.
     Counted across the whole page rather than asserted present, because presence is satisfied by both copies. */
  test('zero brokerage is stated once, in the trust strip', async ({ page }) => {
    await gotoProp(page);
    await expect(page.getByText('Zero brokerage — deal direct', { exact: true })).toHaveCount(1);
    await expect(page.locator('.tag-strip').getByText('Zero brokerage — deal direct')).toBeVisible();
  });

  /* Below `lg` the navbar already carries a back tile, so a second in-page pill is two controls for one job
     costing a row above the fold. The survivor is asserted first: on a blank page the absence alone passes. */
  test('up-navigation is offered once, by the navbar tile', async ({ page }) => {
    await gotoProp(page);
    await expect(page.getByRole('button', { name: 'Go back' }), 'the navbar back tile is the one that stays below lg').toBeVisible();
    await expect(page.locator('.dz-property').getByRole('button', { name: /back to (results|map)/i })).toHaveCount(0);
  });

  /* Bounded on both sides: too tall is the dead-space regression this guards, too short means the 44px
     toggle stopped fitting. */
  test('the collapsible trust tiles close to a single row', async ({ page }) => {
    await gotoProp(page);
    const tile = (heading) => page.getByText(heading, { exact: true }).first();
    const heightOf = (heading) => tile(heading).evaluate((el) => el.closest('.rounded-2xl').getBoundingClientRect().height);

    for (const heading of ['Draazy Assured', 'Sharing this flat?']) {
      await expect(tile(heading), `${heading} must be on screen, or its height proves nothing`).toBeVisible();
      const h = await heightOf(heading);
      expect(h, `${heading} collapsed to ${Math.round(h)}px`).toBeLessThan(68);
      expect(h, `${heading} collapsed to ${Math.round(h)}px, under a 44px row plus its padding`).toBeGreaterThan(48);
    }

    // Asserted on a claim the panel alone makes: the zero-brokerage one sits in the tag strip, so matching
    // on it would pass against an element outside this panel entirely.
    await page.getByRole('button', { name: 'Draazy Assured' }).click();
    await expect(page.getByText('Number protected — no spam calls', { exact: true })).toBeVisible();
    expect(await heightOf('Draazy Assured')).toBeGreaterThan(120);
  });
});
