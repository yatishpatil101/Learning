import { ACTORS, expect, test } from '../fixtures/live.js';
import { API, authHeaders, uniqueMobile } from '../helpers/liveAuth.js';

/* The listing ceiling, and the exit from it.

   Until D234 the freemium listing limit existed only in the browser: the wizard compared a count it
   held in localStorage against an allowance it had partly minted for itself, and `POST /me/listings`
   accepted whatever it was sent. A paywall the client could decline to apply is not a paywall, and
   the fastest way past it was to clear site data.

   It is now `422 listing_quota_exhausted`, and because a ceiling with no exit is a trap rather than
   a tier, `DELETE /me/listings/{id}` takes a listing down and frees its slot. These tests are about
   that pair — the refusal, and the way back out. `agreements.free` is here too because it is the
   other half of the same change: the free-rent-agreement perk stopped being a local division of a
   local counter.

   Actors: a NEW owner each time, deliberately. The seeded owner (Meera Deshpande) holds four
   listings against a free-tier allowance of one, so she can no longer post at all — a fixture that
   is useful for exactly one assertion here and useless for the rest. */

const BODY = (title) => ({
  title,
  deal: 'rent',
  propertyType: 'apartment',
  price: 25000,
  locality: 'Kothrud',
  city: 'Pune',
});

/* A fresh account per assertion. `uniqueMobile()` is `Date.now()`-derived, so two calls inside the
   same millisecond return the same number — which would silently make two "different" owners one
   owner, and one of the tests below turns on exactly that distinction. The counter makes the
   collision impossible rather than unlikely. */
let seq = 0;
const newOwner = () => `${uniqueMobile().slice(0, -1)}${(seq++) % 10}`;

test.describe('listing quota (live)', () => {
  test('the free tier is one live listing, and the refusal says so', async ({ request }) => {
    const headers = await authHeaders(newOwner());

    const first = await request.post(`${API}/me/listings`, { headers, data: BODY('Quota probe one') });
    expect(first.status()).toBe(201);

    const second = await request.post(`${API}/me/listings`, { headers, data: BODY('Quota probe two') });
    expect(second.status()).toBe(422);
    const err = await second.json();
    expect(err.error).toBe('listing_quota_exhausted');
    /* The message has to name the arithmetic. "You have reached your limit" leaves the owner with
       no way to tell whether they are one over or ten over, and therefore no way to tell whether
       taking one listing down would help. */
    expect(err.message).toContain('1 of 1');
  });

  test('taking a listing down frees its slot', async ({ request }) => {
    const headers = await authHeaders(newOwner());

    const first = await request.post(`${API}/me/listings`, { headers, data: BODY('Take-down probe') });
    expect(first.status()).toBe(201);
    const id = (await first.json()).id;

    expect((await request.post(`${API}/me/listings`, { headers, data: BODY('Blocked') })).status()).toBe(422);

    const gone = await request.delete(`${API}/me/listings/${id}`, { headers });
    expect(gone.status()).toBe(200);
    // Soft, not destroyed: the listing is still there, and still says why it went.
    expect((await gone.json()).archived).toBe(true);

    const retry = await request.post(`${API}/me/listings`, { headers, data: BODY('Allowed again') });
    expect(retry.status()).toBe(201);
  });

  test('one owner cannot take down another owner\'s listing', async ({ request }) => {
    const a = await authHeaders(newOwner());
    const b = await authHeaders(newOwner());

    const mine = await request.post(`${API}/me/listings`, { headers: a, data: BODY('Not yours') });
    expect(mine.status()).toBe(201);
    const id = (await mine.json()).id;

    /* 404, not 403. A 403 would confirm the id names a real listing to somebody who has no business
       knowing that, which turns the endpoint into an existence oracle for anyone with a uuid. */
    expect((await request.delete(`${API}/me/listings/${id}`, { headers: b })).status()).toBe(404);
  });

  test('the seeded owner is over their ceiling and is told the numbers', async ({ request }) => {
    const headers = await authHeaders(ACTORS.owner);
    const res = await request.post(`${API}/me/listings`, { headers, data: BODY('One too many') });
    expect(res.status()).toBe(422);
    const err = await res.json();
    expect(err.error).toBe('listing_quota_exhausted');
    // Four listings against an allowance of one. The gate counts what is live, not what was posted.
    expect(err.message).toContain('of 1');
  });
});

test.describe('entitlements: free rent agreements (live)', () => {
  test('a user with no qualified referrals has earned none', async ({ request }) => {
    const headers = await authHeaders(ACTORS.owner);
    const res = await request.get(`${API}/me/entitlements`, { headers });
    expect(res.status()).toBe(200);
    const ent = await res.json();

    /* Present and zero, not absent. The Refer page renders this number directly, and a missing
       field and an earned-nothing field look identical to `?? 0` — which is exactly how a broken
       endpoint would go unnoticed. */
    expect(ent.agreements).toBeTruthy();
    expect(ent.agreements.free).toBe(0);
    // The listing allowance is the other half of the same derivation, and it is the free tier's one.
    expect(ent.listings.allowance).toBe(1);
    expect(ent.listings.referralBonus).toBe(0);
  });
});
