import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const MOBILE = '9876543210';

// Seed an authenticated + Aadhaar-verified owner so the whole-place flow renders
// straight into the form, past the gate.
async function gotoForm(page) {
  await page.addInitScript((mobile) => {
    localStorage.setItem('puneNestUser', JSON.stringify({
      name: 'Test Owner', mobile, role: 'owner', loginAt: Date.now(),
    }));
    localStorage.setItem('puneNestAadhaar:' + mobile, JSON.stringify({
      verified: true, aadhaarMobile: mobile, at: Date.now(),
    }));
  }, MOBILE);
  await page.goto(`${BASE}/list-property`);
  await page.waitForSelector('.lp-meter', { timeout: 10000 });
}

async function pickType(page, label) {
  await page.locator('[data-err="propertyType"]').click();
  await page.waitForTimeout(200);
  await page.locator('.pn-dropdown__option', { hasText: label }).first().click();
}

test('property-type dropdown lists the canonical types in the new order', async ({ page }) => {
  await gotoForm(page);
  await page.locator('[data-err="propertyType"]').click();
  await page.waitForTimeout(200);
  const options = await page.locator('.pn-dropdown__option').allInnerTexts();
  const cleaned = options.map((o) => o.trim());
  expect(cleaned).toEqual([
    'Flat / Apartment',
    'Independent House',
    'Villa',
    'PG / Hostel',
    'Commercial',
    'Open Plot',
    'Farm Land',
  ]);
});

test('Commercial reveals a required sub-type selector and hides BHK', async ({ page }) => {
  await gotoForm(page);
  await pickType(page, 'Commercial');

  // Sub-type group appears; residential BHK group does not.
  await expect(page.locator('[data-err="commercialType"]')).toBeVisible();
  await expect(page.locator('[data-err="bhk"]')).toHaveCount(0);

  // Sub-type is required: advancing without it flags the field.
  await page.locator('input[data-err="carpetArea"]').fill('1200');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await expect(page.locator('[data-err="commercialType"] .pn-dropdown__trigger.pn-invalid')).toBeVisible();

  // Choosing a sub-type clears the error and reveals commercial-only fields.
  await page.locator('[data-err="commercialType"] .pn-dropdown__trigger').click();
  await page.waitForTimeout(200);
  await page.locator('.pn-dropdown__option', { hasText: 'Warehouse / Godown' }).first().click();
  await expect(page.getByText('Fit-out Status')).toBeVisible();
  await expect(page.getByText('Suitable For')).toBeVisible();
});

test('Commercial Type dropdown shares the Property Type row and Suitable For is a dropdown', async ({ page }) => {
  await gotoForm(page);
  await pickType(page, 'Commercial');

  // Property Type and Commercial Type sit in the same grid — one balanced row.
  const paired = await page.evaluate(() => {
    const pt = document.querySelector('[data-err="propertyType"]');
    const ct = document.querySelector('[data-err="commercialType"]');
    const grid = pt && pt.closest('.grid');
    return !!(grid && ct && grid.contains(ct));
  });
  expect(paired).toBe(true);

  // Commercial Type is now a dropdown (no radio pills inside it).
  await expect(page.locator('[data-err="commercialType"] .pn-dropdown__trigger')).toBeVisible();
  await expect(page.locator('[data-err="commercialType"] .radio-pill')).toHaveCount(0);

  // Suitable For is a multi-select dropdown that keeps multiple choices.
  await page.locator('[data-err="commercialType"] .pn-dropdown__trigger').click();
  await page.waitForTimeout(200);
  await page.locator('.pn-dropdown__option', { hasText: 'Office Space' }).first().click();

  const suitable = page.locator('.pn-dropdown', { has: page.locator('.pn-dropdown__trigger', { hasText: 'Select suitable businesses' }) });
  await suitable.locator('.pn-dropdown__trigger').click();
  await page.waitForTimeout(200);
  await page.locator('.pn-dropdown__option', { hasText: 'Office' }).first().click();
  await page.locator('.pn-dropdown__option', { hasText: 'Retail' }).first().click();
  // Menu stays open for multi-select; both options are marked selected.
  await expect(page.locator('.pn-dropdown__option[aria-selected="true"]')).toHaveCount(2);
});

test('RENT flatmate sub-mode is hidden for Commercial but shown for a flat', async ({ page }) => {
  await gotoForm(page);
  await page.locator('.lp-step').getByText('Rent', { exact: true }).first().click();

  // With no type (defaults to residential) the flatmate choice is offered.
  await expect(page.getByText('What would you like to do?')).toBeVisible();
  await expect(page.getByText('Find a flatmate')).toBeVisible();

  // Switching to Commercial removes the flatmate choice — it only fits a home.
  await pickType(page, 'Commercial');
  await expect(page.getByText('What would you like to do?')).toHaveCount(0);
  await expect(page.getByText('Find a flatmate')).toHaveCount(0);
});

