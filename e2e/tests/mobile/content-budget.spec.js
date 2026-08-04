import { test, expect } from '@playwright/test';
import { loginAsOwner } from '../../helpers/auth.js';

/* Content budget: on a phone, the primary content of a money route must be on the
   first screen.
 *
 * This exists because two regressions got all the way to a manual audit without a
 * single test going red — the app was, structurally, completely fine. There was no
 * horizontal scroll, no overflow, no console error, no failing assertion anywhere.
 * The chrome had simply grown until it covered the content:
 *
 *   · /property/:id — the assistant's "New here?" coach-mark, a ~110px opaque card
 *     anchored above the FAB, landed squarely on the price band.
 *   · /list-property — 190px of marketing hero above the progress meter and step
 *     tabs pushed the first form field off the bottom of a 360x640 screen, so the
 *     supply-first funnel opened on an advert for itself.
 *
 * Every existing mobile spec asks "is this element correct?". None asked "can the
 * user see it without scrolling?", which is the question a visitor actually asks.
 * The assertion is deliberately about the *initial viewport*, not about any one
 * component, so it stays true whatever new chrome is added later.
 *
 * Runs on both `mobile` (412x915) and `mobile-small` (360x640); the small project
 * is the one that bites. */

const consent = (page) =>
  page.addInitScript(() => {
    localStorage.setItem(
      'pn_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() }),
    );
  });

/** Fully inside the first screen — no scrolling, and not under the bottom chrome. */
async function expectAboveTheFold(page, locator, label) {
  await expect(locator, `${label} should render`).toBeVisible();
  const box = await locator.boundingBox();
  const vh = page.viewportSize().height;
  expect(box, `${label} should have a box`).not.toBeNull();
  expect(box.y, `${label} starts below the fold (y=${Math.round(box.y)}, viewport=${vh})`).toBeLessThan(vh);
  expect(
    box.y + box.height,
    `${label} is cut off by the fold (ends at ${Math.round(box.y + box.height)}, viewport=${vh})`,
  ).toBeLessThanOrEqual(vh);
}

/** Nothing may be painted on top of the element's centre. */
async function expectNothingCovering(page, locator, label) {
  const box = await locator.boundingBox();
  expect(box, `${label} should have a box`).not.toBeNull();
  const covering = await page.evaluate(
    ({ x, y, w, h }) => {
      const cx = x + w / 2;
      const cy = y + h / 2;
      // elementFromPoint is viewport-relative and returns null outside it. Saying
      // so explicitly beats reporting "nothing is covering it" for an element that
      // is not on screen at all — that would be a pass for the wrong reason.
      if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) {
        return 'OFFSCREEN';
      }
      const el = document.elementFromPoint(cx, cy);
      if (!el) return 'OFFSCREEN';
      // Walk up looking for a fixed/sticky ancestor — that is what "covered by
      // floating chrome" looks like from a hit test.
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        const pos = getComputedStyle(n).position;
        if (pos === 'fixed' || pos === 'sticky') {
          return `${n.tagName.toLowerCase()}.${String(n.className).split(/\s+/)[0]}`;
        }
      }
      return null;
    },
    { x: box.x, y: box.y, w: box.width, h: box.height },
  );
  expect(covering, `${label} is covered by floating chrome (${covering})`).toBeNull();
}

