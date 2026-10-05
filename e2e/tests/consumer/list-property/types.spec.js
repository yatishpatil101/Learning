/* The account is registered over HTTP with a real JWT, so these branching assertions also stand for
 * a session the server recognises. No identity badge: the wizard has no identity gate. */
import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';
async function gotoForm(page) {
  const mobile = await signedInAsNew(page);
  await page.goto('/list-property');
  await page.waitForSelector('.lp-steps', { timeout: 20000 });
  return mobile;
}
/* `Select.jsx` portals its menu and flips `portalOpen` a frame late, so until `.is-portal-open`
 * lands the menu is `pointer-events: none`; waiting on the class fails loudly, a sleep does not. */
async function menuOpen(page) {
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
}

async function pickType(page, label) {
  await page.locator('[data-err="propertyType"]').click();
  // Load-bearing, not decorative: `allInnerTexts()` does not retry, so against an unopened menu it
  // returns `[]` and the comparison below would fail with a confusing empty-array diff.
  await menuOpen(page);
  await page.locator('.dz-dropdown__option', { hasText: label }).first().click();
}

test('the first step branches on property type: dropdown order, Commercial, Open Plot, Independent House, and rent flatmate mode', async ({ page }) => {
  test.slow();
  await gotoForm(page);

  await test.step('the property-type dropdown lists the canonical types in the new order', async () => {
    await page.locator('[data-err="propertyType"]').click();
    await menuOpen(page);
    const options = await page.locator('.dz-dropdown__option').allInnerTexts();
    expect(options.map((o) => o.trim())).toEqual([
      'Flat / Apartment',
      'Independent House',
      'Villa',
      'Commercial',
      'Open Plot',
      'Farm Land',
    ]);
    await page.keyboard.press('Escape');
  });

  await test.step('Open Plot swaps in land fields and relabels the area', async () => {
    await pickType(page, 'Open Plot');
    await expect(page.getByText('Plot Area *')).toBeVisible();
    await expect(page.getByText('Plot Length')).toBeVisible();
    await expect(page.getByText('Zoning')).toBeVisible();
    await expect(page.locator('[data-err="bhk"]')).toHaveCount(0);
    await expect(page.getByText('Furnishing Status')).toHaveCount(0);
  });

  await test.step('Independent House keeps BHK and adds plot area + storeys', async () => {
    await pickType(page, 'Independent House');
    await expect(page.locator('[data-err="bhk"]')).toBeVisible();
    await expect(page.getByText('Plot Area', { exact: true })).toBeVisible();
    await expect(page.getByText('Floors in the House')).toBeVisible();
  });

  await test.step('Commercial reveals a required sub-type selector and hides BHK', async () => {
    await pickType(page, 'Commercial');
    await expect(page.locator('[data-err="commercialType"]')).toBeVisible();
    await expect(page.locator('[data-err="bhk"]')).toHaveCount(0);
    // Sub-type is required: advancing without it flags the field.
    await page.locator('input[data-err="carpetArea"]').fill('1200');
    await page.getByRole('button', { name: /Next Step/i }).click();
    await expect(page.locator('[data-err="commercialType"] .dz-dropdown__trigger.dz-invalid')).toBeVisible();

    await page.locator('[data-err="commercialType"] .dz-dropdown__trigger').click();
    await menuOpen(page);
    await page.locator('.dz-dropdown__option', { hasText: 'Warehouse / Godown' }).first().click();
    /* Scoped to the labels: the Next Step above left the fit-out requirement unanswered, so its
       validation message is on screen too, and `getByText` matches a substring case-insensitively. */
    await expect(page.locator('label', { hasText: 'Fit-out Status' })).toBeVisible();
    await expect(page.locator('label', { hasText: 'Suitable For' })).toBeVisible();
  });

  await test.step('Commercial Type dropdown shares the Property Type row and Suitable For is a dropdown', async () => {
    const paired = await page.evaluate(() => {
      const pt = document.querySelector('[data-err="propertyType"]');
      const ct = document.querySelector('[data-err="commercialType"]');
      const grid = pt && pt.closest('.grid');
      return !!(grid && ct && grid.contains(ct));
    });
    expect(paired).toBe(true);

    await expect(page.locator('[data-err="commercialType"] .dz-dropdown__trigger')).toBeVisible();
    await expect(page.locator('[data-err="commercialType"] .radio-pill')).toHaveCount(0);

    await page.locator('[data-err="commercialType"] .dz-dropdown__trigger').click();
    await menuOpen(page);
    await page.locator('.dz-dropdown__option', { hasText: 'Office Space' }).first().click();

    const suitable = page.locator('.dz-dropdown', { has: page.locator('.dz-dropdown__trigger', { hasText: 'Select suitable businesses' }) });
    await suitable.locator('.dz-dropdown__trigger').click();
    await menuOpen(page);
    await page.locator('.dz-dropdown__option', { hasText: 'Office' }).first().click();
    // Scoped to the workspace profile: an office is not offered Retail, so pick its neighbour.
    await page.locator('.dz-dropdown__option', { hasText: 'Clinic' }).first().click();
    await expect(page.locator('.dz-dropdown__option[aria-selected="true"]')).toHaveCount(2);
    await page.keyboard.press('Escape');
  });

  await test.step('RENT flatmate sub-mode is hidden for Commercial but shown for a flat', async () => {
    await page.locator('.lp-step').getByText('Rent', { exact: true }).first().click();
    await pickType(page, 'Flat / Apartment');
    await expect(page.getByText('What would you like to do?')).toBeVisible();
    await expect(page.getByText('Find a flatmate')).toBeVisible();

    await pickType(page, 'Commercial');
    await expect(page.getByText('What would you like to do?')).toHaveCount(0);
    await expect(page.getByText('Find a flatmate')).toHaveCount(0);
  });
});

