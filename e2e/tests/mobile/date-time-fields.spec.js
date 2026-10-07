import { test, expect } from '../../fixtures/live.js';

/* Below 640px the pickers dock as bottom sheets; the CSS (`.dz-cal`, 639.98px) and `place()` must share the
   breakpoint. Use `getBoundingClientRect()`: `boundingBox()` is document-relative, wrong for fixed elements. */

const dateField = (page) => page.locator('.dz-datefield').first();
const rect = (locator) => locator.evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom };
});

/* The sheet slides up from `translateY(100%)`, so poll until its bottom edge settles, not a fixed sleep. */
async function expectDockedToBottom(page, cal) {
  const viewport = page.viewportSize();
  await expect.poll(async () => Math.round((await rect(cal)).bottom)).toBe(viewport.height);
}

/** Open the first date field on a route and return the settled sheet. */
async function openSheet(page) {
  const field = dateField(page);
  await expect(field).toBeVisible({ timeout: 20_000 });
  await field.click();
  const cal = page.locator('.dz-cal');
  await expect(cal).toBeVisible();
  await expectDockedToBottom(page, cal);
  return cal;
}

test.describe('Mobile date & time pickers', () => {
  test('the calendar docks to the bottom edge, full width, keeps every day on screen and dismisses', async ({ page, login }) => {
    await login.asTenant();
    await page.goto('/tenant-profile');
    const cal = await openSheet(page);
    const viewport = page.viewportSize();

    await test.step('the calendar docks to the bottom edge, full width', async () => {
      const box = await rect(cal);

      // Full-bleed: spans the viewport rather than sitting in a 275px card.
      expect(box.x).toBeLessThanOrEqual(1);
      expect(box.width).toBeGreaterThanOrEqual(viewport.width - 2);
      expect(await cal.evaluate((el) => getComputedStyle(el).borderBottomLeftRadius)).toBe('0px');

      // The inline anchoring `place()` writes on desktop must have been cleared,
      // or it would fight the sheet rules and win.
      expect(await cal.evaluate((el) => ({ left: el.style.left, top: el.style.top })))
        .toEqual({ left: '', top: '' });
    });

    await test.step('every day cell stays on screen and the sheet dismisses', async () => {
      // A sheet whose grid runs off the bottom is unusable, and is exactly what the
      // docking rules exist to prevent.
      const last = await rect(cal.locator('.dz-cal__day').last());
      expect(last.bottom).toBeLessThanOrEqual(viewport.height);

      // Tapping above the sheet lands on the backdrop, not the page underneath, and closes it.
      const backdrop = page.locator('.dz-cal-backdrop');
      expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.className, [viewport.width / 2, 20]))
        .toBe('dz-cal-backdrop');
      await page.mouse.click(viewport.width / 2, 20);
      await expect(cal).toBeHidden();
      await expect(backdrop).toHaveCount(0);
    });
  });

  test('the schedule-visit date and time pickers dock rather than floating over their own sheet', async ({ page, login }) => {
    await login.asBuyer();
    await page.goto('/schedule-visit');
    const viewport = page.viewportSize();

    await test.step('the date picker docks', async () => {
      const cal = await openSheet(page);
      expect((await rect(cal)).width).toBeGreaterThanOrEqual(viewport.width - 2);
    });

    await test.step('the time picker docks too — both dialogs share the breakpoint', async () => {
      await page.goto('/schedule-visit');
      const time = page.locator('.dz-datefield').last();
      await expect(time).toBeVisible({ timeout: 20_000 });
      await time.click();

      /* .dz-timepicker reuses the .dz-cal shell, but its later width can beat the full-bleed rule. */
      const picker = page.locator('.dz-cal');
      await expect(picker).toBeVisible();
      await expect(page.locator('.dz-timepicker')).toBeVisible();
      await expectDockedToBottom(page, picker);

      expect((await rect(picker)).width).toBeGreaterThanOrEqual(viewport.width - 2);
    });
  });
});
