// @ts-check
import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const TENANT = { name: 'Yatish', mobile: '9700055010', email: '', role: 'buyer', joinedAt: Date.now() };

async function login(page, user) {
  await page.addInitScript((u) => {
    localStorage.setItem('puneNestUser', JSON.stringify(u));
    localStorage.setItem('puneNestUsers', JSON.stringify([u]));
    // Seed cookie consent so the global banner (also role="dialog") doesn't overlay the page
    // or collide with in-page dialog lookups. Mirrors mobile-inbox-saved / legal-pages specs.
    localStorage.setItem('pn_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }));
  }, user);
}

test.describe('Tenant profile', () => {
  test('income is stored as digits but shown grouped', async ({ page }) => {
    await login(page, TENANT);
    await page.goto(`${BASE}/tenant-profile`, { waitUntil: 'networkidle' });
    await page.locator('#tp-income').fill('90000');
    await expect(page.locator('#tp-income')).toHaveValue('90,000');
    // reflected in the live preview
    await expect(page.getByText('₹90,000/mo')).toBeVisible();
  });

  test('Save is blocked with an empty name', async ({ page }) => {
    await login(page, TENANT);
    await page.goto(`${BASE}/tenant-profile`, { waitUntil: 'networkidle' });
    await page.locator('#tp-name').fill('');
    await page.getByRole('button', { name: /save profile/i }).click();
    await expect(page.getByText(/please enter your name/i).first()).toBeVisible();
    // success CTA should NOT appear
    await expect(page.getByRole('button', { name: /browse rentals/i })).toHaveCount(0);
  });

  test('booster checklist reflects filled fields', async ({ page }) => {
    await login(page, TENANT);
    await page.goto(`${BASE}/tenant-profile`, { waitUntil: 'networkidle' });
    await expect(page.getByText('Boost your score')).toBeVisible();
    // occupation pending shows its point value
    await expect(page.getByText('+20%')).toBeVisible();
    await page.locator('#tp-occ').fill('Engineer');
    // once filled, the +20% is earned and disappears from the pending column
    await expect(page.getByText('+20%')).toHaveCount(0);
  });

  test('DigiLocker verification earns a Verified badge and persists a masked id', async ({ page }) => {
    await login(page, TENANT);
    await page.goto(`${BASE}/tenant-profile`, { waitUntil: 'networkidle' });

    await page.getByRole('button', { name: /^Verify now$/i }).click();
    // Verification is now the opt-in DigiLocker badge earn (badge-not-gate, ADR-019).
    // Identity is proven natively on DigiLocker, so there is no in-app Aadhaar field or OTP.
    const dialog = page.getByRole('dialog', { name: 'Get your Verified badge' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#kyc-aadhaar')).toHaveCount(0);
    await dialog.getByRole('button', { name: /continue with digilocker/i }).click();
    // The mock DigiLocker round-trip resolves after ~1.7s and records the badge.

    // verified: badge + masked-mobile reference appear, full number never shown
    await expect(page.getByText('Verified ✓')).toBeVisible();
    await expect(page.getByText(/Aadhaar · \+91 97/)).toBeVisible();
    // an unchanged verified user is never nagged to re-verify
    await expect(page.getByRole('button', { name: /re-verify/i })).toHaveCount(0);

    // persists across reload
    await page.reload({ waitUntil: 'networkidle' });
    await expect(page.getByText(/Aadhaar · \+91 97/)).toBeVisible();
    await expect(page.getByRole('button', { name: /re-verify/i })).toHaveCount(0);
  });

  test('re-verify is offered only when the Aadhaar-linked mobile changed', async ({ page }) => {
    // Seed a verified profile whose KYC was done against a DIFFERENT mobile than
    // the current account number — i.e. the user later changed their number.
    await page.addInitScript(() => {
      const u = { name: 'Yatish', mobile: '9700055010', role: 'buyer', joinedAt: Date.now() };
      localStorage.setItem('puneNestUser', JSON.stringify(u));
      localStorage.setItem('puneNestUsers', JSON.stringify([u]));
      localStorage.setItem('pnTenantProfile:9700055010', JSON.stringify({
        name: 'Yatish', employment: '', income: '', occupants: '', moveIn: '', priorLandlord: '', about: '',
        idVerified: true, kyc: { type: 'aadhaar', label: 'Aadhaar', masked: '+91 98\u2022\u2022\u2022 \u2022\u2022\u202288', verifiedAt: Date.now() },
      }));
    });
    await page.goto(`${BASE}/tenant-profile`, { waitUntil: 'networkidle' });

    // Stale assurance → amber prompt + Re-verify action, and no green Verified badge.
    await expect(page.getByText(/mobile changed/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /re-verify/i })).toBeVisible();
    await expect(page.getByText('Verified ✓')).toHaveCount(0);
  });

  test('saving shows the next-step CTAs', async ({ page }) => {
    await login(page, TENANT);
    await page.goto(`${BASE}/tenant-profile`, { waitUntil: 'networkidle' });
    await page.locator('#tp-name').fill('Yatish Kumar');
    await page.getByRole('button', { name: /save profile/i }).click();
    await expect(page.getByRole('button', { name: /browse rentals/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /back to dashboard/i })).toBeVisible();
  });
});