async function toLocation(page, typeLabel, { deal = 'buy', commercialSubtype } = {}) {
  await gotoForm(page);
  await page.locator('.lp-step').getByText(deal === 'rent' ? 'Rent' : 'Sale', { exact: true }).first().click();
  await pickType(page, typeLabel);
  if (['Flat / Apartment', 'Independent House', 'Villa'].includes(typeLabel)) {
    await page.locator('[data-err="bhk"]').getByRole('button', { name: '2', exact: true }).click();
  }
  if (commercialSubtype) {
    await page.locator('[data-err="commercialType"] .dz-dropdown__trigger').click();
    await menuOpen(page);
    await page.locator('.dz-dropdown__option', { hasText: commercialSubtype }).first().click();
    // Fit-out sets the rent and is the first filter every enquiry applies, so the step will not
    // advance without it.
    await page.locator('[data-err="shellType"]').getByText('Warm Shell', { exact: true }).click();
  }
  await page.locator('input[data-err="carpetArea"]').fill('1200');
  for (const [dataErr, value] of [['floor', '9'], ['totalFloors', '14']]) {
    const trigger = page.locator(`[data-err="${dataErr}"] .dz-dropdown__trigger`);
    if (!await trigger.count()) continue;
    await trigger.click();
    await menuOpen(page);
    await page.getByRole('option', { name: value, exact: true }).click();
  }
  for (const dataErr of ['naStatus', 'otherRights', 'buyerEligibility']) {
    const trigger = page.locator(`[data-err="${dataErr}"] .dz-dropdown__trigger`);
    if (!await trigger.count()) continue;
    await trigger.click();
    await menuOpen(page);
    await page.locator('.dz-dropdown__option').first().click();
  }
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.getByRole('heading', { name: 'Location', exact: true }).waitFor({ timeout: 10000 });
}
/* Land is never asked for a unit, and neither is a standalone industrial shed. Driven by what the step renders
 * rather than a list of type labels, so a profile that drops a field is not remembered here twice. */
async function fillAddress(page) {
  await page.locator('[data-err="locality"]').click();
  await menuOpen(page);
  await page.locator('.dz-dropdown__option').first().click();
  for (const [dataErr, value] of [['flatNumber', 'B-1204'], ['society', 'Test Project']]) {
    const input = page.locator(`input[data-err="${dataErr}"]`);
    if (await input.count()) await input.fill(value);
  }
  await page.locator('input[data-err="pincode"]').fill('411045');
}

async function toPricing(page, typeLabel, options = {}) {
  await toLocation(page, typeLabel, options);
  await fillAddress(page);
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Price & terms/i', { timeout: 15000 });
}

test('society picker waits for typing to pause before requesting candidates', async ({ page }) => {
  const queries = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/societies') queries.push(url.searchParams.get('q'));
  });

  await toLocation(page, 'Flat / Apartment');
  expect(queries, 'a closed society picker must not load candidates').toEqual([]);

  await page.locator('input[data-err="society"]').pressSequentially('Skyline', { delay: 20 });
  await expect.poll(() => queries.length, { timeout: 5000 }).toBe(1);
  expect(queries).toEqual(['Skyline']);

  const society = page.locator('input[data-err="society"]');
  await society.press('Escape');
  await society.press('ArrowDown');
  expect(await page.getByTestId('society-add-option').count()).toBe(0);
  await expect.poll(() => queries.length, { timeout: 5000 }).toBe(2);
});

test('Open Plot sale hides residential-only pricing', async ({ page }) => {
  await toPricing(page, 'Open Plot');

  await expect(page.getByText('Ownership Type *')).toBeVisible();
  await expect(page.getByText('Monthly Maintenance')).toHaveCount(0);
  await expect(page.getByText('Sale Type')).toHaveCount(0);
  await expect(page.getByText('Possession Status')).toHaveCount(0);
  await expect(page.getByText('Home Loan Available')).toHaveCount(0);
});

