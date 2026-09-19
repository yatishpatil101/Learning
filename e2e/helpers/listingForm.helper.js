import { expect } from '@playwright/test';

/* Step 1 will not advance for a flat until both are answered. Commercial does not owe this — a godown or a
   shed has neither a floor nor a storey count — so only walks starting from "Flat / Apartment" need it. */
export async function pickFloors(page, { floor = '9', totalFloors = '14' } = {}) {
  for (const [dataErr, value] of [['floor', floor], ['totalFloors', totalFloors]]) {
    await page.locator(`[data-err="${dataErr}"] .dz-dropdown__trigger`).click();
    await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
    await page.getByRole('option', { name: value, exact: true }).click();
  }
}

/* Possession has no default, because the Ready-to-Move / Under-Construction facet is built from this field
   and a default would fill it with guesses. So a sale walk has to answer it to cross the pricing step. */
export async function pickPossession(page, label = 'Ready to Move') {
  await page.locator('[data-err="possession"]').getByText(label, { exact: true }).click();
}
