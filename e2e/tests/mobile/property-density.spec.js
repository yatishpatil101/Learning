import { test, expect } from '../../fixtures/live.js';

const APPROVED_SEED_LISTING = 'p5000';
const BUY_FLAT_WITH_SQFT_PRICE = 'p5013';
// The page carries a second tablist inside one of the panels, so `[role="tablist"]` alone is
// ambiguous. The section strip is the one made of `.dz-detail-tab` buttons.
const STRIP = '[role="tablist"]:has(.dz-detail-tab)';

async function gotoProp(page, slug = APPROVED_SEED_LISTING) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('dz_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() }));
    } catch {}
  });
  await page.goto(`/property/${slug}`);
  await page.locator(STRIP).waitFor({ timeout: 15000 });
}

test.describe('Property detail — phone density', () => {
  test('the property page reads as a dense, truthful phone layout', async ({ page }) => {
    test.slow();
    await gotoProp(page);

    await test.step('the header opens with truthful decision facts, not fabricated counters', async () => {
      const vh = page.viewportSize().height;

      await expect(page.locator('[data-testid="property-price"]')).toBeVisible();
      const title = await page.locator('h1').first().boundingBox();
      expect(title.y + 24, `the title starts at ${Math.round(title.y)} and must be inside the ${vh}px fold`).toBeLessThan(vh);

      const stats = page.locator('.dz-stat-social');
      await expect(stats.getByText('Views')).toBeVisible();
      await expect(stats.getByText('Enquiries')).toBeVisible();
      await expect(page.getByText('Shortlisted', { exact: true })).toHaveCount(0);
      await expect(page.getByText(/viewing now|enquiries this week|visits scheduled/i)).toHaveCount(0);
    });

    await test.step('the stat block reads as a ledger, not a grid of tiles', async () => {
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

    // The claim earns its place in the always-visible strip only if it is there *instead of*, not as well as.
    await test.step('zero brokerage is stated once, in the trust strip', async () => {
      await expect(page.getByText('Zero brokerage — deal direct', { exact: true })).toHaveCount(1);
      await expect(page.locator('.tag-strip').getByText('Zero brokerage — deal direct')).toBeVisible();
    });

    // Mobile already has navbar back; a second pill wastes a row above the fold.
    await test.step('up-navigation is offered once, by the navbar tile', async () => {
      await expect(page.getByRole('button', { name: 'Go back' }), 'the navbar back tile is the one that stays below lg').toBeVisible();
      await expect(page.locator('.dz-property').getByRole('button', { name: /back to (results|map)/i })).toHaveCount(0);
    });

    // An EMI from an assumed rate belongs beside the inputs that produced it, and nobody compares rentals by the foot.
    await test.step('the price block carries only figures the buyer acts on', async () => {
      await gotoProp(page, BUY_FLAT_WITH_SQFT_PRICE);
      await expect(page.getByText('EMI starts at')).toHaveCount(0);
      await expect(page.getByText('Est. EMI')).toHaveCount(0);
      await expect(page.locator('.dz-stat-facts').getByText('Price / sq.ft'), 'a buyer does compare by the foot').toBeVisible();

      await gotoProp(page);
      await expect(page.getByText('Rent / sq.ft')).toHaveCount(0);
      await expect(page.locator('.dz-stat-facts').getByText('Deposit')).toHaveCount(0);
    });

    await test.step('the collapsible trust tiles close to a single row', async () => {
      // Bound both sides: too tall wastes space, too short breaks the 44px toggle.
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

    await test.step('the tab strip scrolls horizontally only', async () => {
      const strip = page.locator(STRIP);

      const m = await strip.evaluate((el) => ({
        coarse: matchMedia('(pointer: coarse)').matches,
        overflows: el.scrollWidth > el.clientWidth,
        overflowY: getComputedStyle(el).overflowY,
      }));
      expect(m.coarse, 'the mobile projects must emulate a coarse pointer, or the rule under test never applies').toBe(true);
      expect(m.overflows, 'the strip must still overflow horizontally, or the axis lock proves nothing').toBe(true);
      // Do not use scrollHeight; hidden overflow still reports the overflow region.
      expect(m.overflowY, 'the strip must not be draggable on its cross axis').toBe('hidden');

      // Locking the axis must not swallow the gesture: the page still scrolls when
      // the pointer is over the strip. `touch-action: pan-x` would have failed this.
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      const box = await strip.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, 400);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    });
  });
});
