// Read maintenance back through the API so a dropped mode-dependent amount cannot pass as saved.
import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { pickDate } from '../../../helpers/datePicker.helper.js';
import { signedInAsNew, authHeaders, API } from '../../../helpers/liveAuth.js';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAARElEQVR4AeyROw0AIAxEL5WADzSw4AcRaGLBDzqKg7uhS4c2eVOTy33snemMtrYzDMErASBBB/0OMNTKCSIoi+pfEYAPAAD//68o26gAAAAGSURBVAMAR8QwUeUtYucAAAAASUVORK5CYII=';

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

// The step rail distinguishes the wizard from the paywall, which also renders the meter.
async function gotoFlow(page) {
  const mobile = await signedInAsNew(page);
  owners.add(mobile);
  await page.goto('/list-property');
  await page.waitForSelector('.lp-steps', { timeout: 20000 });
  return mobile;
}

async function pickOption(page, dataErr, label) {
  await page.locator(`[data-err="${dataErr}"]`).click();
  // Portal mounting precedes interactivity by one animation frame.
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
  await page.locator('.dz-dropdown__option', { hasText: label }).first().click();
}

test('Rent "Charged Extra" maintenance amount is saved on the listing', async ({ page }) => {
  const mobile = await gotoFlow(page);

  await page.locator('.radio-pill', { hasText: 'Rent' }).first().click();
  await page.locator('[data-err="propertyType"]').click();
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
  await page.locator('.dz-dropdown__option', { hasText: 'Flat / Apartment' }).first().click();
  await page.locator('input[data-err="carpetArea"]').fill('900');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });

  await pickOption(page, 'locality', 'Baner');
  await page.locator('input[data-err="flatNumber"]').fill('B-1204');
  await page.locator('input[data-err="society"]').fill('Skyline Heights');
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.locator('input[data-err="monthlyRent"]').fill('30000');
  await page.locator('input[data-err="deposit"]').fill('60000');
  await page.locator('.radio-pill', { hasText: 'Charged Extra' }).click();
  await page.locator('input[placeholder="e.g. 2,500"]').fill('2500');
  await pickDate(page, '[data-err="availableFrom"]', '2025-12-31');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Photos & documents/i', { timeout: 15000 });

  // Canvas-generated PNG bytes keep decode validation from masking the persistence assertion.
  const buf = Buffer.from(PNG, 'base64');
  await page.locator('[data-err="photos"] label.upload-zone input[type="file"]').setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: buf });
  await page.locator('.doc-upload input[type="file"]').first().setInputFiles({ name: 'doc.png', mimeType: 'image/png', buffer: buf });
  await page.getByRole('button', { name: /Submit Property/i }).click();
  await expect(page.locator('text=/Listed Successfully/i')).toBeVisible({ timeout: 30000 });

  const res = await fetch(`${API}/me/listings`, { headers: await authHeaders(mobile) });
  expect(res.status).toBe(200);
  const body = await res.json();
  const rows = Array.isArray(body) ? body : (body.content ?? body.items ?? []);
  // Brand-new account, one listing posted, free tier allows one — no search needed.
  expect(rows).toHaveLength(1);
  expect(rows[0].deal).toBe('rent');
  expect(rows[0].maintenance).toBe(2500);
});

test('Pill and Toggle selection atoms are keyboard-operable', async ({ page }) => {
  await gotoFlow(page);

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
