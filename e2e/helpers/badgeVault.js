import { expect } from '@playwright/test';

export async function openBadgeVault(page, listingId) {
  await page.goto(`/dashboard?tab=documents&prop=${encodeURIComponent(listingId)}`);
  const card = page.getByTestId('badge-request-card');
  await expect(card).toBeVisible({ timeout: 20000 });
  return card;
}

export async function uploadBadgeProof(page, card, category, file) {
  const row = card.locator(`li[data-doc="${category}"]`);
  const chooser = page.waitForEvent('filechooser');
  await row.getByRole('button', { name: 'Upload', exact: true }).click();
  await (await chooser).setFiles(file);
  await expect(row.getByRole('button', { name: 'Upload', exact: true })).toHaveCount(0, { timeout: 20000 });
}
