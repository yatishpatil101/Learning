// Stranger reads get 404 to avoid confirming a listing is under review.
import { expect, test, STAFF } from '../../fixtures/live.js';
import { API, apiLogin, uploadedListingPhotos, uniqueMobile } from '../../helpers/liveAuth.js';

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

async function api(method, path, token, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: auth(token),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function ok(method, path, token, body) {
  const res = await api(method, path, token, body);
  if (res.status >= 400) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

// Use an isolated owner because seeded owner listing counts are load-bearing elsewhere.
async function freshUser() {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);
  return { mobile, token: accessToken };
}

async function listingUnderReview(ownerToken, staffToken) {
  const { id } = await ok('POST', '/me/listings', ownerToken, {
    title: '2BHK in Kothrud',
    deal: 'rent',
    propertyType: 'apartment',
    price: 32000,
    bhk: 2,
    locality: 'Kothrud',
    city: 'Pune',
    images: await uploadedListingPhotos(ownerToken),
  });
  // The case has to be opened explicitly — creating a listing does not open one. This is the same
  // call `PropertyReviewModal` makes when the desk opens a listing.
  await ok('POST', `/properties/${id}/verification`, staffToken);
  return id;
}

test.describe('LIVE: who may read and who may decide a verification case', () => {
  test('a stranger gets the same 404 as a missing listing, and cannot decide', async () => {
    const owner = await freshUser();
    const { accessToken: staffToken } = await apiLogin(STAFF.rental);
    const id = await listingUnderReview(owner.token, staffToken);
    const stranger = await freshUser();

    expect((await api('GET', `/properties/${id}/verification`, owner.token)).status).toBe(200);
    expect((await api('GET', `/properties/${id}/verification`, staffToken)).status).toBe(200);

    expect((await api('POST', `/properties/${id}/verification/messages`, stranger.token,
      { body: 'let me in' })).status).toBe(404);
    expect((await api('POST', `/properties/${id}/verification/read`, stranger.token)).status).toBe(404);
    expect((await api('POST', `/properties/${id}/verification`, stranger.token)).status).toBe(404);

    const hidden = await api('GET', `/properties/${id}/verification`, stranger.token);
    const absent = await api('GET', '/properties/00000000-0000-0000-0000-000000000000/verification',
      stranger.token);
    expect(hidden.status).toBe(404);
    expect(absent.status).toBe(404);
    expect(hidden.body.error).toBe(absent.body.error);
    expect(hidden.body.message).toBe(absent.body.message);

    // 403, not 404: `@PreAuthorize` runs before the id is looked up.
    expect((await api('POST', `/properties/${id}/verification/decision`, stranger.token,
      { decision: 'approve' })).status).toBe(403);
    expect((await api('PATCH', `/properties/${id}/verification/checklist`, stranger.token,
      { item: 'ownership', pass: true })).status).toBe(403);
    expect((await api('GET', '/admin/bell', stranger.token)).status).toBe(403);

    const after = await ok('GET', `/me/listings/${id}`, owner.token);
    expect(after.status).toBe('pending');
  });
});