import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { signedInAsNew, authHeaders, API, uploadedListingPhotos } from '../../../helpers/liveAuth.js';
import { approveListingWithFetch } from '../../../helpers/moderation.js';

const created = new Set();

const BASE_LISTING = {
  deal: 'buy',
  propertyType: 'Flat',
  price: 5000000,
  city: 'Pune',
  bhk: 2,
  area: 900,
  locality: 'Baner',
  address: 'D-704, Zztest Policy Heights, Baner Road',
  pincode: '411045',
  formDetails: { flatNumber: 'D-704', society: 'Zztest Policy Heights', street: 'Baner Road' },
};

const formLocator = (page) => page.locator('[data-err="propertyType"]');

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null) };
}

async function ownerWithLiveListing(page, request, overrides) {
  const mobile = await signedInAsNew(page);
  const headers = await authHeaders(mobile);
  const res = await api('POST', '/me/listings', headers, {
    ...BASE_LISTING,
    title: `Zztest edit-policy ${Date.now()}`,
    images: await uploadedListingPhotos(headers),
    ...overrides,
  });
  expect(res.status).toBe(201);
  created.add(res.body.id);

  const approved = await approveListingWithFetch(res.body.id, await authHeaders(ACTORS.admin));
  expect(approved.status).toBe(200);
  return { mobile, id: res.body.id };
}

test.afterEach(async () => {
  if (!created.size) return;
  const headers = await authHeaders(ACTORS.admin);
  for (const id of created) {
    await api('PATCH', `/properties/${id}/status`, headers, {
      status: 'rejected',
      reason: 'Zztest cleanup \u2014 synthetic edit-policy fixture',
    });
  }
  created.clear();
});

test('a first free listing is NOT paywalled and shows no edit banner', async ({ page }) => {
  await signedInAsNew(page); // a brand-new owner, so no existing listings
  await page.goto('/list-property');
  await expect(formLocator(page)).toBeVisible({ timeout: 20000 });
  // … editing an existing listing is never paywalled, and the form is available.
  await expect(page.getByText(/used your free listing/i)).toHaveCount(0);
  await expect(page.getByText('Publishes instantly')).toHaveCount(0);
});

test('a live listing is paywalled for a second new post, and editing it shows the tiered banner with a price edit staying live', async ({ page, request }) => {
  test.slow();
  const { id } = await ownerWithLiveListing(page, request);

  await test.step('P2 ? a second new listing is paywalled on the free plan', async () => {
    await page.goto('/list-property');
    await expect(page.getByRole('heading', { name: /used your free listing/i })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('link', { name: /Upgrade & post/i })).toBeVisible();
    await expect(formLocator(page)).toHaveCount(0);
  });

  await test.step('P1 ? editing a live listing shows the tiered edit banner (and no paywall)', async () => {
    await page.goto(`/list-property?edit=${id}`);
    await expect(page.getByText('Publishes instantly')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Needs a re-check')).toBeVisible();
    await expect(page.getByText(/used your free listing/i)).toHaveCount(0);
    await expect(formLocator(page)).toBeVisible();
  });

  await test.step('P1 ? a price edit is re-checked but the banner promises the listing stays live', async () => {
    await page.getByRole('button', { name: /Next Step/i }).click();
    await page.getByRole('button', { name: /Next Step/i }).click();
    await expect(page.getByRole('heading', { name: 'Price & terms', exact: true })).toBeVisible({ timeout: 20000 });
    const price = page.locator('input[data-err="price"]');
    await expect(price).toBeVisible({ timeout: 20000 });
    await price.fill('4500000');
    await price.blur();

    await expect(page.getByText(/need a re-check/i)).toBeVisible({ timeout: 15000 });
    // … but the owner is told the listing keeps working, and the off-search copy must NOT appear.
    await expect(page.getByText(/stays live and searchable while we re-check/i)).toBeVisible();
    await expect(page.getByText('Live — being re-checked')).toBeVisible();
    await expect(page.getByText(/comes off search while we re-check it/i)).toHaveCount(0);
    /* Before the edit, so this cannot pass on a prefill that already differs from the stored row —
       which is the way a test of a *newly* classified field fails silently rather than red. */
    await expect(page.getByText('Under review — off search')).toHaveCount(0);
  });
});

test('P1 — a Tier-A edit surfaces the re-check summary + status timeline', async ({ page, request }) => {
  const { id } = await ownerWithLiveListing(page, request);
  await page.goto(`/list-property?edit=${id}`);
  await expect(page.getByText('Publishes instantly')).toBeVisible({ timeout: 20000 });
  // Change BHK from 2 → 3 on step 1. BHK is one of the four fields that set
  // `remoderationRequired` in ListingEditRules.apply, so the server takes the listing down.
  await page.locator('[data-err="bhk"]').getByText('3', { exact: true }).click();

  await expect(page.getByText(/need a re-check/i)).toBeVisible({ timeout: 15000 });

  await expect(page.getByText(/comes off search while we re-check it/i)).toBeVisible();
  await expect(page.getByText('Under review — off search')).toBeVisible();
});

test('P1 — re-zoning a plot is warned about, even though nobody types the field it changes', async ({ page, request }) => {
  const { id } = await ownerWithLiveListing(page, request, {
    propertyType: 'Open Plot',
    area: 12,
    areaUnit: 'guntha',
    landUse: 'residential',
    bhk: undefined,
    formDetails: { plotZone: 'Residential (R1)' },
  });
  await page.goto(`/list-property?edit=${id}`);
  await expect(page.getByText('Publishes instantly')).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('Under review — off search')).toHaveCount(0);
  // R1 → C-1 moves `landUse` residential → commercial, which is a different Land-use filter.
  await page.getByText('Residential (R1)', { exact: true }).click();
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
  await page.locator('.dz-dropdown__option', { hasText: 'Commercial (C-1)' }).first().click();

  await expect(page.getByText(/need a re-check/i)).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/comes off search while we re-check it/i)).toBeVisible();
  await expect(page.getByText('Under review — off search')).toBeVisible();
});
