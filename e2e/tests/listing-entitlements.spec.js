import { ACTORS, expect, test } from '../fixtures/live.js';
import { API, authHeaders, uploadedListingPhotos, uniqueMobile } from '../helpers/liveAuth.js';

const BODY = async (title, auth) => ({
  title,
  deal: 'rent',
  propertyType: 'apartment',
  price: 25000,
  locality: 'Kothrud',
  city: 'Pune',
  images: await uploadedListingPhotos(auth),
});

// `uniqueMobile()` can collide within one millisecond, merging distinct owners.
let seq = 0;
const newOwner = () => `${uniqueMobile().slice(0, -1)}${(seq++) % 10}`;

test.describe('listing quota (live)', () => {
  test('taking a listing down frees its slot', async ({ request }) => {
    const headers = await authHeaders(newOwner());

    const first = await request.post(`${API}/me/listings`, { headers, data: await BODY('Take-down probe', headers) });
    expect(first.status()).toBe(201);
    const id = (await first.json()).id;

    expect((await request.post(`${API}/me/listings`, { headers, data: await BODY('Blocked', headers) })).status()).toBe(422);

    const gone = await request.delete(`${API}/me/listings/${id}`, { headers });
    expect(gone.status()).toBe(200);
    // Soft, not destroyed: the listing is still there, and still says why it went.
    expect((await gone.json()).archived).toBe(true);

    const retry = await request.post(`${API}/me/listings`, { headers, data: await BODY('Allowed again', headers) });
    expect(retry.status()).toBe(201);
  });

  test('the seeded owner is over their ceiling and is told the numbers', async ({ request }) => {
    const headers = await authHeaders(ACTORS.owner);
    const res = await request.post(`${API}/me/listings`, { headers, data: await BODY('One too many', headers) });
    expect(res.status()).toBe(422);
    const err = await res.json();
    expect(err.error).toBe('listing_quota_exhausted');
    // Four listings against an allowance of one. The gate counts what is live, not what was posted.
    expect(err.message).toContain('of 1');
  });
});
