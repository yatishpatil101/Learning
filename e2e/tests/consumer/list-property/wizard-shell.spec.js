import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';
import { pickFloors, pickPossession } from '../../../helpers/listingForm.helper.js';
import { uploadPublishablePhotos } from '../../../helpers/listingPhotos.helper.js';

async function gotoForm(page) {
  await signedInAsNew(page);
  await page.goto('/list-property');
  await page.waitForSelector('.lp-steps', { timeout: 20000 });
}

async function menuOpen(page) {
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
}

async function pickOption(page, dataErr, label) {
  await page.locator(`[data-err="${dataErr}"]`).click();
  await menuOpen(page);
  await page.getByRole('option', { name: label, exact: true }).click();
}

async function toLocation(page) {
  await gotoForm(page);
  await pickOption(page, 'propertyType', 'Flat / Apartment');
  await page.locator('input[data-err="carpetArea"]').fill('1200');
  await pickFloors(page);
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.getByRole('heading', { name: 'Location', exact: true }).waitFor({ timeout: 10000 });
}

async function toPricing(page) {
  await toLocation(page);
  await pickOption(page, 'locality', 'Baner');
  await page.locator('input[data-err="flatNumber"]').fill('B-1204');
  await page.locator('input[data-err="society"]').fill('Shell Homes');
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.getByRole('heading', { name: /Price & terms/i }).waitFor({ timeout: 10000 });
}

test('the wizard shell: mobile meter, strength climbing per tab, server validation reopening its step, and success staying until the owner acts', async ({ page }) => {
  test.slow();
  const pct = async () => Number((await page.locator('.lp-meter__pct').innerText()).replace(/\D/g, ''));
  const fill = async () => page.locator('.lp-meter__fill').evaluate((el) => parseFloat(el.style.width));
  let posts = 0;
  await page.route('**/api/me/listings/duplicate-check', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ found: false }),
  }));
  await page.route('**/api/me/listings', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    posts += 1;
    if (posts === 1) {
      return route.fulfill({
        status: 422,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'validation_failed',
          message: 'Validation failed',
          fields: [{ field: 'price', message: 'Expected price is required' }],
        }),
      });
    }
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ id: `LP-shell-${Date.now()}`, status: 'pending', propertyType: 'Flat', deal: 'buy', price: 9500000 }),
    });
  });

  await page.setViewportSize({ width: 390, height: 740 });
  await gotoForm(page);

  await test.step('mobile progress shows in full', async () => {
    const meter = page.locator('.lp-meter');
    await expect(meter.locator('.lp-meter__cheer')).toBeVisible();
    await expect(meter.locator('.lp-meter__track')).toBeVisible();
    await expect(meter.getByRole('button')).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  const start = await pct();
  await toPricing(page);
  const atPricing = await pct();

  await test.step('listing strength keeps climbing as the owner moves through the tabs', async () => {
    expect(atPricing).toBeGreaterThan(start);
    await page.locator('input[data-err="price"]').fill('9500000');
    await pickOption(page, 'ownership', 'Freehold');
    await pickPossession(page);
    await expect(page.locator('.lp-meter__pct')).not.toHaveText(`${atPricing}%`);
    const priced = await pct();
    expect(priced).toBeGreaterThan(atPricing);
    expect(await fill()).toBe(priced);
    await expect(page.locator('.lp-meter__node.reached')).toHaveCount(Math.floor(priced / 20));
  });

  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.getByRole('heading', { name: /Photos & description/i }).waitFor({ timeout: 10000 });
  await uploadPublishablePhotos(page);

  await test.step('server validation fields open their step instead of showing only a toast', async () => {
    await page.getByRole('button', { name: /Submit Property/i }).click();
    await expect(page.getByRole('heading', { name: /Price & terms/i })).toBeVisible();
    await expect(page.locator('input[data-err="price"]')).toHaveClass(/dz-invalid/);
  });

  await test.step('success stays until the owner chooses the next action', async () => {
    await page.getByRole('button', { name: /Next Step/i }).click();
    await page.getByRole('heading', { name: /Photos & description/i }).waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: /Submit Property/i }).click();

    await expect(page.getByRole('heading', { name: /Submitted for review/i })).toBeVisible();
    await page.waitForTimeout(3600);
    await expect(page).toHaveURL(/\/list-property/);
    await expect(page.getByRole('button', { name: /Go to My Listings/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Post another/i })).toBeVisible();
  });
});

test('dirty in-app navigation asks before leaving and can stay', async ({ page }) => {
  await gotoForm(page);
  await page.locator('input[data-err="carpetArea"]').fill('1200');
  await page.getByRole('link', { name: 'Buy', exact: true }).click();

  await expect(page.getByRole('dialog', { name: 'Leave this listing?' })).toBeVisible();
  await page.getByRole('button', { name: 'Stay' }).click();
  await expect(page).toHaveURL(/\/list-property/);
});
