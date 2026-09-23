import { expect } from '@playwright/test';

/* The browser-side draft the wizard restores from, which several specs seed to skip step 1.
   Exported rather than retyped because `useFormDraft` requires the key to be RENAMED whenever the
   form's field shape changes (`omit` is applied on write, so a stale draft would otherwise restore
   a field the new code drops) — and a spec still holding the previous suffix does not fail loudly,
   it silently seeds nothing and reports whatever the unseeded step does instead. One constant means
   the next rename is one edit. Suffix history: unsuffixed -> `:v2` when consent and agreement
   fields joined the omit list. */
export const LIST_PROPERTY_DRAFT_KEY = 'dzDraft:list-property:v2';

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
