/**
 * D244 — the detail tiles nobody could ever fill.
 *
 * The property detail page has always shown Bathrooms, Parking, Facing and Age tiles. Three of
 * those had no column behind them and no write path in front of them, and the fourth had the worst
 * outcome of the four: `useProperty.js` filled Bathrooms from `Math.max(1, bhkNum - 1)`. That is a
 * guess rendered in the same weight and the same type as the price and the carpet area, with no
 * hedge — a 3 BHK was reported as having two bathrooms on the strength of arithmetic, and a reader
 * had no way to tell that number from one the owner actually gave.
 *
 * The wizard had been collecting the answer the whole time; the builder in `submit.js` dropped it,
 * so it never reached the record, the mapper or the wire. V114 gives bathrooms, parking and
 * balconies real columns and the six fields a real write path.
 *
 * ## Why this file is API-first with one UI test
 *
 * The interesting failure is silent. MapStruct's `ignoreByDefault = true` means a field left off
 * the `PropertyMapper` allowlist is dropped with no compile error, no test failure and no 422 —
 * exactly how `facing` and `totalFloors` came to have a column and a read contract but nothing
 * that ever wrote to them. A POST that returns 201 therefore proves nothing at all. Only reading
 * the row back proves the value survived the DTO, the mapper, the entity and Postgres.
 *
 * The single UI test covers the other half, which the API cannot see: the page must print what the
 * owner said, and must print nothing where the owner said nothing. Both directions matter, and the
 * second is the one that regressed for years — a fabrication is invisible to any test that only
 * ever posts a listing with the field filled in.
 *
 * Every expected value is the value this test posted, so nothing here is a fact about the seed and
 * the file is safe to run alongside the rest of the live suite.
 */
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

test('the six detail fields survive the round trip to Postgres', async () => {
  const { id, headers } = await post({
    bathrooms: 3,
    parking: 2,
    balconies: 1,
    facing: 'North-East',
    totalFloors: 14,
    ageYears: 5,
  });

  const read = await api('GET', `/me/listings/${id}`, headers);
  expect(read.status).toBe(200);

  /* Read back one at a time rather than as an object comparison: a `toMatchObject` over all six
     reports the first mismatch and hides the rest, and when a mapper allowlist is the suspect it
     is the SET of survivors that identifies the missing line. */
  expect(read.body.bathrooms).toBe(3);
  expect(read.body.parking).toBe(2);
  expect(read.body.balconies).toBe(1);
  expect(read.body.facing).toBe('North-East');
  expect(read.body.totalFloors).toBe(14);
  expect(read.body.ageYears).toBe(5);
});

test('an unstated count reads back absent, not zero', async () => {
  const { id, headers } = await post({});

  const read = await api('GET', `/me/listings/${id}`, headers);
  expect(read.status).toBe(200);

  /* Null and 0 are different answers — "the owner did not say" versus "the owner said none" — and
     the tile renders them differently, so a column that defaulted to 0 would make every listing
     ever posted claim it has no bathroom. The columns are deliberately nullable with no default;
     this is the assertion that keeps them that way.

     Read through `?? null` because the serializer omits nulls entirely, so an unstated field is
     `undefined` on the parsed body rather than `null`. That would normally be too weak an
     assertion — a misspelled field name is also `undefined` — but the round-trip test above has
     already proved each of these names reaches Postgres and comes back, so the only thing left to
     establish here is which of null and 0 the silence became. */
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
  const stated = await post({ bathrooms: 4, parking: 2, facing: 'West' });
  const silent = await post({});
  await publish(stated.id);
  await publish(silent.id);

  /* The tile is a `.detail-card` whose first paragraph is the label and second is the value
     (PropertyTabs.jsx); an empty value is replaced with "Not specified" rather than left blank, so
     both branches are assertable text rather than a presence check. */
  const tile = (p, label) => p.locator('.detail-card').filter({ hasText: label }).first();

  await page.goto(`/property/${stated.ref}`);
  await expect(tile(page, 'Bathrooms')).toContainText('4');
  await expect(tile(page, 'Parking')).toContainText('2');
  await expect(tile(page, 'Facing')).toContainText('West');

  await page.goto(`/property/${silent.ref}`);
  /* The teeth. This listing is a 3 BHK, so the deleted `Math.max(1, bhkNum - 1)` would print "2"
     here — a number no one ever supplied, indistinguishable from the one above. */
  await expect(tile(page, 'Bathrooms')).toContainText('Not specified');
  await expect(tile(page, 'Bathrooms')).not.toContainText('2');
});
