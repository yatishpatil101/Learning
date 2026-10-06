// LIVE check for `fees`, `photo` and `pricing` — see `e2e/COVERAGE.md`.
import { test, expect } from '@playwright/test';
import { appReady } from '../helpers/app.js';
import { API, apiLogin, authHeaders, ownerIdOf, signedInAs, signedInAsNew, uniqueMobile, uploadedListingPhotos } from '../helpers/liveAuth.js';
import { LIST_PROPERTY_DRAFT_KEY } from '../helpers/listingForm.helper.js';
import { PHOTO_PNG } from '../helpers/listingPhotos.helper.js';

// The wizard is behind auth and `/me/photos` is scoped by the caller's token, so this must be a real seeded account.
const OWNER = { mobile: '9470744469', name: 'Meera Deshpande' };
const ADMIN = '9000000000';

// The admin Fees tab is the only price source; the `pricing` section of `GET /bootstrap` is its
// public projection.
const rupees = (n) => '₹' + Number(n).toLocaleString('en-IN');
const adminPrices = async () => (await (await fetch(`${API}/bootstrap`)).json()).pricing;
const gstOn = (fee, percent) => Math.round((fee * percent) / 100);
// A fee that disagrees with the admin schedule's ₹500, so it must never appear.
const STALE_RENT_FEE = '₹1,999';

async function saveFees(fees) {
  const res = await fetch(`${API}/admin/settings`, {
    method: 'PUT',
    headers: await authHeaders(ADMIN),
    body: JSON.stringify({ fees }),
  });
  if (!res.ok) throw new Error(`saving fees ${JSON.stringify(fees)} failed (${res.status})`);
}

const costSidebar = (page) =>
  page.locator('aside, [class*="sticky"]').filter({ hasText: /Draazy Service Fee/i }).first();
const costRow = (sidebar, label) => sidebar.locator('div.justify-between').filter({ hasText: label }).first();

