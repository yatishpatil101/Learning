// No identity badge is granted: the wizard has no identity gate — posting needs a mobile-verified
// account and nothing more — so granting one would assert a wall the product does not have.
import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';
import { pickFloors, pickPossession } from '../../../helpers/listingForm.helper.js';
// Register a real account and sign it in over HTTP, so the flow renders straight into the form for
// a session the server recognises.
async function gotoForm(page) {
  const mobile = await signedInAsNew(page);
  await page.goto('/list-property');
  await page.waitForSelector('.lp-steps', { timeout: 20000 });
  return mobile;
}
// The portalled menu is `opacity: 0; pointer-events: none` for one frame after opening, so waiting
// on `.is-portal-open` is what makes it genuinely interactive.
async function menuOpen(page) {
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
}

async function pickType(page, label) {
  await pickOption(page, 'propertyType', label);
}

async function pickOption(page, dataErr, label) {
  await page.locator(`[data-err="${dataErr}"]`).click();
  await menuOpen(page);
  await page.locator('.dz-dropdown__option', { hasText: label }).first().click();
}

async function toStep2Flat(page) {
  await gotoForm(page);
  await pickType(page, 'Flat / Apartment');
  await page.locator('input[data-err="carpetArea"]').fill('1200');
  await pickFloors(page);
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.getByRole('heading', { name: 'Location', exact: true }).waitFor({ timeout: 10000 });
}

async function toPricingFlatSale(page) {
  await toStep2Flat(page);
  await pickOption(page, 'locality', 'Baner');
  await page.locator('input[data-err="flatNumber"]').fill('B-1204');
  await page.locator('input[data-err="society"]').fill('Skyline Heights');
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.getByRole('heading', { name: /Price & terms/i }).waitFor({ timeout: 10000 });
}

test('the Location step rejects a blank society and a 000000 pincode, then catches a listing the owner already has', async ({ page }) => {
  test.slow();
  await page.route('**/me/listings/duplicate-check', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ found: true, existingId: null }),
  }));
  await toStep2Flat(page);

  await test.step('an all-spaces society name is treated as empty', async () => {
    const society = page.locator('input[data-err="society"]');
    await society.fill('   ');
    // Leading whitespace is stripped at the source, so the field holds nothing.
    await expect(society).toHaveValue('');
  });

  await test.step('pincode must be a real six-digit code, not 000000', async () => {
    await page.locator('[data-err="locality"]').click();
    await menuOpen(page);
    await page.locator('.dz-dropdown__option').first().click();
    await page.locator('input[data-err="flatNumber"]').fill('B-1204');
    await page.locator('input[data-err="society"]').fill('Skyline Heights');
    await page.locator('input[data-err="pincode"]').fill('000000');
    await page.getByRole('button', { name: /Next Step/i }).click();
    // Rejected: never reaches the pricing step; pincode is flagged.
    await expect(page.getByText('Price & terms')).toHaveCount(0);
    await expect(page.locator('input[data-err="pincode"]')).toHaveClass(/dz-invalid/);
  });

  await test.step('a listing the owner already has is caught on leaving Location, before pricing', async () => {
    await page.locator('input[data-err="pincode"]').fill('411045');
    await page.getByRole('button', { name: /Next Step/i }).click();
    await expect(page.getByText(/already listed this property/i)).toBeVisible();
    await expect(page.getByRole('heading', { name: /Price & terms/i })).toHaveCount(0);
  });
});

test('the photos step rejects contact details in the description, and the preview sheet returns each Edit to its step', async ({ page }) => {
  test.slow();
  await toPricingFlatSale(page);
  await page.locator('input[data-err="price"]').fill('9500000');
  await pickOption(page, 'ownership', 'Freehold');
  await pickPossession(page);
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.getByRole('heading', { name: /Photos & description/i }).waitFor({ timeout: 10000 });
  const description = page.locator('textarea[data-err="description"]');
  const error = page.getByText('Do not include a phone number, email, WhatsApp/social link or handle. Buyers can contact you through Draazy.', { exact: true });

  await test.step('description contact details are rejected inline', async () => {
    await description.fill('Call ९८७६५ ४३२१० for details.');
    await page.getByRole('button', { name: /Submit Property/i }).click();
    await expect(error).toBeVisible();
  });

  await test.step('a WhatsApp link or a spelled-out number in the description is rejected inline', async () => {
    await description.fill('Chat on wa.me/919876543210 for a visit.');
    await page.getByRole('button', { name: /Submit Property/i }).click();
    await expect(error).toBeVisible();

    await description.fill('Call nine eight seven six five four three two one zero.');
    await page.getByRole('button', { name: /Submit Property/i }).click();
    await expect(error).toBeVisible();
  });

  await test.step('the preview sheet shows the key facts and each Edit returns to its step', async () => {
    await description.fill('');
    const bestTime = page.getByRole('radiogroup', { name: 'Best time to call' });
    await expect(bestTime.getByRole('radio', { name: 'Anytime' })).toHaveAttribute('aria-checked', 'true');
    await bestTime.getByRole('radio', { name: /Evening/ }).click();

    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    const preview = page.getByTestId('listing-preview');
    await expect(preview).toContainText('2 BHK Flat in Baner');
    await expect(preview).toContainText('₹95,00,000');
    await expect(preview).toContainText('Skyline Heights');
    await expect(preview).toContainText('Evening (5–9)');
    await expect(preview).not.toContainText('B-1204');

    await page.getByRole('button', { name: 'Edit Price' }).click();
    await expect(preview).toBeHidden();
    await expect(page.getByRole('heading', { name: /Price & terms/i })).toBeVisible();
  });
});
