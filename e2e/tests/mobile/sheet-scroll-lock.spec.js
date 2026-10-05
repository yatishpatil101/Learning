import { test, expect } from '../../fixtures/live.js';
import { seedConsent } from '../../helpers/liveAuth.js';

// Phone-only: desktop never mounts these bottom-sheet replacements.
const rootOverflow = (page) => page.evaluate(() => getComputedStyle(document.documentElement).overflowY);

// Read off the ROOT, not `body`: `index.css` gives html `overflow-x: clip`, so body's overflow never propagates.
test.describe('Phone bottom sheets hold the page still', () => {
  test("the societies sort dropdown", async ({ page }) => {
    await seedConsent(page);
    await page.goto('/societies');

    const trigger = page.getByRole('button', { name: 'Sort societies' });
    await trigger.waitFor({ timeout: 20_000 });
    await trigger.click();
    await expect(page.getByRole('listbox', { name: 'Sort societies' })).toBeVisible();
    expect(await rootOverflow(page), 'the page must not move under the open sheet').toBe('hidden');

    // Escape rather than the scrim: it is the path a mis-scoped handler breaks.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox', { name: 'Sort societies' })).toHaveCount(0);
    expect(await rootOverflow(page), 'closing must hand scrolling back').not.toBe('hidden');
  });
});
