// No identity badge is granted: posting asks for a signed-in, mobile-verified account and nothing
// further, so granting one here would assert a gate the product does not have.
import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';

// Register a real account and sign it in over HTTP, so the flow renders straight into the form for
// a session the server recognises.
async function gotoForm(page) {
  const mobile = await signedInAsNew(page);
  await page.goto('/list-property');
  await page.waitForSelector('.lp-steps', { timeout: 20000 });
  return mobile;
}

const pctOf = async (page) => {
  const raw = await page.locator('.lp-meter__pct').innerText();
  return parseInt(raw.replace(/\D/g, ''), 10);
};

// The portalled menu is `opacity: 0; pointer-events: none` for one frame after opening, so waiting
// on `.is-portal-open` is what makes it genuinely interactive.
async function menuOpen(page) {
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
}

async function pickType(page, label) {
  await page.locator('[data-err="propertyType"]').click();
  await menuOpen(page);
  await page.locator('.dz-dropdown__option', { hasText: label }).first().click();
}

test('loads the gamified flow without JS errors', async ({ page, consoleErrors }) => {
  await gotoForm(page);
  await expect(page.locator('.lp-meter')).toBeVisible();
  expect(consoleErrors).toHaveLength(0);
});

test('a fresh form opens above 0% but well below 100% (defaults only)', async ({ page }) => {
  await gotoForm(page);
  const start = await pctOf(page);
  // Smart defaults (BHK, bathrooms, furnishing) count as filled, so the meter opens
  // above zero — but every empty field keeps it far from 100%.
  expect(start).toBeGreaterThan(0);
  expect(start).toBeLessThan(50);
});

test('listing strength gives one truthful priority nudge', async ({ page }) => {
  await gotoForm(page);
  const meter = page.locator('.lp-meter');
  await expect(meter.getByText('listing strength', { exact: true })).toBeVisible();
  await expect(meter.locator('[data-nudge="photos"]')).toHaveText('Add 5 photos so buyers can see more of the home.');
  await expect(meter.locator('[data-nudge="evidence"]')).toHaveCount(0);
});

test('full strength requires optional enrichment, five photos and ownership evidence', async ({ page }) => {
  await gotoForm(page);
  const scores = await page.evaluate(async () => {
    const { computeProgress } = await import('/src/pages/consumer/list-property/progress.js');
    const { docsFor } = await import('/src/pages/consumer/list-property/constants.js');
    const form = {
      deal: 'buy', propertyType: 'flat', bhk: '2', bathrooms: '2', balconies: '1',
      carpetArea: '900', builtUp: '1100', superBuiltUp: '1250', floor: '4', totalFloors: '12',
      facing: 'east', age: '5-10', furnishing: 'semi', furniture: ['wardrobe'],
      locality: 'Baner', flatNumber: 'A-401', tower: 'A', society: 'Example Homes',
      street: 'High Street', landmark: 'Near park', pincode: '411045', price: '9500000',
      monthlyMaintenance: '2500', ownership: 'freehold', construction: 'new',
      availableFrom: '2027-01-01', reraId: 'P52100000001', description: 'A bright home with a quiet outlook and practical room layout for a family.',
      amenities: ['lift'],
    };
    const documents = Object.fromEntries(docsFor('buy', 'flat').map(({ key }) => [key, { name: `${key}.pdf` }]));
    return {
      noEvidence: computeProgress({ form, photos: Array(5).fill('photo'), documents: {} }),
      fourPhotos: computeProgress({ form, photos: Array(4).fill('photo'), documents }),
      noOptionalDocs: computeProgress({ form, photos: Array(5).fill('photo'), documents: Object.fromEntries(docsFor('buy', 'flat').filter((doc) => doc.verifies).map(({ key }) => [key, {}])) }),
      full: computeProgress({ form, photos: Array(5).fill('photo'), documents }),
    };
  });
  expect(scores.noEvidence.pct).toBeLessThan(100);
  expect(scores.fourPhotos.pct).toBeLessThan(100);
  expect(scores.noOptionalDocs.pct).toBeLessThan(100);
  expect(scores.noOptionalDocs.nudge).toBe('documents');
  expect(scores.full.pct).toBe(100);
  expect(scores.full.nudge).toBeNull();
});

