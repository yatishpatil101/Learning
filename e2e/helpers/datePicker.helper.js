// Shared Playwright helper for driving the app's custom calendar (DateField → DatePickerDialog).
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// @param {import('@playwright/test').Page} page @param {string} wrapperSelector - Selector for the field wrapper (e.g.
export async function pickDate(page, wrapperSelector, iso) {
  const [y, m] = iso.split('-').map(Number);
  const field = page.locator(wrapperSelector).first();
  await field.scrollIntoViewIfNeeded();
  await field.click();

  const cal = page.locator('.dz-cal.is-open');
  await cal.waitFor({ state: 'visible' });

  await cal.locator('.dz-cal__dd--year .dz-dropdown__trigger').click();
  await page.locator('.dz-dropdown__menu--portal [role="option"]', { hasText: new RegExp(`^${y}$`) }).first().click();

  await cal.locator('.dz-cal__dd:not(.dz-cal__dd--year) .dz-dropdown__trigger').click();
  await page.locator('.dz-dropdown__menu--portal [role="option"]', { hasText: new RegExp(`^${MONTHS[m - 1]}$`) }).first().click();

  await cal.locator(`.dz-cal__day[aria-label="${iso}"]:not(.is-muted)`).click();
  await cal.waitFor({ state: 'detached' });
}
