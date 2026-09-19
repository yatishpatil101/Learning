/* The account is registered over HTTP with a real JWT, so these branching assertions also stand for
 * a session the server recognises. No identity badge: the wizard has no identity gate. */
import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';

// Sign in as a real, freshly registered owner so the whole-place flow renders straight into the
// form.
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
  await menuOpen(page);
  await page.locator('.dz-dropdown__option', { hasText: label }).first().click();
}

test('property-type dropdown lists the canonical types in the new order', async ({ page }) => {
  await gotoForm(page);
  await page.locator('[data-err="propertyType"]').click();
  // Load-bearing, not decorative: `allInnerTexts()` does not retry, so against an unopened menu it
  // returns `[]` and the comparison below would fail with a confusing empty-array diff.
  await menuOpen(page);
  const options = await page.locator('.dz-dropdown__option').allInnerTexts();
  const cleaned = options.map((o) => o.trim());
  expect(cleaned).toEqual([
    'Flat / Apartment',
    'Independent House',
    'Villa',
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
  await expect(page.locator('[data-err="commercialType"] .dz-dropdown__trigger.dz-invalid')).toBeVisible();

  // Choosing a sub-type clears the error and reveals commercial-only fields.
  await page.locator('[data-err="commercialType"] .dz-dropdown__trigger').click();
  await menuOpen(page);
  await page.locator('.dz-dropdown__option', { hasText: 'Warehouse / Godown' }).first().click();
  /* Scoped to the labels: the Next Step above left the fit-out requirement unanswered, so its
     validation message is on screen too, and `getByText` matches a substring case-insensitively. */
  await expect(page.locator('label', { hasText: 'Fit-out Status' })).toBeVisible();
  await expect(page.locator('label', { hasText: 'Suitable For' })).toBeVisible();
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

  // Commercial Type is a dropdown (no radio pills inside it).
  await expect(page.locator('[data-err="commercialType"] .dz-dropdown__trigger')).toBeVisible();
  await expect(page.locator('[data-err="commercialType"] .radio-pill')).toHaveCount(0);

  // Suitable For is a multi-select dropdown that keeps multiple choices.
  await page.locator('[data-err="commercialType"] .dz-dropdown__trigger').click();
  await menuOpen(page);
  await page.locator('.dz-dropdown__option', { hasText: 'Office Space' }).first().click();

  const suitable = page.locator('.dz-dropdown', { has: page.locator('.dz-dropdown__trigger', { hasText: 'Select suitable businesses' }) });
  await suitable.locator('.dz-dropdown__trigger').click();
  await menuOpen(page);
  await page.locator('.dz-dropdown__option', { hasText: 'Office' }).first().click();
  // Scoped to the workspace profile: an office is not offered Retail, so pick its neighbour.
  await page.locator('.dz-dropdown__option', { hasText: 'Clinic' }).first().click();
  // Menu stays open for multi-select; both options are marked selected.
  await expect(page.locator('.dz-dropdown__option[aria-selected="true"]')).toHaveCount(2);
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

// ---- Location step type-awareness ----

async function toLocation(page, typeLabel, { deal = 'buy', commercialSubtype } = {}) {
  await gotoForm(page);
  if (deal === 'rent') await page.locator('.lp-step').getByText('Rent', { exact: true }).first().click();
  await pickType(page, typeLabel);
  if (commercialSubtype) {
    await page.locator('[data-err="commercialType"] .dz-dropdown__trigger').click();
    await menuOpen(page);
    await page.locator('.dz-dropdown__option', { hasText: commercialSubtype }).first().click();
    // Fit-out sets the rent and is the first filter every enquiry applies, so the step will not
    // advance without it.
    await page.locator('[data-err="shellType"]').getByText('Warm Shell', { exact: true }).click();
  }
  await page.locator('input[data-err="carpetArea"]').fill('1200');
  /* Only a flat is gated on a floor now — a ground-level godown has none to state. Land renders no
     dropdown at all, which is what the presence check is for. */
  for (const [dataErr, value] of [['floor', '9'], ['totalFloors', '14']]) {
    const trigger = page.locator(`[data-err="${dataErr}"] .dz-dropdown__trigger`);
    if (!await trigger.count()) continue;
    await trigger.click();
    await menuOpen(page);
    await page.getByRole('option', { name: value, exact: true }).click();
  }
  /* Land owes its title questions before the step advances, and farm land for sale owes a third. Presence-driven,
     since which option is chosen is not what any test here is about — the walk just has to answer the gate. */
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

  // Ownership stays (land can be freehold/leasehold); society maintenance,
  // sale-type/possession tiles and the home-loan toggle are not shown.
  await expect(page.getByText('Ownership Type *')).toBeVisible();
  await expect(page.getByText('Monthly Maintenance')).toHaveCount(0);
  await expect(page.getByText('Sale Type')).toHaveCount(0);
  await expect(page.getByText('Possession Status')).toHaveCount(0);
  await expect(page.getByText('Home Loan Available')).toHaveCount(0);
});

test('Commercial rent hides tenant/pets fields but keeps lease terms', async ({ page }) => {
  await toPricing(page, 'Commercial', { deal: 'rent', commercialSubtype: 'Office Space' });

  await expect(page.getByText('Preferred Tenants')).toHaveCount(0);
  await expect(page.getByText('Pets Allowed')).toHaveCount(0);
  await expect(page.getByText('Food Preference')).toHaveCount(0);
  // Lease structure still matters for commercial.
  await expect(page.getByText('Agreement Duration')).toBeVisible();
  await expect(page.getByText('Lock-in Period')).toBeVisible();
});

test('Commercial rent offers year-scale lease terms; residential does not', async ({ page }) => {
  await toPricing(page, 'Commercial', { deal: 'rent', commercialSubtype: 'Office Space' });
  await expect(page.getByText('Agreement Duration').locator('..').locator('.dz-dropdown__trigger')).toContainText('1 year');
  // Agreement duration for commercial runs in years, e.g. 5 years / 9 years.
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

test('Commercial address labels are business terms, not flat/society', async ({ page }) => {
  await toLocation(page, 'Commercial', { commercialSubtype: 'Office Space' });

  // Business terminology replaces the residential flat/society wording.
  await expect(page.getByText('Unit / Shop No. *')).toBeVisible();
  await expect(page.getByText('Building / Complex Name *')).toBeVisible();
  await expect(page.getByText('Flat / Unit No. *')).toHaveCount(0);
  await expect(page.getByText('Building / Society Name *')).toHaveCount(0);
});

// ---- Photos & documents type-awareness ----

async function toUploadsBuy(page, typeLabel, { commercialSubtype } = {}) {
  await toPricing(page, typeLabel, { commercialSubtype });
  const land = typeLabel === 'Open Plot' || typeLabel === 'Farm Land';
  await page.locator('input[data-err="price"]').fill('5000000');
  await page.locator('[data-err="ownership"]').click();
  await menuOpen(page);
  await page.locator('.dz-dropdown__option').first().click();
  // Land is never asked; everything else must answer before the step will advance.
  if (!land) await page.getByRole('button', { name: 'Ready to Move', exact: true }).click();
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.getByText('Photos & documents').waitFor({ timeout: 10000 });
}

test('Open Plot uploads swap in land documents and hide amenities', async ({ page }) => {
  await toUploadsBuy(page, 'Open Plot');

  await page.getByText('Other documents — for your records').click();
  await expect(page.getByText('7/12 Extract (Satbara)')).toBeVisible();
  await expect(page.getByText('NA Order / Zone Certificate')).toBeVisible();
  // Society-flavoured residential docs and the amenities picker don't apply to raw land.
  await expect(page.getByText('Society Registration Certificate')).toHaveCount(0);
  await expect(page.getByText('Amenities', { exact: true })).toHaveCount(0);
});

test('Farm Land uploads keep the NA Order slot and show agricultural records', async ({ page }) => {
  await toUploadsBuy(page, 'Farm Land');

  await page.getByText('Other documents — for your records').click();
  await expect(page.getByText('8A Extract (Holding Record)')).toBeVisible();
  await expect(page.getByText('7/12 Extract (Satbara)')).toBeVisible();
  /* Farm land is asked the same NA question a plot is, so a sanctioned claim must have somewhere to
     go — a claim with nowhere to upload it is a claim nobody can check. */
  await expect(page.getByText('NA Order / Zone Certificate')).toBeVisible();
});

test('Land offers the 7/12 Extract as its ownership proof, not Index II', async ({ page }) => {
  await toUploadsBuy(page, 'Open Plot');

  /* Land's ownership proof is the 7/12 Extract, with Index II only as the conditional "if purchased"
     entry — the wrong way round asks a farmer for a document inherited land never had. */
  await page.getByText('Other documents — for your records').click();
  await expect(page.getByText('7/12 Extract (Satbara)')).toBeVisible();
  await expect(page.getByText('Mutation Entry (Ferfar)')).toBeVisible();
  // A plot carries no flat's paperwork: the society and deed records belong to a building.
  await expect(page.getByText('Registered Sale Deed')).toHaveCount(0);

  // Optional means optional: submitting with no document raises no document error.
  await page.getByRole('button', { name: /Submit Property/i }).click();
  await expect(page.locator('[data-err="documents"]')).toHaveCount(0);
});

test('Commercial uploads show compliance docs and a business amenity set', async ({ page }) => {
  await toUploadsBuy(page, 'Commercial', { commercialSubtype: 'Office Space' });

  await page.getByText('Other documents — for your records').click();
  await expect(page.getByText('Fire / Trade NOC')).toBeVisible();
  await expect(page.getByText('Amenities', { exact: true })).toBeVisible();
  // Residential-only amenities are filtered out; workspace ones remain.
  await expect(page.getByText('Co-Working Spaces')).toBeVisible();
  await expect(page.getByText('Swimming Pool')).toHaveCount(0);
});

test('Warehouse (industrial) uploads show factory/pollution docs, drop office amenities', async ({ page }) => {
  await toUploadsBuy(page, 'Commercial', { commercialSubtype: 'Warehouse / Godown' });

  await page.getByText('Other documents — for your records').click();
  await expect(page.getByText('MPCB (Pollution) Consent')).toBeVisible();
  await expect(page.getByText(/^Factory License\b/)).toBeVisible();
  // A godown shouldn't advertise co-working / club-house.
  await expect(page.getByText('Co-Working Spaces')).toHaveCount(0);
  await expect(page.getByText('Club House')).toHaveCount(0);
  await expect(page.getByText('2-Wheeler Parking', { exact: true })).toBeVisible();
  await expect(page.getByText('4-Wheeler Parking', { exact: true })).toBeVisible();
});

test('Shop (retail) uploads show Shop Act licence and no industrial docs', async ({ page }) => {
  await toUploadsBuy(page, 'Commercial', { commercialSubtype: 'Shop / Showroom' });

  await page.getByText('Other documents — for your records').click();
  await expect(page.getByText('Shop Act (Gumasta) License')).toBeVisible();
  await expect(page.getByText('Factory License', { exact: true })).toHaveCount(0);
  // Retail doesn't get the co-working amenity either.
  await expect(page.getByText('Co-Working Spaces')).toHaveCount(0);
});
