/* What the verification workflow *refuses*: a stranger gets 404, since a 403 would confirm the
   listing is under review; the staff-only routes answer 403, whose guard is a role, not a row. */
import { expect, test, STAFF } from '../../fixtures/live.js';
import { API, apiLogin, uniqueMobile } from '../../helpers/liveAuth.js';

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

/* A registered person nobody else in the suite shares: the seeded owner's listing count is
   load-bearing elsewhere, and a spec that adds a listing breaks a spec that counts them. */
async function freshUser() {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);
  return { mobile, token: accessToken };
}

/** One listing with an open case file — the state all four refusals below are measured against. */
async function listingUnderReview(ownerToken, staffToken) {
  const { id } = await ok('POST', '/me/listings', ownerToken, {
    title: '2BHK in Kothrud',
    deal: 'rent',
    propertyType: 'apartment',
    price: 32000,
    bhk: 2,
    locality: 'Kothrud',
    city: 'Pune',
  });
  // The case has to be opened explicitly — creating a listing does not open one. This is the same
  // call `PropertyReviewModal` makes when the desk opens a listing.
  await ok('POST', `/properties/${id}/verification`, staffToken);
  return id;
}

test.describe('LIVE: who may read and who may decide a verification case', () => {
  test('a stranger is told the case does not exist, not that they may not see it', async () => {
    const owner = await freshUser();
    const { accessToken: staffToken } = await apiLogin(STAFF.rental);
    const id = await listingUnderReview(owner.token, staffToken);

    // The owner and staff are the two participants, and both can read it. Asserted first so that a
    // failure below cannot be explained away as "the case was never created".
    expect((await api('GET', `/properties/${id}/verification`, owner.token)).status).toBe(200);
    expect((await api('GET', `/properties/${id}/verification`, staffToken)).status).toBe(200);

    // A third, ordinary, signed-in person. Authenticated — so this is not a test of the login wall,
    // which would pass even if the participant check had been deleted.
    const stranger = await freshUser();
    expect((await api('GET', `/properties/${id}/verification`, stranger.token)).status).toBe(404);

    // The same shape on every thread route: a guard that holds on the read and leaks on the write is
    // the usual failure, and posting would put a stranger's words in the owner's conversation.
    expect((await api('POST', `/properties/${id}/verification/messages`, stranger.token,
      { body: 'let me in' })).status).toBe(404);
    expect((await api('POST', `/properties/${id}/verification/read`, stranger.token)).status).toBe(404);
    expect((await api('POST', `/properties/${id}/verification`, stranger.token)).status).toBe(404);
  });

  test('the 404 a stranger gets is the same one a nonexistent listing gets', async () => {
    const owner = await freshUser();
    const { accessToken: staffToken } = await apiLogin(STAFF.rental);
    const real = await listingUnderReview(owner.token, staffToken);
    const stranger = await freshUser();

    // The *bodies* must match too, not just the codes: two distinguishable 404s — "no such listing"
    // and "not yours" — restore the oracle the status code was chosen to remove.
    const hidden = await api('GET', `/properties/${real}/verification`, stranger.token);
    const absent = await api('GET', '/properties/00000000-0000-0000-0000-000000000000/verification',
      stranger.token);

    expect(hidden.status).toBe(404);
    expect(absent.status).toBe(404);
    expect(hidden.body.error).toBe(absent.body.error);
    // `traceId` is per-request and `message` is the only other field, so this compares the whole
    // discriminating surface.
    expect(hidden.body.message).toBe(absent.body.message);
  });

  test('an ordinary signed-in user cannot decide, and is refused for who they are', async () => {
    const owner = await freshUser();
    const { accessToken: staffToken } = await apiLogin(STAFF.rental);
    const id = await listingUnderReview(owner.token, staffToken);
    const stranger = await freshUser();

    // 403, not 404: `@PreAuthorize` runs before the method, so the id is never looked up and
    // nothing about the row can leak through a decision that was never reached.
    expect((await api('POST', `/properties/${id}/verification/decision`, stranger.token,
      { decision: 'approve' })).status).toBe(403);
    expect((await api('PATCH', `/properties/${id}/verification/checklist`, stranger.token,
      { item: 'ownership', pass: true })).status).toBe(403);

    // The staff queue is a list of other people's case files, so it carries the same role guard as
    // the decision rather than the thread's participant guard.
    expect((await api('GET', '/admin/property-reviews', stranger.token)).status).toBe(403);

    // The listing is untouched. A guard that refuses and writes anyway only looks like one from the
    // caller's side — the check is on the response, the damage would be in the database.
    const after = await ok('GET', `/me/listings/${id}`, owner.token);
    expect(after.status).toBe('pending');
  });

  test('the owner cannot approve their own listing even when they are staff', async () => {
    // The maker-checker rule: a staffer who lists their own flat is a participant *and* holds
    // `properties:write`, so every guard above passes and nobody would have read the listing.
    const { accessToken: staffToken } = await apiLogin(STAFF.rental);
    const id = await listingUnderReview(staffToken, staffToken);

    const refused = await api('POST', `/properties/${id}/verification/decision`, staffToken,
      { decision: 'approve', note: 'looks fine to me' });
    expect(refused.status).toBe(403);

    // Separates "the maker-checker rule works" from "the decision route is broken": without this, a
    // route that answered 403 to everyone would pass the assertion above.
    const { accessToken: otherStaff } = await apiLogin(STAFF.legal);
    const decided = await ok('POST', `/properties/${id}/verification/decision`, otherStaff,
      { decision: 'approve', note: 'checked' });
    expect(decided.status).toBe('approved');
  });
});