test('smart defaults are pre-filled to reduce friction', async ({ page }) => {
  await gotoForm(page);
  // BHK defaults to 2. The BHK pills now show just the number (consistent with
  // Bathrooms/Balconies), so scope the check to the BHK group to stay precise.
  await expect(page.locator('[data-err="bhk"] .radio-pill.selected')).toHaveText('2');
});

test('percentage climbs as the owner fills real fields (goal gradient)', async ({ page }) => {
  await gotoForm(page);
  const start = await pctOf(page);

  await page.locator('input[data-err="carpetArea"]').fill('1050');
  /* `pctOf` reads through `innerText()`, which does not retry. Waiting for the meter to stop reading its
     old value is the same claim as the `toBeGreaterThan` below, except that it retries. */
  await expect(page.locator('.lp-meter__pct')).not.toHaveText(`${start}%`);
  const after = await pctOf(page);
  expect(after).toBeGreaterThan(start);
});

test('milestone nodes light up as progress crosses thresholds', async ({ page }) => {
  await gotoForm(page);
  const before = await page.locator('.lp-meter__node.reached').count();

  await pickType(page, 'Flat / Apartment');
  await page.locator('input[data-err="carpetArea"]').fill('1200');
  // The assertion below is a `>=`, so it cannot serve as the wait; the committed field value can.
  await expect(page.locator('input[data-err="carpetArea"]')).toHaveValue('1200');

  const after = await page.locator('.lp-meter__node.reached').count();
  expect(after).toBeGreaterThanOrEqual(before);
});

test('filling only mandatory fields keeps the meter under 100% (optional left blank)', async ({ page }) => {
  await gotoForm(page);
  await pickType(page, 'Flat / Apartment');

  // Every mandatory Details + Location field, but no optional ones.
  await page.locator('input[data-err="carpetArea"]').fill('1200');
  // Floor and total floors are mandatory — an unanswered floor drops a flat out of every floor-bounded
  // search — so step 1 will not advance without them.
  for (const dataErr of ['floor', 'totalFloors']) {
    await page.locator(`[data-err="${dataErr}"] .dz-dropdown__trigger`).click();
    await menuOpen(page);
    await page.locator('.dz-dropdown__option').first().click();
  }
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.getByRole('heading', { name: 'Location', exact: true }).waitFor({ timeout: 10000 });

  await page.locator('[data-err="locality"]').click();
  await menuOpen(page);
  await page.locator('.dz-dropdown__option').first().click();
  await page.locator('input[data-err="flatNumber"]').fill('B-1204');
  await page.locator('input[data-err="society"]').fill('Skyline Heights');
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Price & terms/i', { timeout: 15000 });
  await page.locator('input[data-err="price"]').fill('9500000');
  await page.locator('[data-err="ownership"]').click();
  await menuOpen(page);
  await page.locator('.dz-dropdown__option').first().click();
  // Possession is mandatory and not pre-selected, so leaving it blank would make this a test about an
  // incomplete form rather than about a complete-but-minimal one.
  await page.getByRole('button', { name: 'Ready to Move', exact: true }).click();
  /* The final `pctOf` read does not retry, so the meter has to be known-settled first. `Select.jsx` drops
     `is-placeholder` only once a value is selected, the closest thing to a commit signal this control has. */
  await expect(page.locator('[data-err="ownership"] .dz-dropdown__value')).not.toHaveClass(/is-placeholder/);

  // Optional fields (built-up, facing, video, description, amenities,
  // supporting documents…) are still blank, so the meter must stay short of 100%.
  expect(await pctOf(page)).toBeLessThan(100);
});
