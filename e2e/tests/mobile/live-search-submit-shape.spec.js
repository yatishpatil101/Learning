import { test, expect } from '../../fixtures/live.js';

/* Both search bars end in a 36px circle floating 4px inside the pill; its finger-sized region is a
 * transparent 44px `.tap-extend::before`, invisible to `boundingBox()` and so measured directly. */

const consent = (page) =>
  page.addInitScript(() => {
    localStorage.setItem(
      'dz_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() }),
    );
  });

/* `field` is declared per page rather than walked to from the button: the two are not built the same
   way, and a Tailwind class is not a contract to anchor an ancestor query on. */
const PAGES = [
  { name: 'listings', route: '/listings?deal=buy', submit: '.lst-search-go', field: '.lst-search-field' },
  { name: 'flatmates', route: '/flatmates', submit: '.sf-search-go', field: '.sf-search-field' },
];

for (const { name, route, submit, field } of PAGES) {
  test.describe(`Smart-search submit on ${name}`, () => {
    test('is a circle floating inside a pill, inset off the bar rather than sized by hand', async ({ page }) => {
      await consent(page);
      await page.goto(route);

      const go = page.locator(submit);
      await expect(go).toBeVisible();

      const m = await go.evaluate((el, sel) => {
        const input = document.querySelector(sel);
        const b = el.getBoundingClientRect();
        const i = input.getBoundingClientRect();
        return {
          barRadius: parseFloat(getComputedStyle(input).borderRadius),
          barH: i.height,
          w: b.width,
          h: b.height,
          radius: parseFloat(getComputedStyle(el).borderRadius),
          insetTop: b.top - i.top,
          insetBottom: i.bottom - b.bottom,
          insetRight: i.right - b.right,
          /* An inline transform outranks every pseudo-class rule, so it would silence the app-wide
             `button:active { transform: scale(.97) }` and leave the control with no press feedback. */
          inlineStyle: el.getAttribute('style'),
        };
      }, field);

      /* Measured, not string-matched: `rounded-full` computes to 9999px but `50%`
         renders identically, and either is a pill/circle. The claim is the shape. */
      expect(m.barRadius, 'search field is a pill').toBeGreaterThanOrEqual(m.barH / 2);
      expect(m.radius, 'submit is a circle').toBeGreaterThanOrEqual(m.h / 2);
      expect(Math.round(m.w), 'submit is square').toBe(Math.round(m.h));

      // Floating, not capping: the same gap on all three free edges.
      expect(Math.round(m.insetTop), 'inset above').toBe(4);
      expect(Math.round(m.insetBottom), 'inset below').toBe(4);
      expect(Math.round(m.insetRight), 'inset right').toBe(4);

      // ...and the diameter stays tied to the bar it sits in, which survives someone changing
      // `h-11`; the JSX has a literal 36 in it.
      expect(Math.round(m.w), 'diameter follows the bar height').toBe(Math.round(m.barH) - 8);

      expect(m.inlineStyle, 'no inline style — it would outrank :active').toBeNull();
    });

    test('keeps a 44px tap target under the smaller circle, and it accepts the tap', async ({ page }) => {
      await consent(page);
      await page.goto(route);

      const go = page.locator(submit);
      await expect(go).toBeVisible();

      const pseudo = await go.evaluate((el) => {
        const s = getComputedStyle(el, '::before');
        return {
          w: parseFloat(s.width),
          h: parseFloat(s.height),
          content: s.content,
          pointerEvents: s.pointerEvents,
          background: s.backgroundColor,
        };
      });

      expect(pseudo.content, 'the extension is rendered').not.toBe('none');
      expect(pseudo.w, 'tap-extend width').toBeGreaterThanOrEqual(44);
      expect(pseudo.h, 'tap-extend height').toBeGreaterThanOrEqual(44);
      expect(pseudo.pointerEvents, 'a decorative pseudo catches nothing').not.toBe('none');
      // It is 8px wider than the circle it sits under. If it ever paints, it paints a
      // square over the pill's curved end — every other assertion here would still pass.
      expect(pseudo.background, 'the extension is invisible').toBe('rgba(0, 0, 0, 0)');

      /* `elementsFromPoint`, plural, is the weaker claim on purpose: it says the extension occupies
         the point, not that a tap lands on it — the assistant nudge overlays this deck at 360px. */
      const hits = await go.evaluate((el, sel) => {
        const b = el.getBoundingClientRect();
        const owner = (x, y) => document.elementsFromPoint(x, y).some((n) => n.closest(sel) === el);
        return {
          topLeft: owner(b.left - 3, b.top - 3),
          bottomRight: owner(b.right + 3, b.bottom + 3),
          centre: owner(b.left + b.width / 2, b.top + b.height / 2),
        };
      }, submit);

      expect(hits.centre, 'the circle itself').toBe(true);
      expect(hits.topLeft, 'extended top-left corner').toBe(true);
      expect(hits.bottomRight, 'extended bottom-right corner').toBe(true);
    });

    /* The only test that would fail if `onClick` were dropped, and the only one proving the
       extension is a real target. Offset horizontally by 2px: hover lifts the button 1px and
       `:active` scales it 0.97, so a diagonal 3px point sits outside the extension once hovered. */
    test('a tap outside the drawn circle still reaches the handler', async ({ page }) => {
      await consent(page);
      await page.goto(route);

      const go = page.locator(submit);
      await expect(go).toBeVisible();
      await go.scrollIntoViewIfNeeded();

      // Both handlers return early on an empty query, so give them something to parse.
      await page.locator(field).fill('2 bhk');

      const b = await go.boundingBox();
      await page.mouse.click(b.x - 2, b.y + b.height / 2);

      await expect(page.getByRole('alert').first()).toBeVisible();
    });

    /* The assistant's `fixed right-4 z-[1300]` layer reaches the submit on a 360px phone and ate the
       tap. Asserted on the layer rather than via a click, because the nudge clears itself after 6s. */
    test('the assistant layer above it is inert, but its own controls are not', async ({ page }) => {
      await consent(page);
      await page.goto(route);
      await expect(page.locator(submit)).toBeVisible();

      const fab = page.getByRole('button', { name: /^Open Draaz\b/ });
      await expect(fab).toBeAttached();

      const pe = await fab.evaluate((el) => ({
        layer: getComputedStyle(el.closest('.dz-assistant-layer')).pointerEvents,
        fab: getComputedStyle(el).pointerEvents,
      }));
      expect(pe.layer).toBe('none');
      expect(pe.fab).toBe('auto');

      // Inert is only half of it — the FAB must still open, or this "fix" is a regression.
      await fab.click();
      await expect(page.getByRole('dialog', { name: 'Draaz help assistant' })).toBeVisible();
    });
  });
}