test('Open Plot swaps in land fields and relabels the area', async ({ page }) => {
  await gotoForm(page);
  await pickType(page, 'Open Plot');

  // Area is relabelled and land-only inputs are shown; flat-only ones are hidden.
  await expect(page.getByText('Plot Area *')).toBeVisible();
  await expect(page.getByText('Plot Length')).toBeVisible();
  await expect(page.getByText('Zoning')).toBeVisible();
  await expect(page.locator('[data-err="bhk"]')).toHaveCount(0);
  await expect(page.getByText('Furnishing Status')).toHaveCount(0);
});

test('Independent House keeps BHK and adds plot area + storeys', async ({ page }) => {
  await gotoForm(page);
  await pickType(page, 'Independent House');

  await expect(page.locator('[data-err="bhk"]')).toBeVisible();
  await expect(page.getByText('Plot Area', { exact: true })).toBeVisible();
  await expect(page.getByText('Floors in the House')).toBeVisible();
});

// ---- Step 2 (Location & pricing) type-awareness ----

async function toStep2(page, typeLabel, { deal = 'buy', commercialSubtype } = {}) {
  await gotoForm(page);
  if (deal === 'rent') await page.locator('.lp-step').getByText('Rent', { exact: true }).first().click();
  await pickType(page, typeLabel);
  if (commercialSubtype) {
    await page.locator('[data-err="commercialType"] .pn-dropdown__trigger').click();
    await page.waitForTimeout(200);
    await page.locator('.pn-dropdown__option', { hasText: commercialSubtype }).first().click();
  }
  await page.locator('input[data-err="carpetArea"]').fill('1200');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.getByText('Location & pricing').waitFor({ timeout: 10000 });
}

test('Open Plot sale hides residential-only pricing in Step 2', async ({ page }) => {
  await toStep2(page, 'Open Plot');

  // Ownership stays (land can be freehold/leasehold); society maintenance,
  // sale-type/possession tiles and the home-loan toggle are not shown.
  await expect(page.getByText('Ownership Type *')).toBeVisible();
  await expect(page.getByText('Monthly Maintenance')).toHaveCount(0);
  await expect(page.getByText('Sale Type')).toHaveCount(0);
  await expect(page.getByText('Possession Status')).toHaveCount(0);
  await expect(page.getByText('Home Loan Available')).toHaveCount(0);
});

test('Commercial rent hides tenant/pets fields but keeps lease terms', async ({ page }) => {
  await toStep2(page, 'Commercial', { deal: 'rent', commercialSubtype: 'Office Space' });

  await expect(page.getByText('Preferred Tenants')).toHaveCount(0);
  await expect(page.getByText('Pets Allowed')).toHaveCount(0);
  await expect(page.getByText('Food Preference')).toHaveCount(0);
  // Lease structure still matters for commercial.
  await expect(page.getByText('Agreement Duration')).toBeVisible();
  await expect(page.getByText('Lock-in Period')).toBeVisible();
});

test('Commercial rent offers year-scale lease terms; residential does not', async ({ page }) => {
  await toStep2(page, 'Commercial', { deal: 'rent', commercialSubtype: 'Office Space' });
  // Agreement duration for commercial runs in years, e.g. 5 years / 9 years.
  await page.getByText('Agreement Duration').locator('..').locator('.pn-dropdown__trigger').click();
  await expect(page.locator('.pn-dropdown__option', { hasText: '5 years' })).toBeVisible();
  await expect(page.locator('.pn-dropdown__option', { hasText: '9 years' })).toBeVisible();
  await page.keyboard.press('Escape');

  // A residential rental keeps the short, month-scale terms.
  await toStep2(page, 'Flat / Apartment', { deal: 'rent' });
  await page.getByText('Agreement Duration').locator('..').locator('.pn-dropdown__trigger').click();
  await expect(page.locator('.pn-dropdown__option', { hasText: '11 months' })).toBeVisible();
  await expect(page.locator('.pn-dropdown__option', { hasText: '9 years' })).toHaveCount(0);
});

test('Commercial Step 2 uses business address labels, not flat/society', async ({ page }) => {
  await toStep2(page, 'Commercial', { commercialSubtype: 'Office Space' });

  // Business terminology replaces the residential flat/society wording.
  await expect(page.getByText('Unit / Shop No. *')).toBeVisible();
  await expect(page.getByText('Building / Complex Name *')).toBeVisible();
  await expect(page.getByText('Flat / Unit No. *')).toHaveCount(0);
  await expect(page.getByText('Building / Society Name *')).toHaveCount(0);
});

// ---- Step 3 (Photos & documents) type-awareness ----

