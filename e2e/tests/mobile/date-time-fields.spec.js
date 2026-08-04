import { test, expect } from '../../fixtures/base.js';

/* Date & time pickers on a phone — the bottom-sheet docking.
 *
 * Below 640px both DatePickerDialog and TimePickerDialog stop being anchored
 * dropdowns and dock to the bottom edge as full-width sheets. That is not
 * cosmetic: ScheduleVisitModal is itself a sheet at this width, and an anchored
 * popup floating over a sheet is a dialog inside a dialog — the classic mobile
 * failure the review flagged as P0.
 *
 * The mechanism is split across two files that must stay in step, which is
 * exactly why it needs a test:
 *   - the CSS docks `.pn-cal` at `max-width: 639.98px`;
 *   - `place()` in each dialog bails out at the SAME breakpoint and clears the
 *     inline left/top it writes on wider screens (inline styles would otherwise
 *     beat the stylesheet and leave the sheet floating mid-screen).
 * If either side drifts, the sheet lands in the wrong place. Asserting the
 * rendered box catches that; asserting a class name would not.
 *
 * Measurement note: `boundingBox()` is DOCUMENT-relative, so on a scrolled page
 * it reports a fixed element hundreds of pixels below the fold and the assertion
 * fails against correct CSS. Read `getBoundingClientRect()` instead — it is
 * viewport-relative, which is the frame a fixed sheet actually lives in.
 */

const dateField = (page) => page.locator('.pn-datefield').first();
const rect = (locator) => locator.evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom };
});

/* The sheet slides up from `translateY(100%)`, so a rect read the moment it
   becomes visible reports it a full sheet-height below the fold. Poll until the
   bottom edge settles on the viewport edge rather than sleeping a fixed amount. */
async function expectDockedToBottom(page, cal) {
  const viewport = page.viewportSize();
  await expect.poll(async () => Math.round((await rect(cal)).bottom)).toBe(viewport.height);
}

/** Open the first date field on a route and return the settled sheet. */
async function openSheet(page) {
  const field = dateField(page);
  await expect(field).toBeVisible({ timeout: 20_000 });
  await field.click();
  const cal = page.locator('.pn-cal');
  await expect(cal).toBeVisible();
  await expectDockedToBottom(page, cal);
  return cal;
}

test.describe('Mobile date & time pickers', () => {
  test('the calendar docks to the bottom edge, full width', async ({ page, login }) => {
    await login.asTenant();
    await page.goto('/tenant-profile');
    const cal = await openSheet(page);

    const viewport = page.viewportSize();
    const box = await rect(cal);

    // Full-bleed: spans the viewport rather than sitting in a 275px card.
    expect(box.x).toBeLessThanOrEqual(1);
    expect(box.width).toBeGreaterThanOrEqual(viewport.width - 2);

    // The inline anchoring `place()` writes on desktop must have been cleared,
    // or it would fight the sheet rules and win.
    expect(await cal.evaluate((el) => ({ left: el.style.left, top: el.style.top })))
      .toEqual({ left: '', top: '' });
  });

  test('every day cell stays on screen and the sheet dismisses', async ({ page, login }) => {
    await login.asTenant();
    await page.goto('/tenant-profile');
    const cal = await openSheet(page);

    // A sheet whose grid runs off the bottom is unusable, and is exactly what the
    // docking rules exist to prevent.
    const viewport = page.viewportSize();
    const last = await rect(cal.locator('.pn-cal__day').last());
    expect(last.bottom).toBeLessThanOrEqual(viewport.height);

    // Tapping above the sheet (the backdrop) closes it.
    await page.mouse.click(viewport.width / 2, 20);
    await expect(cal).toBeHidden();
  });

  test('the schedule-visit picker docks rather than floating over its own sheet', async ({ page, login }) => {
    await login.asBuyer();
    await page.goto('/schedule-visit');
    const cal = await openSheet(page);

    const viewport = page.viewportSize();
    expect((await rect(cal)).width).toBeGreaterThanOrEqual(viewport.width - 2);
  });

  test('the time picker docks too — both dialogs share the breakpoint', async ({ page, login }) => {
    await login.asBuyer();
    await page.goto('/schedule-visit');

    const time = page.locator('.pn-datefield').last();
    await expect(time).toBeVisible({ timeout: 20_000 });
    await time.click();

    /* `.pn-timepicker` reuses the `.pn-cal` shell, so the sheet rules are supposed
       to convert both dialogs. Its own `width` declaration sits later in the
       stylesheet at equal specificity and used to beat the full-bleed rule, docking
       a 250px stub against the left edge — hence the explicit width assertion. */
    const picker = page.locator('.pn-cal');
    await expect(picker).toBeVisible();
    await expect(page.locator('.pn-timepicker')).toBeVisible();
    await expectDockedToBottom(page, picker);

    const viewport = page.viewportSize();
    expect((await rect(picker)).width).toBeGreaterThanOrEqual(viewport.width - 2);
  });
});
