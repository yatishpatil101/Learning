import { test, expect } from '../../fixtures/live.js';
import { API, authHeaders, apiLogin, uniqueMobile } from '../../helpers/liveAuth.js';

// Posting a listing on an owner's behalf, against the real API.
const admin = () => authHeaders('9000000000');

// Deliberately minimal: nothing here is under test.
const listing = (title) => ({
  title,
  deal: 'rent',
  propertyType: 'Flat',
  price: 32000,
  locality: 'Kharadi',
  city: 'Pune',
  bhk: 2,
  area: 900,
});

const postOnBehalf = async (headers, body) => {
  const res = await fetch(`${API}/admin/properties`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const myListings = async (mobile) => {
  const res = await fetch(`${API}/me/listings?size=100`, { headers: await authHeaders(mobile) });
  return (await res.json()).content || [];
};

test('the listing belongs to the owner, not the operator who typed it', async () => {
  const ownerMobile = uniqueMobile();
  const title = `On behalf ${Date.now()}`;

  const created = await postOnBehalf(await admin(), {
    ownerMobile, ownerName: 'Ravi Kulkarni', listing: listing(title),
  });
  expect(created.status).toBe(201);

  // The assertion the mock could not make.
  const owners = await myListings(ownerMobile);
  expect(owners.map((l) => l.title)).toContain(title);

  // And the other half, which is the actual regression: the operator must not end up owning it.
  const operators = await myListings('9000000000');
  expect(operators.map((l) => l.title)).not.toContain(title);
});

test('the funnel is opened, and it names the staff member by id', async () => {
  const ownerMobile = uniqueMobile();
  const session = await apiLogin('9000000000');

  const created = await postOnBehalf(await admin(), {
    ownerMobile, ownerName: 'Ravi Kulkarni', listing: listing(`Funnel ${Date.now()}`),
  });
  expect(created.status).toBe(201);

  // Only admin-created listings need hand-back; owner-created listings already arrived.
  expect(created.body.adminPipeline?.postedByAdmin).toBe(true);
  expect(created.body.progress).toMatchObject({ track: 'staff', step: 'created' });

  // An id, taken from the caller's token.
  expect(created.body.adminPipeline?.postedByStaff).toBe(session.user.id);
});

test('a number that has never signed in gets an account, and can then sign in to it', async () => {
  const ownerMobile = uniqueMobile();
  const title = `Provisioned ${Date.now()}`;

  const created = await postOnBehalf(await admin(), {
    ownerMobile, ownerName: 'Never Signed In', listing: listing(title),
  });
  expect(created.status).toBe(201);

  // The claim, end to end: the owner signs in with the number the operator dialled and the listing is waiting.
  const session = await apiLogin(ownerMobile);
  expect(session.user.name).toBe('Never Signed In');
  expect((await myListings(ownerMobile)).map((l) => l.title)).toContain(title);
});

test('an operator cannot rename an owner who already has an account', async () => {
  const ownerMobile = uniqueMobile();

  // The owner signs in first and is known by the name they chose.
  await apiLogin(ownerMobile);
  const before = (await apiLogin(ownerMobile)).user.name;

  const created = await postOnBehalf(await admin(), {
    ownerMobile, ownerName: 'Whatever The Operator Heard', listing: listing(`Rename ${Date.now()}`),
  });
  expect(created.status).toBe(201);

  // `ownerName` is a fallback for provisioning, not an update.
  expect((await apiLogin(ownerMobile)).user.name).toBe(before);
});

test('posting in somebody else\u2019s name needs more than a signed-in session', async () => {
  const owner = await authHeaders('9470744469');
  const refused = await postOnBehalf(owner, {
    ownerMobile: uniqueMobile(), ownerName: 'Ravi', listing: listing(`Forbidden ${Date.now()}`),
  });

  // 403, from the server.
  expect(refused.status).toBe(403);
});

test('the desk can see when an owner is past their plan', async () => {
  const ownerMobile = uniqueMobile();
  const headers = await admin();

  const standing = async () => {
    const res = await fetch(`${API}/admin/properties/owner-standing?mobile=${ownerMobile}`, { headers });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  const before = await standing();
  expect(before.status).toBe(200);
  expect(before.body.known).toBe(false);

  await postOnBehalf(headers, {
    ownerMobile, ownerName: 'Over Their Plan', listing: listing(`Standing one ${Date.now()}`),
  });

  const atLimit = await standing();
  expect(atLimit.body.known).toBe(true);
  expect(atLimit.body.allowance).toBe(1);
  expect(atLimit.body.held).toBe(1);
  expect(atLimit.body.overAllowance).toBe(false);

  await postOnBehalf(headers, {
    ownerMobile, ownerName: 'Over Their Plan', listing: listing(`Standing two ${Date.now()}`),
  });

  const over = await standing();
  expect(over.body.held).toBe(2);
  expect(over.body.overAllowance).toBe(true);
  expect(over.body.plan).toBeUndefined();
  expect(over.body.price).toBeUndefined();
});

// The owner step is the desk's chance to catch duplicate pending listings.
test('the owner step warns about listings the server is already holding', async ({ page, login }) => {
  const ownerMobile = uniqueMobile();
  const headers = await admin();
  for (const n of [1, 2]) {
    const res = await postOnBehalf(headers, {
      ownerMobile, ownerName: 'Rang Twice', listing: listing(`Second thoughts ${n} ${Date.now()}`),
    });
    expect(res.status).toBe(201);
  }

  await login.asAdmin();
  await page.goto('/admin/post-on-behalf');
  await page.getByLabel('Owner Mobile *').fill(ownerMobile);

  // Two, not "at least one".
  await expect(page.getByText(/already has 2 pending listings/i)).toBeVisible({ timeout: 10000 });

  // And it is scoped to the number, not to the queue.
  await page.getByLabel('Owner Mobile *').fill(uniqueMobile());
  await expect(page.getByText(/already has \d+ pending listing/i)).toHaveCount(0);
});

// The two wizard fields whose only proof was a read of the mock store.
const onlyListing = async (ownerMobile) => {
  const mine = await myListings(ownerMobile);
  expect(mine, 'the wizard did not create a listing for this owner').toHaveLength(1);
  const res = await fetch(`${API}/me/listings/${mine[0].id}`, {
    headers: await authHeaders(ownerMobile),
  });
  expect(res.status).toBe(200);
  return res.json();
};

const choose = (page, group, name) => page.getByRole('group', { name: group, exact: true })
  .getByRole('button', { name, exact: typeof name === 'string' }).click();

async function ownerAndProperty(page, { name, mobile, carpetArea }) {
  await page.getByPlaceholder('Full name of the property owner').fill(name);
  await page.getByPlaceholder('9876543210').fill(mobile);
  await choose(page, 'Property type', 'Flat / Apartment');
  await choose(page, 'BHK', '2 BHK');
  await page.getByPlaceholder('e.g. 850').fill(carpetArea);
}

test('the desk asks only the critical facts, and each one reaches the server', async ({ page, login }) => {
  const ownerMobile = uniqueMobile();
  await login.asAdmin();
  await page.goto('/admin/post-on-behalf');

  await page.getByLabel('Internal Notes (optional)').fill('Zztest owner prefers calls after 6pm');
  await ownerAndProperty(page, { name: 'Critical Owner', mobile: ownerMobile, carpetArea: '950' });
  await expect(page.getByRole('group', { name: 'Furnishing' })).toBeVisible();
  for (const gone of ['Amenities', 'Bathrooms', 'Balconies', 'Facing', 'Overlooking', 'Built-up Area (sq.ft)']) {
    await expect(page.getByText(gone, { exact: true })).toHaveCount(0);
  }
  await page.getByLabel('Floor', { exact: true }).click();
  await page.getByRole('option', { name: '5', exact: true }).click();
  await page.getByLabel('Total floors').click();
  await page.getByRole('option', { name: '4', exact: true }).click();
  // Next, with nothing typed. The owner step must still be here, and the property step must not be.
  await page.getByRole('button', { name: /Next/i }).click();
  await expect(page.getByText('Floor is above the total floors.')).toBeVisible();
  await page.getByLabel('Floor', { exact: true }).click();
  await page.getByRole('option', { name: 'Ground', exact: true }).click();
  await page.getByRole('button', { name: /Next/i }).click();

  await page.getByText('Select locality').click();
  await page.getByRole('option', { name: /Wakad/i }).click();
  await expect(page.getByText('Landmark', { exact: true })).toHaveCount(0);
  await page.locator('#pob-society').fill('Zztest Desk Heights');
  await page.getByRole('button', { name: /Next/i }).click();

  await page.locator('#pob-price').fill('24000');
  // A deposit, which this test does not care about -- it is the control for the one below. See the
  // assertion at the end.
  await page.getByRole('button', { name: '2 months rent' }).click();
  for (const gone of ['Maintenance Charges', 'Preferred Tenants', 'Agreement', 'Description (optional)', 'Price is negotiable']) {
    await expect(page.getByText(gone, { exact: true })).toHaveCount(0);
  }
  await page.getByRole('button', { name: /Next/i }).click();
  await expect(page.getByText('Zztest Desk Heights, Wakad')).toBeVisible();

  await page.getByRole('button', { name: /Send to Owner/i }).click();
  await expect(page.getByRole('heading', { name: 'Listing Sent to Owner' })).toBeVisible({ timeout: 15000 });

  // Read back the figures the owner will be asked to approve.
  const stored = await onlyListing(ownerMobile);
  // Prove the check reads this new listing, not the owner's older listing.
  expect(Number(stored.price)).toBe(24000);
  // The control for the next test, taken here because this listing is a rent and so is entitled to one.
  expect(Number(stored.deposit)).toBe(48000);
  // Unticked amenities must stay absent; the server must not invent them.
  expect(stored.amenities ?? []).toHaveLength(0);
  expect(stored.floor).toBe(0);
  expect(stored.totalFloors).toBe(4);

  await expect.poll(async () => {
    const res = await fetch(`${API}/admin/notes/property/${stored.id}`, { headers: await admin() });
    return (await res.json()).map((n) => n.text);
  }).toContain('Zztest owner prefers calls after 6pm');
});

const PIN = { lat: 18.5975, lng: 73.7701 };
async function stubPlaces(page) {
  await page.waitForFunction(() => !!window.google?.maps?.version, null, { timeout: 20000 });
  await page.evaluate(({ lat, lng }) => {
    const prediction = (label) => ({
      placeId: `stub-${label}`,
      text: { toString: () => label },
      mainText: { toString: () => label },
      secondaryText: { toString: () => 'Pune, Maharashtra' },
      toPlace: () => ({
        addressComponents: [
          { types: ['postal_code'], longText: '411057' },
          { types: ['sublocality_level_1', 'sublocality', 'political'], longText: 'Wakad' },
        ],
        location: { lat: () => lat, lng: () => lng },
        displayName: label,
        formattedAddress: `${label}, Pune`,
        types: ['premise'],
        fetchFields: async () => ({}),
      }),
    });
    const realImport = window.google.maps.importLibrary.bind(window.google.maps);
    window.google.maps.importLibrary = async (name) => (name === 'places'
      ? { AutocompleteSuggestion: { fetchAutocompleteSuggestions: async ({ input }) => ({ suggestions: [{ placePrediction: prediction(input) }] }) } }
      : realImport(name));
  }, PIN);
}

test('locality and society take Google suggestions, and a picked society binds the listing to it and its pin', async ({ page, login }) => {
  const ownerMobile = uniqueMobile();
  const society = `Zztest Google Towers ${ownerMobile.slice(-6)}`;
  await login.asAdmin();
  await page.goto('/admin/post-on-behalf');
  await stubPlaces(page);

  await ownerAndProperty(page, { name: 'Google Owner', mobile: ownerMobile, carpetArea: '900' });
  await page.getByRole('button', { name: /Next/i }).click();

  await page.getByText('Select locality').click();
  await page.locator('.dz-dropdown__search input').fill('Pashan');
  await page.locator('.dz-dropdown__option', { hasText: 'Pashan' }).first().click();
  await expect(page.getByLabel('Locality')).toContainText('Pashan');

  await page.locator('#pob-society').fill(society);
  const googleOption = page.getByTestId('society-google-option');
  await expect(googleOption).toContainText(society);
  await googleOption.click();
  await expect(page.locator('#pob-society')).toHaveValue(society);
  await page.getByRole('button', { name: /Next/i }).click();

  await page.locator('#pob-price').fill('26000');
  await page.getByRole('button', { name: /Next/i }).click();
  await expect(page.getByText(`${society}, Pashan`)).toBeVisible();
  await page.getByRole('button', { name: /Send to Owner/i }).click();
  await expect(page.getByRole('heading', { name: 'Listing Sent to Owner' })).toBeVisible({ timeout: 15000 });

  const stored = await onlyListing(ownerMobile);
  expect(stored.locality).toBe('Pashan');
  expect(stored.societyId, 'the Google pick did not bind a society record').toBeTruthy();
  expect(Number(stored.lat)).toBeCloseTo(PIN.lat, 3);
  expect(Number(stored.lng)).toBeCloseTo(PIN.lng, 3);
});

test('a deposit typed under rent is not filed against a sale', async ({ page, login }) => {
  const ownerMobile = uniqueMobile();
  await login.asAdmin();
  await page.goto('/admin/post-on-behalf');

  await ownerAndProperty(page, { name: 'NoDeposit Owner', mobile: ownerMobile, carpetArea: '900' });
  await page.getByRole('button', { name: /Next/i }).click();
  await page.getByText('Select locality').click();
  await page.getByRole('option', { name: /Baner/i }).click();
  await page.getByRole('button', { name: /Next/i }).click();

  await page.locator('input[inputmode="numeric"]').first().fill('25000');
  await page.getByRole('button', { name: '2 months rent' }).click();
  await expect(page.locator('#pob-deposit')).toHaveValue(/50/);

  await page.getByRole('group', { name: /Listing deal type/i })
    .getByRole('button', { name: /For Sale/i }).click();
  await expect(page.getByText('Security Deposit')).toHaveCount(0);
  await page.locator('input[inputmode="numeric"]').first().fill('250000');

  await page.getByRole('button', { name: /Next/i }).click();
  await page.getByRole('button', { name: /Send to Owner/i }).click();
  await expect(page.getByRole('heading', { name: 'Listing Sent to Owner' })).toBeVisible({ timeout: 15000 });

  const stored = await onlyListing(ownerMobile);
  // Check the deal too; "no deposit" is trivial if a rent listing merely lost deposit.
  expect(stored.deal).toBe('buy');
  // Nought, from the server.
  expect(Number(stored.deposit ?? 0)).toBe(0);
});

// This covers the wizard's client-side paths that no API assertion can see.
test('the two ways in reach the wizard, step one will not be skipped, and the money the operator reads is the money the server files', async ({ page, login }) => {
  const ownerMobile = uniqueMobile();
  await login.asAdmin();

  // Scoped to the sidebar, because two links reach this page.
  await page.goto('/admin');
  await page.locator('aside').getByRole('link', { name: /Post on Behalf/i }).click();
  await expect(page).toHaveURL(/\/admin\/post-on-behalf$/);
  await expect(page.getByText('Post on Behalf of Owner')).toBeVisible();

  await page.goto('/admin');
  await page.locator('main').getByRole('link', { name: /Post on behalf/i }).first().click();
  await expect(page).toHaveURL(/\/admin\/post-on-behalf$/);

  await page.getByRole('button', { name: /Next/i }).click();
  await expect(page.getByPlaceholder('Full name of the property owner')).toBeVisible();
  await expect(page.getByText('Select locality')).toHaveCount(0);

  await ownerAndProperty(page, { name: 'Money Owner', mobile: ownerMobile, carpetArea: '950' });
  await page.getByRole('button', { name: /Next/i }).click();
  await page.getByText('Select locality').click();
  await page.getByRole('option', { name: /Baner/i }).click();
  await page.getByRole('button', { name: /Next/i }).click();

  const price = page.locator('#pob-price');
  const deposit = page.locator('#pob-deposit');

  // Seven digits: the only scale at which the Indian rule and the Western one disagree.
  await price.fill('2500000');
  await expect(price).toHaveValue('25,00,000');
  await expect(page.getByText('≈ ₹ 25 Lakh')).toBeVisible();
  await page.getByRole('button', { name: '2 months rent' }).click();
  await expect(deposit).toHaveValue('50,00,000');

  await price.fill('25000');
  await expect(price).toHaveValue('25,000');
  await expect(page.getByText('≈ ₹ 25 Thousand')).toBeVisible();
  await page.getByRole('button', { name: '2 months rent' }).click();
  await expect(deposit).toHaveValue('50,000');

  await page.getByRole('button', { name: /Next/i }).click();
  await page.getByRole('button', { name: /Send to Owner/i }).click();
  await expect(page.getByRole('heading', { name: 'Listing Sent to Owner' })).toBeVisible({ timeout: 15000 });

  const stored = await onlyListing(ownerMobile);
  expect(Number(stored.price)).toBe(25000);
  expect(Number(stored.deposit)).toBe(50000);
});

// These browser-only behaviours settle before any request is made.
test('a property type switched away from takes its bedroom configuration with it off the review screen', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/post-on-behalf');

  // A residential flat with a bedroom configuration before the type correction.
  await ownerAndProperty(page, { name: 'Cascade Owner', mobile: uniqueMobile(), carpetArea: '950' });

  await expect(page.getByRole('group', { name: 'BHK', exact: true }).getByRole('button', { name: '2 BHK' })).toHaveAttribute('aria-pressed', 'true');

  await choose(page, 'Property type', 'Commercial');
  await choose(page, 'Commercial type', 'Office Space');
  await expect(page.getByRole('group', { name: 'BHK', exact: true })).toHaveCount(0);
  await page.getByPlaceholder('e.g. 850').fill('1200');
  await choose(page, 'Shell type', 'Bare Shell');

  await page.getByRole('button', { name: /Next/i }).click();
  await page.getByText('Select locality').click();
  await page.getByRole('option', { name: /Baner/i }).click();
  await page.getByRole('button', { name: /Next/i }).click();
  await page.locator('#pob-price').fill('9000000');
  await page.getByRole('button', { name: /Next/i }).click();

  // Destination one: the summary the operator reads immediately before pressing Send.
  await expect(page.getByText('Config', { exact: true })).toHaveCount(0);
  await expect(page.getByText('2 BHK')).toHaveCount(0);
  await expect(page.getByText('1200 sq.ft')).toBeVisible();
});

// The deposit half of the deal toggle is not repeated here.
test('the deal toggle and the land cascade decide what the operator may type, and every label points at its field', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/post-on-behalf');

  await page.getByText('Owner Name *').click();
  await expect(page.locator('#pob-ownerName')).toBeFocused();

  const group = page.getByRole('group', { name: /Listing deal type/i });
  await expect(group).toBeVisible();
  await group.getByRole('button', { name: /For Sale/i }).click();
  await expect(group.getByRole('button', { name: /For Sale/i })).toHaveAttribute('aria-pressed', 'true');
  // Paired, because "For Sale is pressed" is equally true of a control that presses everything.
  await expect(group.getByRole('button', { name: /For Rent/i })).toHaveAttribute('aria-pressed', 'false');

  await page.getByPlaceholder('Full name of the property owner').fill('Land Owner');
  await page.getByPlaceholder('9876543210').fill('9876543210');

  await choose(page, 'Property type', 'Open Plot');
  await expect(page.getByText('Plot Area (sq.ft) *')).toBeVisible();
  await expect(page.getByText('Furnishing')).toHaveCount(0);
  await expect(page.getByLabel('Facing')).toHaveCount(0);
  await expect(page.getByText('Amenities')).toHaveCount(0);

  await page.getByPlaceholder('e.g. 850').fill('2400');
  await choose(page, 'NA status', /Still agricultural/);
  await choose(page, 'Other rights', /Clear/);
  await page.getByRole('button', { name: /Next/i }).click();
  await page.getByText('Select locality').click();
  await page.getByRole('option', { name: /Baner/i }).click();
  await page.getByRole('button', { name: /Next/i }).click();
  // For Sale, all the way through: the price field is renamed and the deposit is not offered.
  await expect(page.getByText('Expected Price')).toBeVisible();
  await expect(page.getByText('Monthly Rent')).toHaveCount(0);
  await expect(page.getByText('Security Deposit')).toHaveCount(0);
});

// The draft key is browser-local state, not a stand-in for the server.
test('a half-typed wizard survives a refresh, out of the operator’s own browser', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/post-on-behalf');
  await page.evaluate(() => localStorage.removeItem('dz_pob_draft_v2'));
  await page.reload();

  await page.getByPlaceholder('Full name of the property owner').fill('Draft Owner');
  await page.getByPlaceholder('9876543210').fill('9876500000');
  // Polled rather than slept.
  await expect.poll(async () =>
    await page.evaluate(() => localStorage.getItem('dz_pob_draft_v2') !== null)).toBe(true);

  await page.reload();
  await expect(page.getByText(/unsaved draft/i)).toBeVisible();
  await page.getByRole('button', { name: /^Resume$/ }).click();
  await expect(page.getByPlaceholder('Full name of the property owner')).toHaveValue('Draft Owner');
});

