// LIVE: "have I already listed this?" — the owner-scoped duplicate pre-check.
import { expect, test } from '../../fixtures/live.js';
import { API, authHeaders, uploadedListingPhotos, uniqueMobile } from '../../helpers/liveAuth.js';

const CHECK = '/me/listings/duplicate-check';

// One doorway, in a locality the resolver knows so the address arm has a slug to scope by.
const ADDRESS = 'Flat 402, B Wing, Rohan Nilay';
const BASE_LISTING = {
  deal: 'rent',
  propertyType: 'Flat',
  price: 26000,
  city: 'Pune',
  locality: 'Baner',
  bhk: 2,
  area: 900,
};

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

// A fresh owner nobody else in this file shares, so no case can be polluted by another's fixture.
async function owner() {
  const mobile = uniqueMobile();
  return { mobile, headers: await authHeaders(mobile) };
}

// A listing created through the real owner route.
async function listing(headers, { address, meter, title = 'Bright 2BHK in Baner' }) {
  const created = await api('POST', '/me/listings', headers, {
    ...BASE_LISTING,
    title,
    address,
    images: await uploadedListingPhotos(headers),
    electricityMeterNo: meter,
  });
  expect(created.status).toBe(201);
  return created.body.id;
}

function check(headers, { address, meter }) {
  return api('POST', CHECK, headers, {
    locality: 'Baner',
    city: 'Pune',
    address,
    electricityMeterNo: meter,
  });
}

test.describe('LIVE — have I already listed this property?', () => {
  test('the meter number finds the listing the owner already has', async () => {
    const o = await owner();
    const meter = `MSEDCL-${Date.now()}`;
    const id = await listing(o.headers, { address: ADDRESS, meter });

    const res = await check(o.headers, { meter });
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.existingId).toBe(id);
  });

});