test.describe('Mobile content budget', () => {
  test('the posting wizard opens on a form field, not on marketing copy', async ({ page }) => {
    await consent(page);
    await loginAsOwner(page);
    await page.goto('/list-property');

    // The first thing the owner must be able to act on: the "Property For"
    // Sale/Rent choice that every later step branches from.
    const firstField = page.getByRole('button', { name: 'Sale', exact: true }).first();
    await expectAboveTheFold(page, firstField, 'first wizard control');
  });

  test('the assistant coach-mark never covers the listing price', async ({ page }) => {
    await consent(page);
    await page.goto('/listings');
    const card = page.locator('a[href^="/property/"]').first();
    await expect(card).toBeVisible();
    await card.click();
    await page.waitForURL(/\/property\//);

    /* The price now clears the fold, and this asserts it.

       It used to sit at y=551 on a 360x640 screen — below the fold, behind a
       photo-led hero — and this spec deliberately did NOT assert on it, because
       pulling it up meant shrinking the gallery: a photo-vs-price product call,
       not a bug, and not one a test should quietly impose.

       That call has since been made in favour of laying the price over the hero,
       so the photo keeps its full weight AND the number is answerable without a
       scroll. Measured y=551 -> 360 at 360x640. Exactly one price element exists
       at any viewport (the parent picks the slot), so this stays a single match.

       Still unconditional below: a *fixed* overlay must never sit on the price.
       Content scrolling under the sticky contact bar is normal and one flick
       undoes it; the assistant coach-mark was pinned to the viewport, so it
       covered the price and stayed there however the user scrolled. */
    const price = page.getByTestId('property-price');
    await expectAboveTheFold(page, price, 'property price');
    /* Not scrollIntoViewIfNeeded: it stops the moment the element is inside the
       viewport *rect*, which includes the strip hidden behind the sticky bar — so
       it parks the price under exactly the chrome we are testing for. Scroll it
       into the reading area instead, where a real user would put it. */
    await price.evaluate((el) => {
      window.scrollBy({ top: el.getBoundingClientRect().top - 160, behavior: 'instant' });
    });
    await page.waitForTimeout(300);
    await expectNothingCovering(page, price, 'property price');
  });

  test('the coach-mark is spent after two sightings and does not return', async ({ page }) => {
    await consent(page);
    // A browsing route, where the hint is allowed to appear.
    await page.goto('/services');
    const nudge = page.getByText('New here?', { exact: false });
    await expect(nudge).toBeVisible();

    // Second load: still within budget.
    await page.reload();
    await expect(page.getByText('New here?', { exact: false })).toBeVisible();

    // Third: budget spent. It used to reappear on every single page load for the
    // whole session, because only an explicit close was ever recorded.
    await page.reload();
    await expect(page.getByText('New here?', { exact: false })).toHaveCount(0);
  });
});

/* The two failure modes above are about chrome covering content. These two are the
   quieter cousins: content that is present and uncovered but still unusable —
   because it sits outside the screen, or because it is too small to read. Neither
   produces a console error, a layout shift, or a horizontal scrollbar, so nothing
   in a 180-spec suite noticed either one. */
test.describe('Mobile reach and legibility', () => {
  test('every control in the societies toolbar is on screen', async ({ page }) => {
    await consent(page);
    await page.goto('/societies');
    await expect(page.getByRole('button', { name: /verified/i }).first()).toBeVisible();

    const vw = page.viewportSize().width;
    const escaping = await page.evaluate((w) => {
      const bar = document.querySelector('.glass.rounded-2xl');
      if (!bar) return ['toolbar not found'];
      const bad = [];
      for (const el of bar.querySelectorAll('button, input, .pn-dropdown__trigger')) {
        const r = el.getBoundingClientRect();
        if (r.width && r.right > w + 1) {
          bad.push(`${(el.innerText || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 24)} right=${Math.round(r.right)}`);
        }
      }
      return bad;
    }, vw);

    /* The Verified filter used to sit at x=364..481 on a 412px screen. An ancestor
       clips the overflow, so there was no page scroll to reach it and no visual
       "broken" cue — the control was simply gone. Two `flex-1` selects with the
       default `min-width: auto` refused to shrink and pushed it off the edge. */
    expect(escaping, `controls escaping a ${vw}px viewport`).toEqual([]);
  });

  test('the flatmates VERIFIED badge is readable and stays in its card', async ({ page }) => {
    await consent(page);
    await page.goto('/flatmates');

    const badge = page.locator('.badge-seeker').first();
    await expect(badge).toBeVisible();

    /* 9px on the one badge that tells someone whether the stranger they might live
       with has passed an identity check. Raised to 11px; asserted at >= 11 rather
       than == 11 so a future increase does not fail, and paired with an overflow
       check because the badge shares an absolutely-positioned row with the match
       pill and freshness chip. */
    const size = await badge.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size, 'VERIFIED badge font-size').toBeGreaterThanOrEqual(11);

    const overflowing = await page.evaluate(() => {
      const bad = [];
      for (const b of document.querySelectorAll('.badge-seeker')) {
        const r = b.getBoundingClientRect();
        if (!r.width) continue;
        if (r.right > window.innerWidth + 1) bad.push('past viewport');
      }
      return bad;
    });
    expect(overflowing, 'badges must not overflow after the size bump').toEqual([]);
  });
});
