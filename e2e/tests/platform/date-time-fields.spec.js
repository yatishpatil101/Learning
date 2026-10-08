import { test, expect } from '../../fixtures/live.js';

/* DateField/TimeField render on ~20 surfaces, so these check the computed box on more than one route:
   a class-name assertion would pass even where the field rendered as a plain block. */

/** Routes that render a DateField, with the setup each needs to reach one. */
const ROUTES = [
  {
    name: '/tenant-profile',
    open: async (page, login) => {
      await login.asTenant();
      await page.goto('/tenant-profile');
    },
  },
  {
    name: '/schedule-visit',
    open: async (page, login) => {
      await login.asBuyer();
      await page.goto('/schedule-visit');
    },
  },
  {
    // The filter bar is collapsed behind the Filters button on this route.
    name: '/flatmates (filter bar)',
    open: async (page) => {
      await page.goto('/flatmates');
      await page.getByRole('button', { name: 'Filters' }).first().click();
    },
  },
];

test.describe('Date & time pickers', () => {
  for (const route of ROUTES) {
    test(`the calendar floats over the page on ${route.name}`, async ({ page, login }) => {
      await route.open(page, login);

      const field = page.locator('.dz-datefield').first();
      await expect(field).toBeVisible({ timeout: 20_000 });

      // The field itself is styled (flex row with the trailing calendar icon).
      await expect(field).toHaveCSS('display', 'flex');
      await expect(field.locator('.dz-datefield__icon')).toBeVisible();

      await field.click();

      // The dialog is an overlay, not an inline block that pushes the form down.
      const cal = page.locator('.dz-cal');
      await expect(cal).toBeVisible();
      await expect(cal).toHaveCSS('position', 'fixed');
      await expect(cal).toHaveCSS('z-index', '2000');
    });
  }

  test('picking a date writes DD/MM/YYYY regardless of browser locale', async ({ page, login }) => {
    await login.asTenant();
    await page.goto('/tenant-profile');

    const field = page.locator('.dz-datefield').first();
    await field.click();

    const cal = page.locator('.dz-cal');
    await expect(cal).toBeVisible();

    // Any selectable day in the current view commits immediately.
    const day = cal.locator('.dz-cal__day:not(.is-muted):not([disabled])').first();
    const iso = await day.getAttribute('aria-label');
    await day.click();
    await expect(cal).toBeHidden();

    const [y, m, d] = iso.split('-');
    await expect(field.locator('.dz-datefield__text')).toHaveText(`${d}/${m}/${y}`);
  });

  test('the time picker is the app dialog, not the OS control', async ({ page, login }) => {
    await login.asBuyer();
    await page.goto('/schedule-visit');

    // No native date/time inputs anywhere — the slot rules live in the custom
    // dialogs, and a native control would silently bypass them.
    await expect(page.locator('input[type="time"], input[type="date"]')).toHaveCount(0);

    const time = page.locator('.dz-datefield').last();
    await expect(time).toBeVisible({ timeout: 20_000 });
    await time.click();

    const picker = page.locator('.dz-timepicker');
    await expect(picker).toBeVisible();
    // AM/PM toggle, not a 24h spinner — the readout is what the user confirms.
    await expect(picker.locator('.dz-timepicker__mer button')).toHaveCount(2);
    await expect(picker.locator('.dz-timepicker__readout')).toBeVisible();
  });
});
