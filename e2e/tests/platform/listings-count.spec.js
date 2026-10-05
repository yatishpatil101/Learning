import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders, uploadedListingPhotos, uniqueMobile } from '../../helpers/liveAuth.js';
import { rejectListing } from '../../helpers/moderation.js';

const BASE_LISTING = {
  deal: 'rent',
  propertyType: 'Flat',
  price: 24000,
  city: 'Pune',
  bhk: 2,
  area: 720,
  locality: 'Baner',
};

// Owners minted here, so their listings can be taken back out of the catalogue.
const owners = new Set();

test.afterEach(async ({ request }) => {
  if (!owners.size) return;
  const adminHeaders = await authHeaders(ACTORS.admin);
  for (const mobile of owners) {
    const res = await fetch(`${API}/me/listings`, { headers: await authHeaders(mobile) });
    // Soft-fail teardown reads so leaked Zztest rows do not accumulate silently.
    expect.soft(res.status, `teardown could not list ${mobile}'s listings`).toBe(200);
    if (res.status !== 200) continue;
    const body = await res.json();
    const rows = Array.isArray(body) ? body : (body.content ?? body.items ?? []);
    for (const row of rows) {
      const patched = await rejectListing(request, row.id, adminHeaders, {
        reasonCode: 'other',
        reason: 'Zztest cleanup — listings_count fixture',
      });
      expect.soft(patched.status(), await patched.text()).toBe(200);
    }
  }
  owners.clear();
});

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null) };
}

// A brand-new account, plus its auth headers.
async function newOwner() {
  const mobile = uniqueMobile();
  const headers = await authHeaders(mobile);
  owners.add(mobile);
  return { mobile, headers };
}

test.describe('listings_count — live', () => {
  test('a new account starts at zero and is not an owner', async () => {
    const { headers } = await newOwner();

    // Publication counts track the persona's history, not current public inventory.
    const me = await api('GET', '/auth/me', headers);
    expect(me.status).toBe(200);
    // Asserted as the number 0, not as falsy.
    expect(me.body.listingsCount).toBe(0);
    // And the role is still `buyer`.
    expect(me.body.role).toBe('buyer');
  });

  test('posting a listing makes the account an owner', async () => {
    const { headers } = await newOwner();

    const created = await api('POST', '/me/listings', headers, {
      ...BASE_LISTING,
      title: `Zztest listings_count ${Date.now()}`,
      images: await uploadedListingPhotos(headers),
    });
    expect(created.status).toBe(201);

    const me = await api('GET', '/auth/me', headers);
    expect(me.status).toBe(200);
    expect(me.body.listingsCount).toBe(1);

    expect(me.body.role).toBe('buyer');
  });

  test('the count survives the listing being rejected', async ({ request }) => {
    const { headers } = await newOwner();

    const created = await api('POST', '/me/listings', headers, {
      ...BASE_LISTING,
      title: `Zztest listings_count rejected ${Date.now()}`,
      images: await uploadedListingPhotos(headers),
    });
    expect(created.status).toBe(201);

    const adminHeaders = await authHeaders(ACTORS.admin);
    const rejected = await rejectListing(request, created.body.id, adminHeaders, {
      reasonCode: 'other',
      reason: 'Zztest — proving the lifetime counter does not decrement',
    });
    expect(rejected.status(), await rejected.text()).toBe(200);

    const me = await api('GET', '/auth/me', headers);
    expect(me.status).toBe(200);
    expect(me.body.listingsCount).toBe(1);
  });
});
