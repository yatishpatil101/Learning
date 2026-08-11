// @ts-check
import { test, expect } from '@playwright/test';
import { appReady } from '../../helpers/app.js';

const BASE = 'http://localhost:5173';

async function loginAsAdmin(page) {
  await page.goto(`${BASE}/staff-login`);
  await page.getByRole('button', { name: /Admin/i }).first().click();
  await page.waitForURL('**/admin');
}

async function fillOwner(page, name = 'Fix Owner', mobile = '9876543210') {
  await page.getByPlaceholder('Full name of the property owner').fill(name);
  await page.getByPlaceholder('9876543210').fill(mobile);
  await page.getByRole('button', { name: /Next/i }).click();
}

test.describe('Post on Behalf — fixes & enhancements', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${BASE}/admin/post-on-behalf`);
    await page.evaluate(() => localStorage.removeItem('pn_pob_draft_v1'));
    await page.reload();
  });

  test('deal toggle is at the top and drives pricing labels', async ({ page }) => {
    // Persistent segmented control visible on step 1
    const group = page.getByRole('group', { name: /Listing deal type/i });
    await expect(group).toBeVisible();
    await group.getByRole('button', { name: /For Sale/i }).click();
    await expect(group.getByRole('button', { name: /For Sale/i })).toHaveAttribute('aria-pressed', 'true');

    // Walk to pricing — label should read "Expected Price" for sale
    await fillOwner(page);
    await page.getByText('Select type').click();
    await page.getByRole('option', { name: /Apartment/i }).click();
    await page.getByText('Select BHK').click();
    await page.getByRole('option', { name: /2 BHK/i }).click();
    await page.getByPlaceholder('e.g. 850').fill('900');
    await page.getByRole('button', { name: /Next/i }).click();
    await page.getByText('Select locality').click();
    await page.getByRole('option', { name: /Baner/i }).click();
    await page.getByRole('button', { name: /Next/i }).click();
    await expect(page.getByText('Expected Price')).toBeVisible();
    // Security Deposit field must NOT show for sale
    await expect(page.getByText('Security Deposit')).toHaveCount(0);
  });

  test('BUG A fixed — switching type to Commercial clears stale BHK in Review', async ({ page }) => {
    await fillOwner(page, 'Cascade Owner');
    // Pick Flat + 3 BHK
    await page.getByText('Select type').click();
    await page.getByRole('option', { name: /Apartment/i }).click();
    await page.getByText('Select BHK').click();
    await page.getByRole('option', { name: /3 BHK/i }).click();
    // Switch to Commercial (trigger now shows the chosen type label)
    await page.getByText('Flat / Apartment').click();
    await page.getByRole('option', { name: /Commercial/i }).click();
    await page.getByText('Select commercial type').click();
    await page.getByRole('option', { name: /Office Space/i }).click();
    await page.getByPlaceholder('e.g. 850').fill('1200');
    await page.getByRole('button', { name: /Next/i }).click();
    // Location
    await page.getByText('Select locality').click();
    await page.getByRole('option', { name: /Baner/i }).click();
    await page.getByRole('button', { name: /Next/i }).click();
    // Pricing
    await page.locator('input[inputmode="numeric"]').first().fill('9000000');
    await page.getByRole('button', { name: /Next/i }).click();
    // Photos -> Review
    await page.getByRole('button', { name: /Next/i }).click();
    // Review must NOT contain "BHK"
    const config = page.getByText('Config', { exact: true });
    await expect(config).toHaveCount(0);
    await expect(page.getByText(/3 BHK/)).toHaveCount(0);
    await expect(page.getByText('1200 sq.ft')).toBeVisible();
  });

  test('BUG C fixed — land type hides floor/facing/furnishing and relabels area', async ({ page }) => {
    await fillOwner(page, 'Land Owner');
    await page.getByText('Select type').click();
    await page.getByRole('option', { name: /Open Plot/i }).click();
    // Area label becomes Plot Area; physical fields hidden
    await expect(page.getByText('Plot Area (sq.ft) *')).toBeVisible();
    await expect(page.getByText('Furnishing')).toHaveCount(0);
    await expect(page.getByText('Facing')).toHaveCount(0);
    await expect(page.getByText('Amenities')).toHaveCount(0);
  });

  test('amenities are captured and saved into the listing', async ({ page }) => {
    await fillOwner(page, 'Amenity Owner', '9812345678');
    await page.getByText('Select type').click();
    await page.getByRole('option', { name: /Apartment/i }).click();
    await page.getByText('Select BHK').click();
    await page.getByRole('option', { name: /2 BHK/i }).click();
    await page.getByPlaceholder('e.g. 850').fill('950');
    // Select two amenities
    await page.getByText('Select amenities').click();
    await page.getByRole('option', { name: 'Lift' }).click();
    await page.getByRole('option', { name: 'Power Backup' }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /Next/i }).click();
    await page.getByText('Select locality').click();
    await page.getByRole('option', { name: /Wakad/i }).click();
    await page.getByRole('button', { name: /Next/i }).click();
    await page.locator('input[inputmode="numeric"]').first().fill('24000');
    await page.getByRole('button', { name: /Next/i }).click();
    await page.getByRole('button', { name: /Next/i }).click();
    // Review shows Amenities row
    await expect(page.getByText('Lift, Power Backup')).toBeVisible();
    await page.getByRole('button', { name: /Send to Owner/i }).click();
    await expect(page.getByRole('heading', { name: 'Listing Sent to Owner' })).toBeVisible({ timeout: 5000 });
    const saved = await page.evaluate(() => {
      const db = JSON.parse(localStorage.getItem('puneNestDB_v5') || '{}');
      const l = (db.listings || []).find((x) => x.owner === 'Amenity Owner');
      return l ? l.amenities : null;
    });
    expect(saved).toContain('Lift');
    expect(saved).toContain('Power Backup');
  });

  test('BUG B fixed — deposit never saved on a sale listing', async ({ page }) => {
    // Enter as rent with a deposit, then flip to sale
    await fillOwner(page, 'NoDeposit Owner', '9700000001');
    await page.getByText('Select type').click();
    await page.getByRole('option', { name: /Apartment/i }).click();
    await page.getByText('Select BHK').click();
    await page.getByRole('option', { name: /2 BHK/i }).click();
    await page.getByPlaceholder('e.g. 850').fill('900');
    await page.getByRole('button', { name: /Next/i }).click();
    await page.getByText('Select locality').click();
    await page.getByRole('option', { name: /Baner/i }).click();
    await page.getByRole('button', { name: /Next/i }).click();
    await page.locator('input[inputmode="numeric"]').first().fill('25000');
    await page.getByRole('button', { name: '2 months rent' }).click();
    // Flip to sale using the top toggle (visible on every step)
    await page.getByRole('group', { name: /Listing deal type/i }).getByRole('button', { name: /For Sale/i }).click();
    await expect(page.getByText('Security Deposit')).toHaveCount(0);
    // Continue to submit
    await page.getByRole('button', { name: /Next/i }).click();
    await page.getByRole('button', { name: /Next/i }).click();
    await page.getByRole('button', { name: /Send to Owner/i }).click();
    await expect(page.getByRole('heading', { name: 'Listing Sent to Owner' })).toBeVisible({ timeout: 5000 });
    const saved = await page.evaluate(() => {
      const db = JSON.parse(localStorage.getItem('puneNestDB_v5') || '{}');
      const l = (db.listings || []).find((x) => x.owner === 'NoDeposit Owner');
      return l ? { deal: l.deal, deposit: l.deposit } : null;
    });
    expect(saved).toEqual({ deal: 'buy', deposit: 0 });
  });

  test('duplicate-owner soft warning appears for a mobile with a pending listing', async ({ page }) => {
    // Seed a pending listing for a mobile
    // `beforeEach` ends on a bare `page.reload()`, which resolves before the store is
    // rewritten (D129) — and this is a read-modify-write, so `|| '{}'` would put an empty
    // catalogue back and the duplicate warning could never fire.
    await appReady(page);
    await page.evaluate(() => {
      const raw = localStorage.getItem('puneNestDB_v5');
      if (!raw) throw new Error('mock store missing after appReady()');
      const db = JSON.parse(raw);
      db.listings = db.listings || [];
      db.listings.unshift({ id: 'PRDUP1', owner: 'Dup Owner', ownerMobile: '9911223344', status: 'pending', title: 'Dup', deal: 'rent', price: 1, area: 1, type: 'Flat' });
      localStorage.setItem('puneNestDB_v5', JSON.stringify(db));
    });
    await page.reload();
    await page.getByPlaceholder('9876543210').fill('9911223344');
    await expect(page.getByText(/already has 1 pending listing/i)).toBeVisible();
  });

  test('draft autosave — refresh mid-wizard offers Resume', async ({ page }) => {
    await page.getByPlaceholder('Full name of the property owner').fill('Draft Owner');
    await page.getByPlaceholder('9876543210').fill('9876500000');
    // trigger autosave then reload
    await page.waitForTimeout(300);
    await page.reload();
    await expect(page.getByText(/unsaved draft/i)).toBeVisible();
    await page.getByRole('button', { name: /^Resume$/ }).click();
    await expect(page.getByPlaceholder('Full name of the property owner')).toHaveValue('Draft Owner');
  });

  test('labels are associated with inputs (clicking label focuses field)', async ({ page }) => {
    await page.getByText('Owner Name *').click();
    await expect(page.locator('#pob-ownerName')).toBeFocused();
  });
});