test.describe('Fees — the rent-agreement sidebar prices from the admin fee schedule (live)', () => {
  test('shows the admin service fee and its GST, and calls the total an estimate', async ({ page }) => {
    const { rentAgreementPlatform: fee, gstPercent } = await adminPrices();
    // `GET /fees` is public, so this runs signed out — the state of the visitor it exists to convince.
    await page.goto('/services/rent-agreement');

    const sidebar = costSidebar(page);
    await expect(sidebar).toBeVisible({ timeout: 20_000 });
    await expect(costRow(sidebar, /^Draazy Service Fee/)).toContainText(rupees(fee));
    await expect(costRow(sidebar, /^GST/)).toContainText(rupees(gstOn(fee, gstPercent)));
    await expect(sidebar).not.toContainText(STALE_RENT_FEE);

    // A failed read must not pass merely by lacking a wrong number.
    await expect(sidebar).not.toContainText(/couldn't load our current charges/i);

    // The visible trace of the wizard deriving stamp duty and registration itself, because the published row says NULL for both.
    await expect(sidebar).toContainText(/estimated total/i);
    await expect(sidebar).not.toContainText(/total payable/i);
  });

  test('a fee repriced in the admin Fees tab is what the wizard quotes', async ({ page }) => {
    const { rentAgreementPlatform: before, gstPercent } = await adminPrices();
    const repriced = 777;
    await saveFees({ rentAgreementPlatform: repriced });
    try {
      await page.goto('/services/rent-agreement');
      const sidebar = costSidebar(page);
      await expect(costRow(sidebar, /^Draazy Service Fee/)).toContainText(rupees(repriced), { timeout: 20_000 });
      await expect(costRow(sidebar, /^GST/)).toContainText(rupees(gstOn(repriced, gstPercent)));
    } finally {
      await saveFees({ rentAgreementPlatform: before });
    }
  });

  test('the referral pitch quotes the admin fee for the agreement it gives away', async ({ page }) => {
    const { rentAgreementPlatform: fee } = await adminPrices();
    await signedInAs(page, OWNER.mobile);
    await page.goto('/refer');

    const body = page.locator('body');
    await expect(body).toContainText(rupees(fee), { timeout: 20_000 });
    await expect(body).not.toContainText(STALE_RENT_FEE);

    // Proves the assertions ran on the referral page, not a sign-in redirect.
    await expect(body).toContainText(/refer/i);
  });
});

test.describe('Photos — the listing wizard uploads to the server (live)', () => {
  test('stores the file through /me/photos and renders the URL the server returned', async ({ page }) => {
    const mobile = await signedInAsNew(page);
    const ownerId = ownerIdOf(await authHeaders(mobile));

    await page.addInitScript(({ key, ownerId }) => {
      localStorage.setItem(key, JSON.stringify({
        propertyType: 'flat', bhk: '2 BHK', bathrooms: '2', carpetArea: '850', deal: 'rent',
      // A tower's floors are answered on step 1, so a draft without them never gets past it.
      floor: '9', totalFloors: '14',
        // `availableFrom` is a `DateField` — a button opening a calendar, not a text input — so it
        // has to arrive through the draft.
        availableFrom: '2026-09-01',
        __owner: ownerId,
      }));
    }, { key: LIST_PROPERTY_DRAFT_KEY, ownerId });
    await page.goto('/list-property');

    // Wait for restored draft state because immediate Next races the effect render.
    await expect(page.locator('input[data-err="carpetArea"]')).toHaveValue('850');

    const next = page.getByRole('button', { name: /Next Step/i });
    await next.click();

    await page.locator('[data-err="location"] input[role="combobox"]').fill('Baner');
    await page.getByRole('button', { name: 'Search location' }).click();

    const address = { flatNumber: 'A-701', society: 'Live Spec Residency', pincode: '411045' };
    const money = { monthlyRent: '32000', deposit: '100000' };
    for (const [field, value] of Object.entries(address)) {
      await page.locator(`input[data-err="${field}"]`).fill(value);
    }
    for (const [field, value] of Object.entries(address)) {
      expect(await page.locator(`input[data-err="${field}"]`).inputValue(),
        `address field ${field} was overwritten`).toBe(value);
    }

    await next.click();

    // The money fields render themselves grouped (`32,000`), so compare on digits alone.
    for (const [field, value] of Object.entries(money)) {
      await page.locator(`input[data-err="${field}"]`).fill(value);
    }
    for (const [field, value] of Object.entries(money)) {
      const actual = await page.locator(`input[data-err="${field}"]`).inputValue();
      expect(actual.replace(/,/g, ''), `pricing field ${field} was overwritten`).toBe(value);
    }

    await next.click();

    // Found by type rather than by a label a redesign would rename; `accept` is a hint only.
    const input = page.locator('input[type="file"][accept*="image"]').first();
    await expect(input).toBeAttached({ timeout: 20_000 });

    const upload = page.waitForResponse(
      (r) => r.url().includes('/me/photos') && r.request().method() === 'POST',
    );
    await input.setInputFiles({ name: 'living-room.png', mimeType: 'image/png', buffer: PHOTO_PNG });

    const res = await upload;
    expect(res.status()).toBe(201);
    const { url } = await res.json();

    // In mock mode `uploadPhoto` returns a `FileReader` data URL that renders perfectly and proves
    // nothing; a URL the server minted cannot be one.
    expect(url).toBeTruthy();
    expect(url.startsWith('data:')).toBe(false);
     expect(url).toMatch(/^\/api\/dev\/storage\/public\//);

     // `toBeVisible`, not merely attached, catches a host the browser cannot load.
     await expect(page.locator(`img[src="${url}"]`).first()).toBeVisible();
  });

  test('a card loads the small JPEG copy the server stored beside the upload, not the original', async ({ page }) => {
    const [url] = await uploadedListingPhotos(await apiLogin(uniqueMobile()));
    await page.goto('/signin');
    const loaded = await page.evaluate(async (original) => {
      const { cardSrcSet } = await import('/src/lib/imgSrcSet.js');
      const img = Object.assign(new Image(), { sizes: '480px', srcset: cardSrcSet(original), src: original });
      await img.decode();
      return { currentSrc: new URL(img.currentSrc).pathname, width: img.naturalWidth };
    }, url);
    expect(loaded.currentSrc.startsWith(`${url}.w`), loaded.currentSrc).toBe(true);
    expect(loaded.currentSrc).toMatch(/\.w(480|960)\.jpg$/);
    expect(loaded.width).toBeGreaterThan(0);
  });
});

// Default pricing can look valid without a request, so tests wait on the response.
test.describe('Pricing — the product quotes the database, not the bundle (live)', () => {
  test('the plans page renders the figures the anonymous bootstrap read returned, not the bundled fallback', async ({ page }) => {
    // Armed before the navigation: if the browser never asks, this times out.
    const asked = page.waitForResponse(
      (r) => r.url().includes('/api/bootstrap') && r.request().method() === 'GET',
      { timeout: 20000 },
    );
    await page.goto('/plans');
    const res = await asked;
    expect(res.status()).toBe(200);
    const prices = (await res.json()).pricing;

    // Keys as a set because a missing fee renders as "₹0", not as missing UI.
    expect(Object.keys(prices).sort()).toEqual([
      'featuredListing', 'gstPercent', 'ownerPlanYearly', 'ownerProYearly',
      'rentAgreementPlatform', 'seekerPlusTopup',
    ]);
    for (const [key, value] of Object.entries(prices)) {
      expect(typeof value, `${key} is a number`).toBe('number');
      expect(value, `${key} is positive`).toBeGreaterThan(0);
    }

    // The page, not one node: the figure sits in a translated string in one place and a bare span in another.
    const body = page.locator('body');
    await expect(body).toContainText(rupees(prices.rentAgreementPlatform), { timeout: 20_000 });
    await expect(body).not.toContainText(STALE_RENT_FEE);

    // The FAQ, in a collapsed <details>, so open it first.
    const faq = page.locator('details').filter({ hasText: /per year/i }).first();
    await expect(faq).toBeVisible({ timeout: 20000 });
    await faq.locator('summary').click();

    await expect(faq).toContainText(rupees(prices.ownerPlanYearly));
    await expect(faq).toContainText(rupees(prices.ownerProYearly));
  });

  test('a plan repriced in the admin Fees tab is what the plan card and the catalogue quote', async ({ page }) => {
    const { ownerPlanYearly: before } = await adminPrices();
    const repriced = 1_234;
    await saveFees({ ownerPlanYearly: repriced });
    try {
      const { plans } = await (await fetch(`${API}/bootstrap`)).json();
      expect(plans.find((p) => p.name === 'Owner Plus')?.price, 'the catalogue charges the admin price').toBe(repriced);

      await page.goto('/plans');
      await expect(page.locator('body')).toContainText(rupees(repriced), { timeout: 20_000 });
    } finally {
      await saveFees({ ownerPlanYearly: before });
    }
  });

  // Count requests so deleted fetches and duplicate fetches both fail.
  test('each page load reads the public reference data exactly once', async ({ page }) => {
    let asks = 0;
    page.on('request', (r) => {
      if (r.method() === 'GET' && r.url().includes('/api/bootstrap')) asks += 1;
    });

    await page.goto('/');
    // Use `appReady()`: `networkidle` can resolve before `main.jsx` evaluates.
    await appReady(page);
    await expect(page.locator('input[role="combobox"]').first()).toBeVisible({ timeout: 20000 });
    await expect.poll(() => asks, { message: 'home boots from one bootstrap read' }).toBe(1);

    await page.goto('/plans');
    await expect(page.locator('details').filter({ hasText: /per year/i }).first())
      .toBeVisible({ timeout: 20000 });
    expect(asks, 'a fresh load reads it again, once').toBe(2);
  });
});
