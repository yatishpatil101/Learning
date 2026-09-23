import { test, expect } from '../../fixtures/live.js';
import { seedConsent } from '../../helpers/liveAuth.js';

/* Phone-only: these two bottom sheets are the `lg:hidden` / `sm:hidden` replacements for a sidebar
 * and a tab strip, so a desktop run never mounts either of them. */

/** The root element's effective overflow — `hidden` exactly while some overlay holds the lock. */
const rootOverflow = (page) => page.evaluate(() => getComputedStyle(document.documentElement).overflowY);

/* Both sheets are opened by the one in-page control declaring it opens a dialog. `.glass-card`
   excludes the bottom nav's post button, which carries the same attribute on every phone route. */
const trigger = (page) => page.locator('button.glass-card[aria-haspopup="dialog"]');

/* Read off the ROOT, not `body`: `index.css` gives html `overflow-x: clip`, so body's overflow never
   propagates. Addressed by name because the account drawer stays mounted as a `role="dialog"`. */
async function assertLockCycle(page, name) {
  const sheet = page.getByRole('dialog', { name });
  await expect(trigger(page)).toHaveCount(1);
  await trigger(page).click();
  await expect(sheet).toBeVisible();
  expect(await rootOverflow(page), 'the page must not move under the open sheet').toBe('hidden');

  // Escape rather than the close button: it is the path a mis-scoped handler breaks.
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  expect(await rootOverflow(page), 'closing must hand scrolling back').not.toBe('hidden');
}

test.describe('Phone bottom sheets hold the page still', () => {
  test('the dashboard section switcher', async ({ page, login }) => {
    await seedConsent(page);
    await login.asBuyer();
    await page.goto('/dashboard');
    await trigger(page).waitFor({ timeout: 20_000 });
    await assertLockCycle(page, 'Choose dashboard section');
  });

  test("the shortlist's category switcher", async ({ page, login }) => {
    await seedConsent(page);
    await login.asBuyer();
    await page.goto('/saved');
    await trigger(page).waitFor({ timeout: 20_000 });
    await assertLockCycle(page, 'Category');
  });
});