async function toStep3Buy(page, typeLabel, { commercialSubtype } = {}) {
  await toStep2(page, typeLabel, { commercialSubtype });
  const land = typeLabel === 'Open Plot' || typeLabel === 'Farm Land';
  await page.locator('[data-err="locality"]').click();
  await page.waitForTimeout(200);
  await page.locator('.pn-dropdown__option').first().click();
  if (!land) {
    await page.locator('input[data-err="flatNumber"]').fill('B-1204');
    await page.locator('input[data-err="society"]').fill('Test Project');
  }
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.locator('input[data-err="price"]').fill('5000000');
  await page.locator('[data-err="ownership"]').click();
  await page.waitForTimeout(200);
  await page.locator('.pn-dropdown__option').first().click();
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.getByText('Photos & documents').waitFor({ timeout: 10000 });
}

test('Open Plot Step 3 swaps in land documents and hides amenities', async ({ page }) => {
  await toStep3Buy(page, 'Open Plot');

  await expect(page.locator('label').filter({ hasText: '7/12 Extract (Satbara)' })).toBeVisible();
  await expect(page.getByText('NA Order / Zone Certificate')).toBeVisible();
  // Society-flavoured residential docs and the amenities picker don't apply to raw land.
  await expect(page.getByText('Society Registration Certificate')).toHaveCount(0);
  await expect(page.getByText('Amenities', { exact: true })).toHaveCount(0);
});

test('Farm Land Step 3 drops NA Order and shows agricultural records', async ({ page }) => {
  await toStep3Buy(page, 'Farm Land');

  // Farm land is agricultural — an NA Order is contradictory and must not appear.
  await expect(page.getByText('NA Order / Zone Certificate')).toHaveCount(0);
  // It carries agricultural land records instead.
  await expect(page.getByText('8A Extract (Holding Record)')).toBeVisible();
  await expect(page.locator('label').filter({ hasText: '7/12 Extract (Satbara)' })).toBeVisible();
});

test('Land offers the 7/12 Extract as its ownership proof, not Index II', async ({ page }) => {
  await toStep3Buy(page, 'Open Plot');

  /* This used to assert that the 7/12 Extract was *mandatory* for land and that submitting without
     it raised "ownership proof required to submit". That gate is gone platform-wide: every document
     is optional now and the ownership proof is flagged `verifies` rather than `required`, because
     it earns the Verified Owner badge instead of blocking the post (see constants.js).
   *
     The land-specific claim underneath it still matters and is what this keeps: land's ownership
     proof is the 7/12 Extract (Satbara), and Index II appears only as the conditional
     "if purchased" entry — getting those two the wrong way round would ask a farmer for a document
     that does not exist for inherited land. */
  await expect(page.locator('label').filter({ hasText: '7/12 Extract (Satbara)' })).toBeVisible();
  await expect(page.getByText('Sale Deed / Index II (if purchased)')).toBeVisible();

  // Optional means optional: submitting with no document raises no document error.
  await page.getByRole('button', { name: /Submit Property/i }).click();
  await expect(page.locator('[data-err="documents"]')).toHaveCount(0);
});

test('Commercial Step 3 shows compliance docs and a business amenity set', async ({ page }) => {
  await toStep3Buy(page, 'Commercial', { commercialSubtype: 'Office Space' });

  await expect(page.getByText('Fire / Trade NOC')).toBeVisible();
  await expect(page.getByText('Amenities', { exact: true })).toBeVisible();
  // Residential-only amenities are filtered out; workspace ones remain.
  await expect(page.getByText('Co-Working Spaces')).toBeVisible();
  await expect(page.getByText('Swimming Pool')).toHaveCount(0);
});

test('Warehouse (industrial) Step 3 shows factory/pollution docs, drops office amenities', async ({ page }) => {
  await toStep3Buy(page, 'Commercial', { commercialSubtype: 'Warehouse / Godown' });

  // Industrial-only compliance documents appear.
  // Every document label now carries a trailing "(optional)" marker, since documents earn a
  // Verified Owner badge rather than gating the post — so `exact` no longer matches. Anchored with
  // a start-of-string regex instead of dropping exactness, which would let "Factory License" match
  // a longer unrelated label.
  await expect(page.getByText('MPCB (Pollution) Consent')).toBeVisible();
  await expect(page.getByText(/^Factory License\b/)).toBeVisible();
  // A godown shouldn't advertise co-working / club-house.
  await expect(page.getByText('Co-Working Spaces')).toHaveCount(0);
  await expect(page.getByText('Club House')).toHaveCount(0);
  await expect(page.getByText('2-Wheeler Parking', { exact: true })).toBeVisible();
  await expect(page.getByText('4-Wheeler Parking', { exact: true })).toBeVisible();
});

test('Shop (retail) Step 3 shows Shop Act licence and no industrial docs', async ({ page }) => {
  await toStep3Buy(page, 'Commercial', { commercialSubtype: 'Shop / Showroom' });

  await expect(page.getByText('Shop Act (Gumasta) License')).toBeVisible();
  await expect(page.getByText('Factory License', { exact: true })).toHaveCount(0);
  // Retail doesn't get the co-working amenity either.
  await expect(page.getByText('Co-Working Spaces')).toHaveCount(0);
});
