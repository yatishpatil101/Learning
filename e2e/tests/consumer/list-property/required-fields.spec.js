// Every assertion here is about a field whose requiredness decides whether the finished listing can be
// FOUND, not merely whether it is complete — a null floor is excluded from floor-bounded search.
import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { pickDate } from '../../../helpers/datePicker.helper.js';
import { uploadPublishablePhotos } from '../../../helpers/listingPhotos.helper.js';
import { signedInAsNew, authHeaders, API } from '../../../helpers/liveAuth.js';

const owners = new Set();

test.afterEach(async () => {
  if (!owners.size) return;
  const adminHeaders = await authHeaders(ACTORS.admin);
  for (const mobile of owners) {
    const res = await fetch(`${API}/me/listings`, { headers: await authHeaders(mobile) });
    if (res.status !== 200) continue;
    const body = await res.json();
    for (const row of (Array.isArray(body) ? body : (body.content ?? body.items ?? []))) {
      await fetch(`${API}/properties/${row.id}/status`, {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify({ status: 'rejected', reason: 'Zztest cleanup — required-fields fixture' }),
      });
    }
  }
  owners.clear();
});

// Portal mounting precedes interactivity by one animation frame.
async function pickOption(page, dataErr, label) {
  await page.locator(`[data-err="${dataErr}"]`).click();
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
  await page.locator('.dz-dropdown__option', { hasText: label }).first().click();
}

async function pickFloors(page, { floor = '9', totalFloors = '14' } = {}) {
  for (const [dataErr, value] of [['floor', floor], ['totalFloors', totalFloors]]) {
    await page.locator(`[data-err="${dataErr}"] .dz-dropdown__trigger`).click();
    await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
    await page.getByRole('option', { name: value, exact: true }).click();
  }
}

/** Step 1 of a flat, stopping short of "Next Step" so a caller can assert the gate. */
async function fillStep1(page, floors, deal = 'buy') {
  const mobile = await signedInAsNew(page);
  owners.add(mobile);
  await page.goto('/list-property');
  // The step rail distinguishes the wizard from the paywall, which also renders the meter.
  await page.waitForSelector('.lp-steps', { timeout: 20000 });
  // The deal toggle lives here, and the pricing step renders an entirely different panel per deal.
  if (deal === 'rent') await page.locator('.radio-pill', { hasText: 'Rent' }).first().click();
  await pickOption(page, 'propertyType', 'Flat / Apartment');
  await page.locator('input[data-err="carpetArea"]').fill('1150');
  if (floors !== null) await pickFloors(page, floors);
  return mobile;
}

/** Through step 1 and the address step, landing on step 3 where the money is asked for. */
async function gotoPricing(page, floors, deal = 'buy') {
  const mobile = await fillStep1(page, floors, deal);
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });
  await pickOption(page, 'locality', 'Baner');
  await page.locator('input[data-err="flatNumber"]').fill('B-1204');
  await page.locator('input[data-err="society"]').fill('Skyline Heights');
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Price & terms/i', { timeout: 15000 });
  return mobile;
}

test('a flat cannot leave step 1 without a floor, and Ground survives as an answer', async ({ page }) => {
  await fillStep1(page, null);
  await page.getByRole('button', { name: /Next Step/i }).click();

  // `PropertySpecs` bounds floor with >=/<=, so an unanswered floor is excluded from every
  // floor-filtered search rather than merely unsorted — hence a gate, not a nudge.
  await expect(page.locator('[data-err="floor"] .dz-dropdown__trigger')).toHaveClass(/dz-invalid/);
  await expect(page.locator('[data-err="totalFloors"] .dz-dropdown__trigger')).toHaveClass(/dz-invalid/);
  await expect(page.locator('.gm-style')).toHaveCount(0);

  // Ground is a real floor, not an absent one: it must clear the gate without being coerced away.
  await pickFloors(page, { floor: 'Ground', totalFloors: '4' });
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });
});

