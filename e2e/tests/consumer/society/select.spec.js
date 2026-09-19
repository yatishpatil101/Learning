import { test, expect } from '@playwright/test';
import { API, signedInAs } from '../../../helpers/liveAuth.js';
import { pickFloors } from '../../../helpers/listingForm.helper.js';

// Society "select or create" typeahead on the list-property Location step: a listing must bind to
// a real society entity, and an unknown name must mint a community society.

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const MOBILE = '9876543211';

/**
 * `/list-property` is behind `ProtectedRoute`, so a real OTP sign-in is required: a localStorage
 * user without a token is nulled by `GET /auth/me` and the route redirects to `/signin`.
 */
async function gotoForm(page) {
  await signedInAs(page, MOBILE);
  await page.goto(`${BASE}/list-property`);
  await page.waitForSelector('.lp-meter', { timeout: 10000 });
}

async function toStep2Flat(page) {
  await gotoForm(page);
  await page.locator('[data-err="propertyType"]').click();
  /* `Select` portals its menu and only flips `portalOpen` one requestAnimationFrame after the open
     (Select.jsx:178); until then it is `opacity: 0; pointer-events: none` (dropdown.css:198). */
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
  await page.locator('.dz-dropdown__option', { hasText: 'Flat / Apartment' }).first().click();
  await page.locator('input[data-err="carpetArea"]').fill('1200');
  await pickFloors(page);
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.getByRole('heading', { name: 'Location', exact: true }).waitFor({ timeout: 10000 });
}

test('typing a known name lists the verified society and binds it on pick', async ({ page }) => {
  await toStep2Flat(page);
  const society = page.locator('input[data-err="society"]');
  await society.click();
  await society.fill('Skyline');
  const option = page.locator('.dz-dropdown__option', { hasText: 'Skyline Heights' }).first();
  await expect(option).toBeVisible();
  await expect(option.getByText('Verified')).toBeVisible();
  await option.click();
  await expect(society).toHaveValue('Skyline Heights');
  await expect(page.getByText(/Verified society/i)).toBeVisible();
});

/**
 * The read-back is made by `request`, a different HTTP client with no access to the page's storage:
 * a spec inspecting the browser that wrote cannot tell a local mint from a shared one.
 */
test('an unknown name can be added inline and reaches the shared catalogue', async ({ page, request }) => {
  await toStep2Flat(page);
  const society = page.locator('input[data-err="society"]');
  // Unique per run: `POST /societies` is a mint-or-match, so a fixed name would read back an
  // earlier run's row and the `mintOrigin` assertion below would be about that row instead.
  const NAME = `Zz Live Select ${Date.now().toString(36)}`;
  await society.click();
  await society.fill(NAME);
  const addRow = page.getByTestId('society-add-option');
  await expect(addRow).toBeVisible();
  await addRow.click();
  await expect(society).toHaveValue(NAME);
  await expect(page.getByText(/pending verification/i)).toBeVisible();

  // Outside the browser: an anonymous reader searching the catalogue finds the building.
  const found = await request.get(`${API}/societies`, { params: { q: NAME, size: 20 } });
  expect(found.status()).toBe(200);
  const row = (await found.json()).content.find((s) => s.name === NAME);
  expect(row, 'the minted society is absent from the catalogue — the write never left the browser').toBeTruthy();
  expect(row.source).toBe('community');
  expect(row.verifiedAt).toBeNull();
  expect(row.mintOrigin).toBe('listing');
});
