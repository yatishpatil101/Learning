/* MapStruct's `ignoreByDefault = true` drops an unlisted field with no compile error and no 422,
   so only reading the row back proves a value survived the DTO, mapper, entity and Postgres. */
import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { authHeaders, API, uniqueMobile, uploadedListingPhotos } from '../../../helpers/liveAuth.js';
import { approveListingWithFetch, rejectListingWithFetch } from '../../../helpers/moderation.js';

const created = new Set();

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null) };
}
/* A fresh owner per listing: the free tier allows one listing per account, so two listings need two
   accounts, and a brand-new account makes the read unambiguous without searching. */

async function post(fields) {
  const headers = await authHeaders(uniqueMobile());
  const res = await api('POST', '/me/listings', headers, {
    title: `Zztest detail-counts ${Date.now()}`,
    deal: 'rent',
    propertyType: 'Flat',
    price: 24000,
    city: 'Pune',
    /* A real entry in `GET /localities`, so the resolver files the listing rather than leaving
       `locality_slug` null and dropping it into the curation queue. */
    locality: 'Baner',
    bhk: 3,
    area: 1200,
    images: await uploadedListingPhotos(headers),
    ...fields,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  created.add(res.body.id);
  return { id: res.body.id, headers, ref: res.body.slug || res.body.id };
}

async function publish(id) {
  const res = await approveListingWithFetch(id, await authHeaders(ACTORS.admin));
  expect(res.status).toBe(200);
}

test.afterEach(async () => {
  if (!created.size) return;
  const headers = await authHeaders(ACTORS.admin);
  for (const id of created) {
    await rejectListingWithFetch(id, headers, {
      reason: 'Zztest cleanup \u2014 synthetic detail-counts fixture',
    });
  }
  created.clear();
});

test('a zero the owner did state is kept, and is not read as silence', async () => {
  const { id, headers } = await post({ bathrooms: 0, parking: 0, balconies: 0 });

  const read = await api('GET', `/me/listings/${id}`, headers);
  expect(read.status).toBe(200);

  expect(read.body.bathrooms).toBe(0);
  expect(read.body.parking).toBe(0);
  expect(read.body.balconies).toBe(0);
});

test('the detail fields survive the round trip to Postgres, an unstated count reads back absent, and the detail page prints only what the owner gave', async ({ page }) => {
  test.slow();
  const stated = await post({
    bathrooms: 3,
    parking: 2,
    balconies: 1,
    facing: 'North',
    overlooking: 'Garden',
    totalFloors: 14,
    ageYears: 5,
  });
  const silent = await post({});

  await test.step('the seven detail fields survive the round trip to Postgres', async () => {
    const read = await api('GET', `/me/listings/${stated.id}`, stated.headers);
    expect(read.status).toBe(200);

    expect(read.body.bathrooms).toBe(3);
    expect(read.body.parking).toBe(2);
    expect(read.body.balconies).toBe(1);
    expect(read.body.facing).toBe('North');
    expect(read.body.overlooking).toBe('Garden');
    expect(read.body.totalFloors).toBe(14);
    expect(read.body.ageYears).toBe(5);
  });

  await test.step('an unstated count reads back absent, not zero', async () => {
    const read = await api('GET', `/me/listings/${silent.id}`, silent.headers);
    expect(read.status).toBe(200);

    expect(read.body.bathrooms ?? null).toBeNull();
    expect(read.body.parking ?? null).toBeNull();
    expect(read.body.balconies ?? null).toBeNull();
  });

  await publish(stated.id);
  await publish(silent.id);

  await test.step('the detail page prints the bathroom count the owner gave, and nothing when they gave none', async () => {
    const tile = (p, label) => p.locator('.detail-card').filter({ has: p.locator('p:first-child').filter({ hasText: new RegExp(`^${label}$`) }) });

    await page.goto(`/property/${stated.ref}`);
    await expect(tile(page, 'Bathrooms')).toContainText('3');
    await expect(tile(page, 'Parking')).toContainText('2');
    await expect(tile(page, 'Facing')).toContainText('North');
    await expect(tile(page, 'Overlooking')).toContainText('Garden');

    await page.goto(`/property/${silent.ref}`);
    /* The teeth. This listing is a 3 BHK, so the deleted `Math.max(1, bhkNum - 1)` would print "2"
       here — a number no one ever supplied, indistinguishable from the one above. */
    await expect(tile(page, 'Bathrooms')).toContainText('Not specified');
    await expect(tile(page, 'Bathrooms')).not.toContainText('2');
    await expect(tile(page, 'Overlooking')).toContainText('Not specified');
  });
});