test('possession is an unanswered required choice, and the answer drives the search facet', async ({ page }) => {
  const mobile = await gotoPricing(page);
  await page.locator('input[data-err="price"]').fill('9500000');
  await pickOption(page, 'ownership', 'Freehold');

  // No pre-selection: a pre-filled "Ready to Move" made the requirement unfailable, so every sale
  // published the default as though the owner had chosen it.
  await expect(page.locator('[data-err="possession"] .radio-pill[aria-pressed="true"]')).toHaveCount(0);
  await page.getByRole('button', { name: /Next Step/i }).click();
  await expect(page.getByText('Select the possession status.', { exact: true })).toBeVisible();

  // Age stayed blank on step 1 and is never revisited: it does not govern the facet.
  await page.getByRole('button', { name: 'Ready to Move', exact: true }).click();
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Photos & documents/i', { timeout: 15000 });
  await uploadPublishablePhotos(page);
  await page.getByRole('button', { name: /Submit Property/i }).click();
  await expect(page.locator('text=/Listed Successfully/i')).toBeVisible({ timeout: 30000 });

  const res = await fetch(`${API}/me/listings`, { headers: await authHeaders(mobile) });
  const body = await res.json();
  const row = (Array.isArray(body) ? body : (body.content ?? body.items ?? []))[0];
  // The claim is not that the control rendered — it is that the owner's required answer reaches the
  // column the Ready-to-Move facet reads, with Age never consulted.
  expect(row).toMatchObject({ possession: 'ready-to-move' });

  /* Public search pins `status = approved`, so approving first is what makes the next assertion a claim about
     the facet rather than about the moderation queue. */
  const adminHeaders = await authHeaders(ACTORS.admin);
  const approved = await fetch(`${API}/properties/${row.id}/status`, {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ status: 'approved', reason: 'Zztest — facet visibility' }),
  });
  expect(approved.status).toBe(200);

  // `localities` is matched against `localitySlug`, so the display name would silently match nothing.
  const facet = await fetch(`${API}/properties?construction=ready-to-move&localities=baner`);
  const page1 = await facet.json();
  const ids = (page1.content ?? page1.items ?? page1).map((p) => p.id);
  expect(ids).toContain(row.id);
});

test('an under-construction sale must carry its MahaRERA number, beside the answer that demands it', async ({ page }) => {
  await gotoPricing(page);
  await page.locator('input[data-err="price"]').fill('9500000');
  await pickOption(page, 'ownership', 'Freehold');

  // Optional until the owner says the build is unfinished — resale of a completed home owes nothing.
  await expect(page.getByText('MahaRERA Registration No.')).toBeVisible();
  await page.getByRole('button', { name: 'Under Construction', exact: true }).click();
  await pickDate(page, '[data-err="availableFrom"]', '2027-06-30');
  await page.getByRole('button', { name: /Next Step/i }).click();

  // The control lives beside the possession answer, not buried at the bottom of the document step
  // it used to sit on.
  await expect(page.locator('input[data-err="reraId"]')).toBeFocused();
  await expect(page.getByText('Enter the MahaRERA number. It is required to advertise a new or under-construction sale.', { exact: true })).toBeVisible();
  await page.locator('input[data-err="reraId"]').fill('P52100012345');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Photos & documents/i', { timeout: 15000 });
  // And it is absent from the document step, where the control used to sit.
  await expect(page.getByText('MahaRERA Registration No.')).toHaveCount(0);
});

test('a handover date cannot be set in the past', async ({ page }) => {
  await gotoPricing(page);
  await page.locator('input[data-err="price"]').fill('9500000');
  await page.getByRole('button', { name: 'New Launch', exact: true }).click();

  /* The bound is expressed by the calendar, not a native date input. Asserted over the whole grid rather than
     on "yesterday", which on the 1st of a month sits in a view the dialog has not rendered. */
  await page.locator('[data-err="availableFrom"]').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const today = new Date().toISOString().slice(0, 10);
  const selectable = await page.locator('.dz-cal__grid .dz-cal__day:not([disabled])')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
  // A grid that rendered nothing would satisfy `every` without proving anything.
  expect(selectable).toContain(today);
  expect(selectable.filter((iso) => iso < today)).toEqual([]);
});

test('a zero deposit is a real offer, not a missing answer', async ({ page }) => {
  await gotoPricing(page, undefined, 'rent');
  await page.locator('input[data-err="monthlyRent"]').fill('30000');
  await pickDate(page, '[data-err="availableFrom"]', '2027-12-31');

  // Every sibling money field here rejects zero. Deposit must not, or a genuine zero-deposit
  // rental can only be posted by inventing a number the owner is not asking for.
  await page.locator('input[data-err="deposit"]').fill('0');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Photos & documents/i', { timeout: 15000 });
});

