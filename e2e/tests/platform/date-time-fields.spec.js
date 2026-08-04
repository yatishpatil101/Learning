import { test, expect } from '../../fixtures/base.js';

/* DateField / TimeField — the app-wide pickers, on the routes that use them.
 *
 * These are shared UI components (components/ui/DateField.jsx, TimeField.jsx and
 * their dialogs) rendered on ~20 surfaces: the listing wizard, the rent-agreement
 * wizard, the tenant profile, schedule-visit, the dashboard visits tab, the
 * flatmates filter bar, admin enquiries and the post-on-behalf wizard.
 *
 * Their stylesheet was not shared. `.pn-datefield`, `.pn-cal` and `.pn-timepicker`
 * lived in `styles/routes/list-property.css`, which only ListProperty.jsx imports —
 * so on every OTHER route the field rendered as a plain block and the calendar as
 * a static, unlayered element that reflowed the page instead of floating over it.
 * The rules now live in `styles/components/date-time-fields.css`, imported by the
 * two components.
 *
 * These assertions are what keeps that fixed: they check the *computed* box on
 * more than one route. Asserting a class name would have passed against the bug.
 */

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

      const field = page.locator('.pn-datefield').first();
      await expect(field).toBeVisible({ timeout: 20_000 });

      // The field itself is styled (flex row with the trailing calendar icon).
      await expect(field).toHaveCSS('display', 'flex');
      await expect(field.locator('.pn-datefield__icon')).toBeVisible();

      await field.click();

      // The dialog is an overlay, not an inline block that pushes the form down.
      const cal = page.locator('.pn-cal');
      await expect(cal).toBeVisible();
      await expect(cal).toHaveCSS('position', 'fixed');
      await expect(cal).toHaveCSS('z-index', '2000');
    });
  }

  test('picking a date writes DD/MM/YYYY regardless of browser locale', async ({ page, login }) => {
    await login.asTenant();
    await page.goto('/tenant-profile');

    const field = page.locator('.pn-datefield').first();
    await field.click();

    const cal = page.locator('.pn-cal');
    await expect(cal).toBeVisible();

    // Any selectable day in the current view commits immediately.
    const day = cal.locator('.pn-cal__day:not(.is-muted):not([disabled])').first();
    const iso = await day.getAttribute('aria-label');
    await day.click();
    await expect(cal).toBeHidden();

    const [y, m, d] = iso.split('-');
    await expect(field.locator('.pn-datefield__text')).toHaveText(`${d}/${m}/${y}`);
  });

  test('the time picker is the app dialog, not the OS control', async ({ page, login }) => {
    await login.asBuyer();
    await page.goto('/schedule-visit');

    // No native date/time inputs anywhere — the slot rules live in the custom
    // dialogs, and a native control would silently bypass them.
    await expect(page.locator('input[type="time"], input[type="date"]')).toHaveCount(0);

    const time = page.locator('.pn-datefield').last();
    await expect(time).toBeVisible({ timeout: 20_000 });
    await time.click();

    const picker = page.locator('.pn-timepicker');
    await expect(picker).toBeVisible();
    // AM/PM toggle, not a 24h spinner — the readout is what the user confirms.
    await expect(picker.locator('.pn-timepicker__mer button')).toHaveCount(2);
    await expect(picker.locator('.pn-timepicker__readout')).toBeVisible();
  });
});
