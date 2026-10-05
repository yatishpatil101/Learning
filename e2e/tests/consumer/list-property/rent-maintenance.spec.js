// Read maintenance back through the API so a dropped mode-dependent amount cannot pass as saved.
import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { pickDate } from '../../../helpers/datePicker.helper.js';
import { uploadPublishablePhotos } from '../../../helpers/listingPhotos.helper.js';
import { signedInAsNew, authHeaders, API } from '../../../helpers/liveAuth.js';
// Track owners before submission so teardown can withdraw listings even after a mid-flow failure.
const owners = new Set();

test.afterEach(async () => {
  if (!owners.size) return;
  const adminHeaders = await authHeaders(ACTORS.admin);
  for (const mobile of owners) {
    const res = await fetch(`${API}/me/listings`, { headers: await authHeaders(mobile) });
    if (res.status !== 200) continue;
    const body = await res.json();
    const rows = Array.isArray(body) ? body : (body.content ?? body.items ?? []);
    for (const row of rows) {
      await fetch(`${API}/properties/${row.id}/status`, {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify({ status: 'rejected', reason: 'Zztest cleanup \u2014 synthetic rent-maintenance fixture' }),
      });
    }
  }
  owners.clear();
});

async function gotoFlow(page) {
  const mobile = await signedInAsNew(page);
  owners.add(mobile);
  await page.goto('/list-property');
  await page.waitForSelector('.lp-steps', { timeout: 20000 });
  return mobile;
}

async function pickOption(page, dataErr, label) {
  await page.locator(`[data-err="${dataErr}"]`).click();
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
  await page.locator('.dz-dropdown__option', { hasText: label }).first().click();
}

test('Pill selection is keyboard-operable, and a rent "Charged Extra" maintenance amount is saved on the listing', async ({ page }) => {
  test.slow();
  const mobile = await gotoFlow(page);

  await test.step('Pill selection atoms are keyboard-operable', async () => {
    const rentPill = page.locator('.radio-pill', { hasText: 'Rent' }).first();
    await expect(rentPill).toHaveAttribute('role', 'button');
    await rentPill.focus();
    await rentPill.press('Enter');
    await expect(rentPill).toHaveClass(/selected/);
    await expect(rentPill).toHaveAttribute('aria-pressed', 'true');

    const salePill = page.locator('.radio-pill', { hasText: 'Sale' }).first();
    await salePill.focus();
    await salePill.press(' ');
    await expect(salePill).toHaveClass(/selected/);
  });

  await page.locator('.radio-pill', { hasText: 'Rent' }).first().click();
  await page.locator('[data-err="propertyType"]').click();
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
  await page.locator('.dz-dropdown__option', { hasText: 'Flat / Apartment' }).first().click();
  await page.locator('[data-err="bhk"]').getByRole('button', { name: '2', exact: true }).click();
  await page.locator('input[data-err="carpetArea"]').fill('900');
  for (const [dataErr, value] of [['floor', '9'], ['totalFloors', '14']]) {
    await page.locator(`[data-err="${dataErr}"] .dz-dropdown__trigger`).click();
    await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
    await page.getByRole('option', { name: value, exact: true }).click();
  }
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });

  await pickOption(page, 'locality', 'Baner');
  await page.locator('input[data-err="flatNumber"]').fill('B-1204');
  await page.locator('input[data-err="society"]').fill('Skyline Heights');
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Price & terms/i', { timeout: 15000 });
  await page.locator('input[data-err="monthlyRent"]').fill('30000');
  await page.locator('input[data-err="deposit"]').fill('60000');
  await page.locator('.radio-pill', { hasText: 'Charged Extra' }).click();
  await page.locator('input[placeholder="e.g. 2,500"]').fill('2500');
  await pickDate(page, '[data-err="availableFrom"]', '2027-12-31');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Photos & description/i', { timeout: 15000 });

  await uploadPublishablePhotos(page);
  await page.getByRole('button', { name: /Submit Property/i }).click();
  await expect(page.locator('text=/Submitted for review/i')).toBeVisible({ timeout: 30000 });

  const res = await fetch(`${API}/me/listings`, { headers: await authHeaders(mobile) });
  expect(res.status).toBe(200);
  const body = await res.json();
  const rows = Array.isArray(body) ? body : (body.content ?? body.items ?? []);
  expect(rows).toHaveLength(1);
  expect(rows[0].deal).toBe('rent');
  expect(rows[0].maintenance).toBe(2500);
});
