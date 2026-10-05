import { expect } from '@playwright/test';

export const LIST_PROPERTY_DRAFT_KEY = 'dzDraft:list-property:v3';
export const LIST_PROPERTY_DRAFT_PREFIX = 'dzDraft:list-property';

export const readListPropertyDraft = (page) => page.evaluate(
  (key) => localStorage.getItem(key), LIST_PROPERTY_DRAFT_KEY);

export async function pickDeal(page, deal = 'buy') {
  const label = deal === 'rent' ? 'Rent' : 'Sale';
  await page.locator('[data-err="deal"]').getByRole('button', { name: label, exact: true }).click();
}

export async function pickBhk(page, bhk = '2') {
  await page.locator('[data-err="bhk"]').getByRole('button', { name: bhk, exact: true }).click();
}

async function pickDealIfMissing(page) {
  const group = page.locator('[data-err="deal"]');
  if (await group.count() && !(await group.locator('.selected').count())) {
    await pickDeal(page);
  }
}

async function pickBhkIfMissing(page) {
  const group = page.locator('[data-err="bhk"]');
  if (await group.count() && !(await group.locator('.selected').count())) {
    await pickBhk(page);
  }
}

// Step 1 will not advance for a flat until both are answered.
export async function pickFloors(page, { floor = '9', totalFloors = '14' } = {}) {
  await pickDealIfMissing(page);
  await pickBhkIfMissing(page);
  for (const [dataErr, value] of [['floor', floor], ['totalFloors', totalFloors]]) {
    await page.locator(`[data-err="${dataErr}"] .dz-dropdown__trigger`).click();
    await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
    await page.getByRole('option', { name: value, exact: true }).click();
  }
}

// No default: the possession facet must not be filled with guessed values.
export async function pickPossession(page, label = 'Ready to Move') {
  await page.locator('[data-err="possession"]').getByText(label, { exact: true }).click();
}