test('a commercial listing files its type and shell, and asks nothing the owner can add later', async ({ page, login }) => {
  const ownerMobile = uniqueMobile();
  await login.asAdmin();
  await page.goto('/admin/post-on-behalf');

  await page.getByPlaceholder('Full name of the property owner').fill('Godown Owner');
  await page.getByPlaceholder('9876543210').fill(ownerMobile);
  await choose(page, 'Property type', 'Commercial');
  await choose(page, 'Commercial type', 'Warehouse / Godown');
  await page.getByPlaceholder('e.g. 850').fill('4200');
  await choose(page, 'Shell type', 'Bare Shell');
  await expect(page.locator('#pob-floorLoad')).toHaveCount(0);
  await expect(page.getByLabel('Fixtures')).toHaveCount(0);

  await page.getByRole('button', { name: /Next/i }).click();
  await page.getByText('Select locality').click();
  await page.getByRole('option', { name: /Chakan|Wakad|Baner/ }).first().click();
  await expect(page.locator('#pob-society')).toBeVisible();
  await expect(page.locator('#pob-society')).not.toHaveAttribute('role', 'combobox');
  await page.getByRole('button', { name: /Next/i }).click();

  await page.locator('#pob-price').fill('180000');
  await expect(page.getByText('GST on Rent')).toHaveCount(0);
  // A rental is not asked its tenancy, on screen as well as on the wire.
  await expect(page.getByText('Tenancy Status')).toHaveCount(0);

  await page.getByRole('button', { name: /Next/i }).click();
  await page.getByRole('button', { name: /Send to Owner/i }).click();
  await expect(page.getByRole('heading', { name: 'Listing Sent to Owner' })).toBeVisible({ timeout: 15000 });

  const stored = await onlyListing(ownerMobile);
  const c = stored.commercial;
  expect(c, 'the commercial answer set never reached the server').toBeTruthy();
  expect(c.commercialType).toBe('warehouse');
  expect(c.shellType).toBe('bareShell');
  expect(c.floorLoad || '').toBe('');
  // Escalation is the sale-plausible template most likely to be forwarded.
  expect(c.gstOnRent || '').toBe('');
  expect(c.tenancyStatus || '').toBe('');
});
