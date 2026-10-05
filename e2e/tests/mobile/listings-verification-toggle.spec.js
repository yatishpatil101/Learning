import { test, expect } from '@playwright/test';
import { seedConsent } from '../../helpers/liveAuth.js';

test('toggling a verification filter keeps the /listings sheet visible', async ({ page }) => {
  await seedConsent(page);
  await page.goto('/listings?deal=buy', { waitUntil: 'domcontentloaded' });
  const fab = page.locator('.filter-fab');
  await fab.waitFor({ state: 'visible', timeout: 30_000 });
  await fab.click();

  const sheet = page.locator('.filter-panel');
  await sheet.getByRole('button', { name: /^Verification/ }).click();
  await sheet.getByText('ID verified owner', { exact: true }).click();

  await expect(page).toHaveURL(/[?&]v=owner/);
  await expect(sheet.getByRole('button', { name: /close filters/i })).toBeInViewport();
  await expect(sheet.getByTestId('filter-drawer-actions')).toBeInViewport();
  expect(await sheet.evaluate((el) => el.scrollTop)).toBe(0);
});
