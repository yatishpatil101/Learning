import { test, expect } from '@playwright/test';

/* "Verified by PuneNest" legal-scope + due-diligence acknowledgement.
   - The Verification & Docs tab must carry a conspicuous scope disclaimer that links to /disclaimer.
   - On a SALE listing, "Request to view documents" is gated behind an acknowledgement checkbox and
     records that the buyer will verify independently.
   - A RENT listing shows the deal-appropriate notice (no request action). */

const SALE_FLAT = 'P5013';   // 1 BHK Flat in Baner (buy)
const RENT_FLAT = 'P5014';   // 3 BHK Penthouse (rent)
const BUYER = '9876543210';

async function seedSignedIn(page) {
  await page.addInitScript((buyer) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Test Buyer', mobile: buyer, role: 'buyer', loginAt: Date.now() }));
    localStorage.setItem('puneNestAadhaar:' + buyer, JSON.stringify({ verified: true, aadhaarMobile: buyer, at: Date.now() }));
  }, BUYER);
}

async function openTrustTab(page, id) {
  await page.goto(`/property/${id}`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: /Verification & Docs/i }).waitFor({ state: 'visible', timeout: 15000 });
  await page.getByRole('tab', { name: /Verification & Docs/i }).click();
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelectorAll('.reveal,.fade-up,.fade-in').forEach((el) => el.classList.add('visible')));
}

test('SALE trust tab shows the verification-scope disclaimer linking to the full Disclaimer', async ({ page }) => {
  await seedSignedIn(page);
  await openTrustTab(page, SALE_FLAT);

  const notice = page.getByText(/What .Verified by PuneNest. means/i).first();
  await expect(notice).toBeVisible();
  await expect(page.getByText(/independent legal due diligence/i).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /Read the full Disclaimer/i }).first()).toHaveAttribute('href', '/disclaimer');
});

test('SALE "Request to view documents" is gated behind the due-diligence acknowledgement', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  await seedSignedIn(page);
  await openTrustTab(page, SALE_FLAT);

  const btn = page.getByRole('button', { name: /Request to view documents/i });
  await expect(btn).toBeVisible();
  await expect(btn).toBeDisabled();

  await page.getByText(/independently verify these documents/i).click();
  await expect(btn).toBeEnabled();

  await btn.click();
  await expect(page.getByText(/verify them independently before finalizing/i)).toBeVisible({ timeout: 5000 });

  // The recorded doc request carries the acknowledgement flag (scan all owner buckets).
  const acked = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('puneNestDocReq:')) continue;
      const reqs = JSON.parse(localStorage.getItem(k) || '[]');
      if (reqs.some((r) => r.acknowledgedDisclaimer === true && r.ackAt)) return true;
    }
    return false;
  });
  expect(acked).toBe(true);

  expect(errors.filter((e) => !/favicon|leaflet|tile|net::ERR|unsplash|maptiler|openstreetmap/i.test(e))).toEqual([]);
});

test('RENT trust tab shows the deal-appropriate verification notice', async ({ page }) => {
  await seedSignedIn(page);
  await openTrustTab(page, RENT_FLAT);
  await expect(page.getByText(/What .Verified by PuneNest. means/i).first()).toBeVisible();
  await expect(page.getByText(/leave-.-license agreement/i).first()).toBeVisible();
});
