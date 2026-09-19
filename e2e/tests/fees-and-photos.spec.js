/* LIVE check for `fees`, `photo` and `pricing` — see `e2e/COVERAGE.md`. Excluded from the default
   run; needs a backend on :8081 under `local,e2e` against `draazy_e2e`. Run it by filename. */
import { test, expect } from '@playwright/test';
import { appReady } from '../helpers/app.js';
import { signedInAs, signedInAsNew } from '../helpers/liveAuth.js';

/* The wizard is behind auth and `/me/photos` is scoped by the caller's token, so this must be a
   real seeded account. */
const OWNER = { mobile: '9470744469', name: 'Meera Deshpande' };

/** The seeded `platform_fees('rent')` row. Changing these means changing the seed, not the test. */
const RENT_FEES = { serviceFee: '₹1,999', gst: '₹360' };

/** A 1×1 PNG. Small enough to be inline, real enough that the server's content sniffing accepts it. */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('Fees — the rent-agreement sidebar prices from the server (live)', () => {
  test('shows the published service fee and GST, not a locally derived pair', async ({ page }) => {
    // `GET /fees` is public (`security: []`), so this runs signed out — which is also the state the
    // visitor it exists to convince is actually in.
    await page.goto('/services/rent-agreement');

    const sidebar = page.locator('aside, [class*="sticky"]').filter({ hasText: /Draazy Service Fee/i }).first();
    await expect(sidebar).toBeVisible({ timeout: 20_000 });

    // The two figures the server owns outright. Neither is derived anywhere in the browser any
    // more, so either one being wrong means the read is not reaching `platform_fees`.
    await expect(sidebar).toContainText(RENT_FEES.serviceFee);
    await expect(sidebar).toContainText(RENT_FEES.gst);

    // And the panel is not in its "charges unavailable" state — which would otherwise let a
    // completely failed read pass a test that only looked for the absence of a wrong number.
    await expect(sidebar).not.toContainText(/couldn't load our current charges/i);
  });

  test('calls the total an estimate, because the statutory pair is NULL by design', async ({ page }) => {
    await page.goto('/services/rent-agreement');

    const sidebar = page.locator('aside, [class*="sticky"]').filter({ hasText: /Draazy Service Fee/i }).first();
    await expect(sidebar).toBeVisible({ timeout: 20_000 });

    // "Estimated Total" is the visible trace of the wizard deriving stamp duty and registration
    // itself, which it must because the published row says NULL for both.
    await expect(sidebar).toContainText(/estimated total/i);
    await expect(sidebar).not.toContainText(/total payable/i);
  });

  /* Both marketing surfaces quoted the bundled `FEE_DEFAULTS` (₹500) for a charge the wizard puts
     at ₹1,999. `/plans` is public; `/refer` is behind `ProtectedRoute`, so it needs a sign-in. */
  test('the pricing page quotes the published fee, not the local default', async ({ page }) => {
    await page.goto('/plans');

    // Asserting the page rather than one node: the figure is interpolated into a translated string
    // in one place and a bare span in the other.
    const body = page.locator('body');
    await expect(body).toContainText(RENT_FEES.serviceFee, { timeout: 20_000 });

    // The stale figure must be gone, not merely joined — a page showing both still quotes a price
    // it does not charge.
    await expect(body).not.toContainText('₹500');
  });

  test('the referral pitch quotes the published fee for the agreement it gives away', async ({ page }) => {
    // Signed in, because `/refer` is protected — and because the reward it advertises is a free
    // rent agreement, so the figure has to be the one the wizard would have charged this account.
    await signedInAs(page, OWNER.mobile);
    await page.goto('/refer');

    const body = page.locator('body');
    await expect(body).toContainText(RENT_FEES.serviceFee, { timeout: 20_000 });
    await expect(body).not.toContainText('₹500');

    // Proof the assertion above ran against the referral page and not a redirect to sign-in, which
    // is the failure mode that produced the first draft's misleading green on the negative half.
    await expect(body).toContainText(/refer/i);
  });
});

test.describe('Photos — the listing wizard uploads to the server (live)', () => {
  test('stores the file through /me/photos and renders the URL the server returned', async ({ page }) => {
    /* A fresh account, not `OWNER`: the seeded owner is over its free-tier allowance, and the
       paywall replaces the wizard this test needs to reach the photo step of. */
    await signedInAsNew(page);

    /* Step 1 is seeded through the draft the wizard restores from, because those answers are radio
       buttons and chips that would take a dozen clicks to say nothing interesting. */
    await page.addInitScript(() => {
      localStorage.setItem('dzDraft:list-property', JSON.stringify({
        propertyType: 'flat', bhk: '2 BHK', bathrooms: '2', carpetArea: '850', deal: 'rent',
      // A tower's floors are answered on step 1, so a draft without them never gets past it.
      floor: '9', totalFloors: '14',
        // `availableFrom` is a `DateField` — a button opening a calendar, not a text input — so it
        // has to arrive through the draft.
        availableFrom: '2026-09-01',
      }));
    });
    await page.goto('/list-property');

    /* `useFormDraft` restores in an effect, so clicking Next straight away races the re-render and
       fails with "element is not stable"; asserting a restored value is the honest wait. */
    await expect(page.locator('input[data-err="carpetArea"]')).toHaveValue('850');

    const next = page.getByRole('button', { name: /Next Step/i });
    await next.click();

    await page.getByRole('combobox', { name: /Search a locality/i }).fill('Baner');
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

    for (const [field, value] of Object.entries(money)) {
      await page.locator(`input[data-err="${field}"]`).fill(value);
    }
    // The money fields render themselves grouped (`32,000`), so compare on digits alone.
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
    await input.setInputFiles({ name: 'living-room.png', mimeType: 'image/png', buffer: PNG_1PX });

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
});

/* `PricingProvider` seeds state with `PRICING_DEFAULTS`, so a browser that never issues the request
   renders the same numbers as one whose request succeeded — hence every test here waits on the
   response rather than asserting a figure. Signed out: `GET /pricing` is `permitAll`. */
test.describe('Pricing — the product quotes the database, not the bundle (live)', () => {
  test('an anonymous visitor gets the published price list', async ({ request }) => {
    const res = await request.get('http://localhost:8081/api/pricing');
    expect(res.status(), 'no token, no session').toBe(200);
    const prices = await res.json();

    /* Asserted as a set: a missing key is not a missing price on screen — `fee()` coerces
       `undefined` to 0 and renders "₹0", which reads as free rather than as broken. */
    expect(Object.keys(prices).sort()).toEqual([
      'featuredListing', 'gstPercent', 'ownerPlanYearly', 'ownerProYearly',
      'rentAgreementPlatform', 'seekerPlusTopup',
    ]);
    for (const [key, value] of Object.entries(prices)) {
      expect(typeof value, `${key} is a number`).toBe('number');
      expect(value, `${key} is positive`).toBeGreaterThan(0);
    }
  });

  test('the plans page renders the figures that request returned, not the bundled fallback', async ({ page }) => {
    /* Armed before the navigation: if the browser never asks, this times out. Rendered text alone
       cannot tell that state apart, because the fallback constant and the seeded row agree. */
    const asked = page.waitForResponse(
      (r) => r.url().includes('/api/pricing') && r.request().method() === 'GET',
      { timeout: 20000 },
    );
    await page.goto('/plans');
    const res = await asked;
    expect(res.status()).toBe(200);
    const prices = await res.json();

    /* Read off the response so this cannot rot into a second copy of the price list. Indian
       grouping is not every-three-digits (2499 → "2,499"), so format as the provider does. */
    const rupees = (n) => '₹' + Number(n).toLocaleString('en-IN');

    /* The FAQ, not a plan card: a card's price is overridden by the `plans` catalogue, so it can be
       right while `usePricing()` is broken. It is in a collapsed <details>, so open it first. */
    const faq = page.locator('details').filter({ hasText: /per year/i }).first();
    await expect(faq).toBeVisible({ timeout: 20000 });
    await faq.locator('summary').click();

    await expect(faq).toContainText(rupees(prices.ownerPlanYearly));
    await expect(faq).toContainText(rupees(prices.ownerProYearly));
  });

  /* Both halves assert a count, not a boolean: "did not fetch" and "fetched twice" are equally
     consistent with waiting for an event, and a deleted fetch is the original bug in disguise. */
  test('the home page never asks for the price list; /plans then asks exactly once', async ({ page }) => {
    let asks = 0;
    page.on('request', (r) => {
      if (r.method() === 'GET' && r.url().includes('/api/pricing')) asks += 1;
    });

    await page.goto('/');
    /* `appReady()` and not `networkidle`: Vite's module graph finishes downloading about a second
       before `main.jsx` evaluates, so `networkidle` would resolve against an empty document. */
    await appReady(page);
    await expect(page.locator('input[role="combobox"]').first()).toBeVisible({ timeout: 20000 });
    expect(asks, 'home renders no price, so it must not fetch the price list').toBe(0);

    /* Armed before the navigation: the request is several hops behind the paint, so a locator wait
       can win the race and assert on a count that is about to become 1. */
    const asked = page.waitForRequest(
      (r) => r.method() === 'GET' && r.url().includes('/api/pricing'),
      { timeout: 20000 },
    );
    await page.goto('/plans');
    await asked;
    await expect(page.locator('details').filter({ hasText: /per year/i }).first())
      .toBeVisible({ timeout: 20000 });
    expect(asks, 'the read is deferred, not deleted — and it happens once').toBe(1);
  });
});