test('one photo is not enough to publish, and the floor is enforced at the step boundary', async ({ page }) => {
  await gotoPricing(page);
  await page.locator('input[data-err="price"]').fill('9500000');
  await pickOption(page, 'ownership', 'Freehold');
  await page.getByRole('button', { name: 'Ready to Move', exact: true }).click();
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Photos & documents/i', { timeout: 15000 });

  await uploadPublishablePhotos(page, { count: 1, categories: [] });
  await page.getByRole('button', { name: /Submit Property/i }).click();
  await expect(page.getByText(/Add at least 3 photos/)).toBeVisible();

  // Three photos clear the count but not the coverage: a seeker who cannot see the kitchen has
  // been shown three pictures of nothing in particular.
  await uploadPublishablePhotos(page, { count: 2, categories: [] });
  await page.getByRole('button', { name: /Submit Property/i }).click();
  await expect(page.getByText(/Label at least 2 photos/)).toBeVisible();
});

test('switching a pre-completion flat to land does not strand the owner on the pricing step', async ({ page }) => {
  await gotoPricing(page);
  await page.locator('input[data-err="price"]').fill('9500000');
  await pickOption(page, 'ownership', 'Freehold');
  // "Under Construction" is what makes the date and the RERA number mandatory.
  await page.getByRole('button', { name: 'Under Construction', exact: true }).click();

  /* A plot renders neither the possession card nor the date, so if requiredness read a leftover `construction`
     Next would fail against controls that do not exist — the owner sees the button do nothing, with nothing to fix. */
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await pickOption(page, 'propertyType', 'Open Plot');
  await pickOption(page, 'naStatus', 'NA order sanctioned');
  await pickOption(page, 'otherRights', 'Clear — no entries');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Price & terms/i', { timeout: 15000 });

  await page.locator('input[data-err="price"]').fill('9500000');
  await pickOption(page, 'ownership', 'Freehold');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Photos & documents/i', { timeout: 15000 });
});

/* ── Commercial: a godown has no floor, a factory shed has no society, and none of them have three areas to
   disagree about. What a commercial listing does owe is the answer every enquiry filters on first. */

/** Step 1 of a commercial unit, stopping short of "Next Step" so a caller can assert the gate. */
async function fillCommercialStep1(page, subtype, deal = 'rent') {
  const mobile = await signedInAsNew(page);
  owners.add(mobile);
  await page.goto('/list-property');
  await page.waitForSelector('.lp-steps', { timeout: 20000 });
  if (deal === 'rent') await page.locator('.radio-pill', { hasText: 'Rent' }).first().click();
  await pickOption(page, 'propertyType', 'Commercial');
  await pickOption(page, 'commercialType', subtype);
  await page.locator('input[data-err="carpetArea"]').fill('2400');
  return mobile;
}

test('a commercial listing cannot leave step 1 without a fit-out status, and owes no floor', async ({ page }) => {
  await fillCommercialStep1(page, 'Warehouse / Godown');

  /* A ground-level godown must be postable without inventing a storey count, which would then reach the
     floor-bounded search as though measured. The labels stay — asserting presence keeps the absence honest. */
  await expect(page.getByText('Floor No.', { exact: true })).toBeVisible();
  await expect(page.getByText('Floor No. *')).toHaveCount(0);
  await expect(page.getByText('Total Floors *')).toHaveCount(0);

  /* Fit-out is the opposite move. It sets the rent and it is the first filter every enquiry
     applies, so leaving it unstated publishes a price nobody can read. It was optional. */
  await page.getByRole('button', { name: /Next Step/i }).click();
  await expect(page.locator('.gm-style')).toHaveCount(0);
  await expect(page.getByText('Select the fit-out status — it sets the rent, and it is the first thing every enquiry filters on.', { exact: true })).toBeVisible();

  await page.locator('[data-err="shellType"]').getByText('Bare Shell', { exact: true }).click();
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });
});

test('carpet area is the only area a commercial listing states', async ({ page }) => {
  await fillCommercialStep1(page, 'Office Space');

  /* A commercial deal is transacted on carpet, and an optional second measure is still one a seeker compares
     against the first. The built-up input carries no `data-err`, so its label is the only handle — matched loosely. */
  await expect(page.locator('input[data-err="carpetArea"]')).toBeVisible();
  await expect(page.getByText(/built-up area/i)).toHaveCount(0);
  await expect(page.locator('input[data-err="superBuiltUp"]')).toHaveCount(0);
  // Nor is it reintroduced under another name — no chargeable area, no loading factor.
  await expect(page.getByText(/chargeable|loading factor/i)).toHaveCount(0);
});