test('Commercial rent: business address labels, no tenant/pets fields, year-scale lease terms (residential keeps months)', async ({ page }) => {
  test.slow();
  await toLocation(page, 'Commercial', { deal: 'rent', commercialSubtype: 'Office Space' });

  await test.step('Commercial address labels are business terms, not flat/society', async () => {
    await expect(page.getByText('Unit / Shop No. *')).toBeVisible();
    await expect(page.getByText('Building / Complex Name *')).toBeVisible();
    await expect(page.getByText('Flat / Unit No. *')).toHaveCount(0);
    await expect(page.getByText('Building / Society Name *')).toHaveCount(0);
  });

  await fillAddress(page);
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Price & terms/i', { timeout: 15000 });

  await test.step('Commercial rent hides tenant/pets fields but keeps lease terms', async () => {
    await expect(page.getByText('Preferred Tenants')).toHaveCount(0);
    await expect(page.getByText('Pets Allowed')).toHaveCount(0);
    await expect(page.getByText('Food Preference')).toHaveCount(0);
    await expect(page.getByText('Agreement Duration')).toBeVisible();
    await expect(page.getByText('Lock-in Period')).toBeVisible();
  });

  await test.step('Commercial rent offers year-scale lease terms; residential does not', async () => {
    await expect(page.getByText('Agreement Duration').locator('..').locator('.dz-dropdown__trigger')).toContainText('1 year');
    await page.getByText('Agreement Duration').locator('..').locator('.dz-dropdown__trigger').click();
    await expect(page.locator('.dz-dropdown__option', { hasText: '5 years' })).toBeVisible();
    await expect(page.locator('.dz-dropdown__option', { hasText: '9 years' })).toBeVisible();
    await page.keyboard.press('Escape');
    // A residential rental keeps the short, month-scale terms — behind the Change affordance, since
    // the default set is the one most owners never touch.
    await toPricing(page, 'Flat / Apartment', { deal: 'rent' });
    await page.getByRole('button', { name: 'Change rental terms', exact: true }).click();
    await page.getByText('Agreement Duration').locator('..').locator('.dz-dropdown__trigger').click();
    await expect(page.locator('.dz-dropdown__option', { hasText: '11 months' })).toBeVisible();
    await expect(page.locator('.dz-dropdown__option', { hasText: '9 years' })).toHaveCount(0);
  });
});

async function toUploadsBuy(page, typeLabel, { commercialSubtype } = {}) {
  await toPricing(page, typeLabel, { commercialSubtype });
  const land = typeLabel === 'Open Plot' || typeLabel === 'Farm Land';
  await page.locator('input[data-err="price"]').fill('5000000');
  await page.locator('[data-err="ownership"]').click();
  await menuOpen(page);
  await page.locator('.dz-dropdown__option').first().click();
  // Land is never asked; everything else must answer before the step will advance.
  if (typeLabel === 'Open Plot') await page.locator('[data-err="plottedProject"]').getByRole('button', { name: 'No', exact: true }).click();
  else if (!land) await page.getByRole('button', { name: 'Ready to Move', exact: true }).click();
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.getByText('Photos & description').waitFor({ timeout: 10000 });
}

test('Open Plot photo step hides amenities and asks for no ownership papers', async ({ page }) => {
  await toUploadsBuy(page, 'Open Plot');

  await expect(page.getByText('7/12 extract')).toHaveCount(0);
  /* Farm land is asked the same NA question a plot is, so a sanctioned claim must have somewhere to
     go — a claim with nowhere to upload it is a claim nobody can check. */
  await expect(page.getByText('Amenities', { exact: true })).toHaveCount(0);
  // Optional means optional: submitting with no document raises no document error.
  await page.getByRole('button', { name: /Submit Property/i }).click();
  await expect(page.locator('[data-err="documents"]')).toHaveCount(0);
});

test('Commercial uploads show a business amenity set', async ({ page }) => {
  await toUploadsBuy(page, 'Commercial', { commercialSubtype: 'Office Space' });

  await expect(page.locator('label').filter({ hasText: /^Amenities$/ })).toBeVisible();
  await expect(page.getByText('Co-Working Spaces')).toBeVisible();
  await expect(page.getByText('Swimming Pool')).toHaveCount(0);
});

test('Warehouse (industrial) uploads drop office amenities', async ({ page }) => {
  await toUploadsBuy(page, 'Commercial', { commercialSubtype: 'Warehouse / Godown' });

  await expect(page.getByText('Co-Working Spaces')).toHaveCount(0);
  await expect(page.getByText('Club House')).toHaveCount(0);
  await expect(page.getByText('2-Wheeler Parking', { exact: true })).toBeVisible();
  await expect(page.getByText('4-Wheeler Parking', { exact: true })).toBeVisible();
});

test('Shop (retail) uploads drop the co-working amenity', async ({ page }) => {
  await toUploadsBuy(page, 'Commercial', { commercialSubtype: 'Shop / Showroom' });

  await expect(page.locator('label').filter({ hasText: /^Amenities$/ })).toBeVisible();
  await expect(page.getByText('Co-Working Spaces')).toHaveCount(0);
});
