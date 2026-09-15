/* MapStruct's `ignoreByDefault = true` drops an unlisted field with no compile error and no 422,
   so only reading the row back proves a value survived the DTO, mapper, entity and Postgres. */
import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { authHeaders, API, uniqueMobile } from '../../../helpers/liveAuth.js';

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
    ...fields,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  created.add(res.body.id);
  return { id: res.body.id, headers, ref: res.body.slug || res.body.id };
}

async function publish(id) {
  const res = await api('PATCH', `/properties/${id}/status`, await authHeaders(ACTORS.admin), {
    status: 'approved',
  });
  expect(res.status).toBe(200);
}

test.afterEach(async () => {
  if (!created.size) return;
  const headers = await authHeaders(ACTORS.admin);
  for (const id of created) {
    await api('PATCH', `/properties/${id}/status`, headers, {
      status: 'rejected',
      reason: 'Zztest cleanup \u2014 synthetic detail-counts fixture',
    });
  }
  created.clear();
});

test('the seven detail fields survive the round trip to Postgres', async () => {
  const { id, headers } = await post({
    bathrooms: 3,
    parking: 2,
    balconies: 1,
    facing: 'North',
    overlooking: 'Garden',
    totalFloors: 14,
    ageYears: 5,
  });

  const read = await api('GET', `/me/listings/${id}`, headers);
  expect(read.status).toBe(200);

  /* Read back one at a time rather than as an object comparison: a `toMatchObject` over all seven
     reports the first mismatch and hides the rest, and when a mapper allowlist is the suspect it
     is the SET of survivors that identifies the missing line. */
  expect(read.body.bathrooms).toBe(3);
  expect(read.body.parking).toBe(2);
  expect(read.body.balconies).toBe(1);
  expect(read.body.facing).toBe('North');
  /* V19 split the view out of `facing`. Posted together on purpose: the whole point of the split
     is that a home holds both at once, so a mapper line that dropped one of the pair would leave
     the other looking correct. */
  expect(read.body.overlooking).toBe('Garden');
  expect(read.body.totalFloors).toBe(14);
  expect(read.body.ageYears).toBe(5);
});

test('an unstated count reads back absent, not zero', async () => {
  const { id, headers } = await post({});

  const read = await api('GET', `/me/listings/${id}`, headers);
  expect(read.status).toBe(200);

  /* Null and 0 are different answers — "the owner did not say" versus "the owner said none" — and a
     column defaulting to 0 would make every listing claim it has no bathroom. Read through
     `?? null` because the serializer omits nulls entirely. */
  expect(read.body.bathrooms ?? null).toBeNull();
  expect(read.body.parking ?? null).toBeNull();
  expect(read.body.balconies ?? null).toBeNull();
});

test('a zero the owner did state is kept, and is not read as silence', async () => {
  const { id, headers } = await post({ bathrooms: 0, parking: 0, balconies: 0 });

  const read = await api('GET', `/me/listings/${id}`, headers);
  expect(read.status).toBe(200);

  /* The CHECK is `>= 0`, not `> 0`. A studio with a shared bathroom and no parking slot is a real
     listing, and `|| undefined` anywhere on the write path would silently turn its answer back
     into silence — which is the same bug as the fabrication, pointed the other way. */
  expect(read.body.bathrooms).toBe(0);
  expect(read.body.parking).toBe(0);
  expect(read.body.balconies).toBe(0);
});

test('the detail page prints the bathroom count the owner gave, and nothing when they gave none', async ({ page }) => {
  const stated = await post({ bathrooms: 4, parking: 2, facing: 'West', overlooking: 'Parking' });
  const silent = await post({});
  await publish(stated.id);
  await publish(silent.id);

  /* The tile is a `.detail-card` whose first paragraph is the label and second is the value
     (PropertyTabs.jsx); an empty value is replaced with "Not specified" rather than left blank, so
     both branches are assertable text rather than a presence check. */
  const tile = (p, label) => p.locator('.detail-card').filter({ has: p.locator('p:first-child').filter({ hasText: new RegExp(`^${label}$`) }) });

  await page.goto(`/property/${stated.ref}`);
  await expect(tile(page, 'Bathrooms')).toContainText('4');
  await expect(tile(page, 'Parking')).toContainText('2');
  await expect(tile(page, 'Facing')).toContainText('West');
  await expect(tile(page, 'Overlooking')).toContainText('Parking');

  await page.goto(`/property/${silent.ref}`);
  /* The teeth. This listing is a 3 BHK, so the deleted `Math.max(1, bhkNum - 1)` would print "2"
     here — a number no one ever supplied, indistinguishable from the one above. */
  await expect(tile(page, 'Bathrooms')).toContainText('Not specified');
  await expect(tile(page, 'Bathrooms')).not.toContainText('2');
  await expect(tile(page, 'Overlooking')).toContainText('Not specified');
});