test('an industrial listing is not asked for a unit number or a project it does not belong to', async ({ page }) => {
  await fillCommercialStep1(page, 'Industrial / Factory');
  await page.locator('[data-err="shellType"]').getByText('Bare Shell', { exact: true }).click();
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });
  await pickOption(page, 'locality', 'Baner');
  await page.locator('input[data-err="pincode"]').fill('411045');

  /* A factory on its own MIDC plot has no flat number and belongs to no society, and `submit.js` discards
     `societyId` anyway. Asserted on the labels too, or the wizard says one thing and does another. */
  await expect(page.getByText('Unit / Shop No.', { exact: true })).toBeVisible();
  await expect(page.getByText('Unit / Shop No. *')).toHaveCount(0);
  await expect(page.getByText('Building / Complex Name *')).toHaveCount(0);
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Price & terms/i', { timeout: 15000 });
});

test('the profile decides which measurements are asked for, so nobody sees an irrelevant box', async ({ page }) => {
  // Industrial: what a warehouse enquiry is qualified on before anyone drives out to see it.
  await fillCommercialStep1(page, 'Industrial / Factory');
  for (const key of ['floorLoad', 'clearHeight', 'sanctionedPower', 'dockCount']) {
    await expect(page.locator(`input[data-err="${key}"]`), key).toBeVisible();
  }
  // A factory has no frontage worth quoting and no seat count at all.
  await expect(page.locator('input[data-err="frontage"]')).toHaveCount(0);
  await expect(page.locator('input[data-err="seatCount"]')).toHaveCount(0);

  // Retail trades on frontage; it does not have a dock.
  await pickOption(page, 'commercialType', 'Shop / Showroom');
  await expect(page.locator('input[data-err="frontage"]')).toBeVisible();
  await expect(page.locator('input[data-err="dockCount"]')).toHaveCount(0);

  // A workspace is sized in seats.
  await pickOption(page, 'commercialType', 'Office Space');
  await expect(page.locator('input[data-err="seatCount"]')).toBeVisible();
  await expect(page.locator('input[data-err="floorLoad"]')).toHaveCount(0);
});

test('co-working is no longer offered, because a lump monthly rent cannot state a per-seat price', async ({ page }) => {
  await fillCommercialStep1(page, 'Office Space');

  await page.locator('[data-err="commercialType"] .dz-dropdown__trigger').click();
  const menu = page.locator('.dz-dropdown__menu.is-portal-open');
  await expect(menu).toBeVisible();
  const options = await menu.locator('.dz-dropdown__option').allInnerTexts();
  /* The positive anchor first: an empty menu satisfies the absence below without proving anything
     about it. */
  expect(options).toContain('Warehouse / Godown');
  expect(options).not.toContain('Co-working Space');
});

