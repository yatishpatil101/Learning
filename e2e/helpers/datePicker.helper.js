// Shared Playwright helper for driving the app's custom calendar (DateField →
// DatePickerDialog). Replaces the old `input[type="date"].fill(iso)` approach:
// the picker is now a themed dropdown, so we set year + month via the shared
// <Select> menus, then click the day cell (which commits immediately).

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Pick an ISO date (yyyy-mm-dd) in the DateField identified by `wrapperSelector`.
 * @param {import('@playwright/test').Page} page
 * @param {string} wrapperSelector - Selector for the field wrapper (e.g. '[data-err="availableFrom"]').
 * @param {string} iso - Target date as 'yyyy-mm-dd'.
 */
export async function pickDate(page, wrapperSelector, iso) {
  const [y, m] = iso.split('-').map(Number);
  const field = page.locator(wrapperSelector).first();
  await field.scrollIntoViewIfNeeded();
  await field.click();

  const cal = page.locator('.dz-cal');
  await cal.waitFor({ state: 'visible' });

  // Year.
  await cal.locator('.dz-cal__dd--year .dz-dropdown__trigger').click();
  await page.locator('.dz-dropdown__menu--portal [role="option"]', { hasText: new RegExp(`^${y}$`) }).first().click();

  // Month.
  await cal.locator('.dz-cal__dd:not(.dz-cal__dd--year) .dz-dropdown__trigger').click();
  await page.locator('.dz-dropdown__menu--portal [role="option"]', { hasText: new RegExp(`^${MONTHS[m - 1]}$`) }).first().click();

  // Day (the in-month cell for this exact date) — clicking it commits immediately.
  await cal.locator(`.dz-cal__day[aria-label="${iso}"]:not(.is-muted)`).click();
  await cal.waitFor({ state: 'detached' });
}
