import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, uniqueMobile, signedInAs, uploadedListingPhotos } from '../../../helpers/liveAuth.js';
import { approveListingWithFetch, rejectListingWithFetch } from '../../../helpers/moderation.js';

const PROP_ASPECTS = ['Locality', 'Condition', 'Value', 'Owner', 'Accuracy'];

const created = new Set();

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null) };
}

async function actor(name) {
  const mobile = uniqueMobile();
  const headers = await authHeaders(mobile);
  const res = await api('PATCH', '/auth/me', headers, { name });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { mobile, headers };
}

async function eligibleResident() {
  const owner = await actor('Zztest Composer Landlord');
  const made = await api('POST', '/me/listings', owner.headers, {
    title: `Zztest review-composer ${Date.now()}`,
    deal: 'rent',
    propertyType: 'Flat',
    price: 23000,
    city: 'Pune',
    locality: 'Baner',
    bhk: 2,
    area: 900,
    images: await uploadedListingPhotos(owner.headers),
  });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  const id = made.body.id;
  const ref = made.body.slug || id;
  created.add(id);

  const admin = await authHeaders(ACTORS.admin);
  const approved = await approveListingWithFetch(id, admin);
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);

  const resident = await actor('Zztest Composer Resident');
  expect(resident.mobile, 'the two actors minted the same mobile').not.toBe(owner.mobile);

  const claim = await api('POST', `/properties/${id}/tenancy-declarations`, resident.headers, {
    livedFrom: '2024-01-01',
    livedTo: '2024-12-31',
  });
  expect(claim.status, JSON.stringify(claim.body)).toBe(201);
  expect(claim.body.status, 'a claim is worth nothing until the owner answers').toBe('pending');

  const ok = await api('POST', `/tenancy-declarations/${claim.body.id}/confirm`, owner.headers);
  expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  expect(ok.body.status).toBe('confirmed');

  return { resident, ref, id, declarationId: claim.body.id };
}

test.afterEach(async () => {
  if (!created.size) return;
  const headers = await authHeaders(ACTORS.admin);
  for (const id of created) {
    await rejectListingWithFetch(id, headers, {
      reason: 'Zztest cleanup \u2014 synthetic review-composer fixture',
    });
  }
  created.clear();
});

test('every star in the property review composer names its value and its aspect', async ({ page }) => {
  const { resident, ref, id, declarationId } = await eligibleResident();
  await signedInAs(page, resident.mobile);

  const declarationsRead = page.waitForResponse((response) => (
    response.request().method() === 'GET'
    && response.url().includes(`/properties/${id}/tenancy-declarations`)
  ));
  /* `?tab=amenities`: the reviews block is mounted by PropertyTabs only while that tab is current,
     so on the default Overview tab the "Rate this property" button does not exist at all. */

  await page.goto(`/property/${ref}?tab=amenities`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.querySelectorAll('.reveal,.fade-up,.fade-in').forEach((el) => el.classList.add('visible')));

  const declarationResponse = await declarationsRead;
  expect(declarationResponse.status(), 'the page read the resident’s declaration from the live API').toBe(200);
  const declarations = await declarationResponse.json();
  expect(declarations.content, 'the live declaration endpoint keeps its PageResponse content envelope').toEqual(
    expect.arrayContaining([expect.objectContaining({ id: declarationId, status: 'confirmed' })]),
  );

  const rateButton = page.getByRole('button', { name: 'Rate this property' });
  await expect(rateButton).toBeVisible();
  // Section and live declaration read completed, so absence is not a first-paint false green.
  await expect(page.getByTestId('tenancy-declare')).toHaveCount(0);
  await rateButton.click();
  const dialog = page.getByRole('dialog', { name: 'Rate this property' });
  await expect(dialog, 'a confirmed tenancy did not open the review composer').toBeVisible({ timeout: 15_000 });

  await expect(dialog.getByRole('button', { name: '3 star', exact: true })).toHaveCount(1);

  for (const aspect of PROP_ASPECTS) {
    await expect(dialog.getByRole('button', { name: `3 star for ${aspect}` })).toHaveCount(1);
  }

  await expect(dialog.getByRole('button', { name: /star/ })).toHaveCount(30);
});