test('a commercial rental publishes the owner\'s own fit-out, not a tier-keyed guess', async ({ page }) => {
  const mobile = await fillCommercialStep1(page, 'Warehouse / Godown');
  await page.locator('[data-err="shellType"]').getByText('Warm Shell', { exact: true }).click();
  await page.locator('input[data-err="clearHeight"]').fill('32');
  await page.locator('input[data-err="dockCount"]').fill('4');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });
  await pickOption(page, 'locality', 'Baner');
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Price & terms/i', { timeout: 15000 });

  await page.locator('input[data-err="monthlyRent"]').fill('180000');
  await page.locator('input[data-err="deposit"]').fill('1080000');
  await pickDate(page, '[data-err="availableFrom"]', '2027-12-31');
  await page.locator('[data-err="gstOnRent"]').getByText('Yes', { exact: true }).click();
  await page.locator('input[data-err="escalationPct"]').fill('5');
  /* Deliberately off the standard terms: a lock-in left at its default is indistinguishable from one the wire
     dropped — both render "None" — so the readback only means something if the fallback could not guess it. */
  await page.getByText('Lock-in Period').locator('..').locator('.dz-dropdown__trigger').click();
  await page.getByRole('option', { name: '3 years', exact: true }).click();
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Photos & documents/i', { timeout: 15000 });
  /* A warehouse has no living room. The categories a listing must cover are chosen by its profile,
     so the residential default the helper carries would ask for options this picker never offers. */
  await uploadPublishablePhotos(page, { categories: ['Frontage / Gate', 'Loading Bay'] });
  await page.getByRole('button', { name: /Submit Property/i }).click();
  await expect(page.locator('text=/Listed Successfully/i')).toBeVisible({ timeout: 30000 });

  const res = await fetch(`${API}/me/listings`, { headers: await authHeaders(mobile) });
  const body = await res.json();
  const row = (Array.isArray(body) ? body : (body.content ?? body.items ?? []))[0];

  /* Asserting the nested object is what distinguishes "the answer was stored" from "the answer can be read
     back": these keys reached `form_details` and were then promoted by nothing. */
  expect(row.commercial).toMatchObject({
    commercialType: 'warehouse',
    shellType: 'warmShell',
    clearHeight: '32',
    dockCount: '4',
    gstOnRent: 'yes',
    escalationPct: '5',
  });

  const adminHeaders = await authHeaders(ACTORS.admin);
  const approved = await fetch(`${API}/properties/${row.id}/status`, {
    method: 'PATCH',
    headers: adminHeaders,
    body: JSON.stringify({ status: 'approved', reason: 'Zztest — commercial detail readback' }),
  });
  expect(approved.status).toBe(200);

  await page.goto(`/property/${row.id}`, { waitUntil: 'domcontentloaded' });
  // Key Details carries the profile's own measurements, on the tab that opens by default.
  await expect(page.getByText('32 ft', { exact: true })).toBeVisible();

  /* The fit-out lives on the Rent Details tab, and a tab that is not current renders nothing at
     all — so every assertion below has to follow the click, or it passes against an empty panel. */
  await page.getByRole('tab', { name: 'Rent Details' }).click();

  /* Bare shell was never entered and must not appear: the retired fallback published a fixed three-item
     fit-out on every commercial rental, so a claimed item present is what makes an unclaimed one absent mean anything. */
  await expect(page.getByText('Warm shell', { exact: true })).toBeVisible();
  await expect(page.getByText('Bare shell', { exact: true })).toHaveCount(0);
  // Power backup and pantry were never toggled, so the fallback's other two items are gone too.
  await expect(page.getByText('Power Backup', { exact: true })).toHaveCount(0);

  /* The stated three-year lock-in is what proves the tiles carry the owner's answer: an unstated tile reads
     "None", which is a term a landlord can actually offer and so proves nothing either way. */
  await expect(page.getByText('Lock-in').locator('..')).toContainText('36 months');
});

test('a commercial sale is priced on its tenancy, and only a let one is asked what it earns', async ({ page }) => {
  const mobile = await fillCommercialStep1(page, 'Office Space', 'buy');
  await page.locator('[data-err="shellType"]').getByText('Furnished', { exact: true }).click();
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });
  await pickOption(page, 'locality', 'Baner');
  await page.locator('input[data-err="flatNumber"]').fill('502');
  await page.locator('input[data-err="society"]').fill('Zztest Business Bay');
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Price & terms/i', { timeout: 15000 });
  await page.locator('input[data-err="price"]').fill('42000000');

  /* MIDC and the other estates lease the land for 95 years and sell only the structure, so a
     commercial buyer is offered a title the residential list does not carry. */
  await pickOption(page, 'ownership', 'MIDC / Industrial Lease');

  /* What it earns is a question only a let asset can answer: asking a vacant one yields either a blank the
     buyer reads as zero yield or an invented number. */
  await expect(page.locator('input[data-err="inPlaceRent"]')).toHaveCount(0);
  await expect(page.locator('[data-err="leaseExpiry"]')).toHaveCount(0);
  await page.locator('[data-err="tenancyStatus"]').getByText('Leased / Tenanted', { exact: true }).click();
  await page.locator('input[data-err="inPlaceRent"]').fill('320000');
  await pickDate(page, '[data-err="leaseExpiry"]', '2029-03-31');

  await page.getByRole('button', { name: 'Ready to Move', exact: true }).click();
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Photos & documents/i', { timeout: 15000 });
  await uploadPublishablePhotos(page, { categories: ['Frontage / Entrance', 'Workstation Area'] });
  await page.getByRole('button', { name: /Submit Property/i }).click();
  await expect(page.locator('text=/Listed Successfully/i')).toBeVisible({ timeout: 30000 });

  const res = await fetch(`${API}/me/listings`, { headers: await authHeaders(mobile) });
  const body = await res.json();
  const row = (Array.isArray(body) ? body : (body.content ?? body.items ?? []))[0];
  /* `submit.js` scopes tenancy to the sale and GST to the letting, so each deal writes only its own screen's
     keys. An unasserted scoped branch is where the original defect lived. */
  expect(row.commercial).toMatchObject({
    commercialType: 'office',
    shellType: 'furnished',
    tenancyStatus: 'leased',
    inPlaceRent: '320000',
    leaseExpiry: '2029-03-31',
  });
  expect(row.commercial.gstOnRent).toBe('');
});

