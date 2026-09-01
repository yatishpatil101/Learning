/**
 * Who may read and who may decide a verification case file — against the **live** backend.
 *
 * ## Why this is a separate spec from `live-verification-thread.spec.js`
 *
 * That one asserts what the workflow *does*. This one asserts what it *refuses*, and the two fail
 * for different reasons: a broken workflow is a bug report, a broken refusal is a disclosure. Kept
 * apart so that a red line here is unambiguous about which of those just happened.
 *
 * ## Why it can only be a live spec
 *
 * Every assertion below is about a status code produced by a guard that exists only on the server.
 * The mock provider has no notion of a caller at all — it reads a browser store — so a mock-mode
 * version of this file would assert that a stub returns what the stub was written to return. The
 * guard being tested is `PropertyVerificationService.participantProperty` plus the `@PreAuthorize`
 * on `decide`/`checklist`, and neither has a browser-side counterpart to stand in for it.
 *
 * ## The two shapes, and why they differ
 *
 * A caller who is neither participant nor staff gets **404** on the thread routes. Not 403: a 403
 * confirms that a listing with that id exists and is under review, which is precisely the fact
 * worth probing for — a competitor walking ids could map who is under moderation without ever
 * reading a message. The absence has to be indistinguishable from "no such case".
 *
 * The staff-only routes answer **403**, and that is correct rather than inconsistent. Their guard is
 * a role, not a relationship: the caller is refused for who they are, not for what they may or may
 * not be looking at, so the response leaks nothing about the row. `/verification/decision` is also
 * a route an authenticated non-staff user has no legitimate reason to have found, whereas the
 * thread is a route the owner is *supposed* to call.
 *
 *   cd e2e; npx playwright test tests/ops/live-verification-access.spec.js --config=playwright.live.config.js
 */
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

/**
 * A registered person nobody else in the suite shares.
 *
 * Fresh rather than borrowed from `ACTORS` for the same reason `live-verification-thread` mints
 * its own: the seeded owner's listing count is load-bearing for `live-property-integration`, and
 * a spec that adds a listing to a shared fixture breaks a spec that counts them.
 */
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

    // And the same shape on every other thread route, because a guard that holds on the read and
    // leaks on the write is the usual way this goes wrong: the read is the one everybody remembers
    // to test. Posting is the worst of the three — it would put a stranger's words in a
    // conversation between an owner and the desk, attributed to neither.
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

    // This is the assertion that makes the choice of 404 mean something. Two different 404s — one
    // saying "no such listing" and one saying "not yours" — would restore the oracle the status
    // code was chosen to remove: the attacker does not need the door opened, only a reply that
    // differs. So the *bodies* have to match too, not just the codes.
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

    // 403, not 404, and the difference is deliberate: `@PreAuthorize` runs before the method, so
    // the refusal happens without the id ever being looked up. Nothing about the row can leak
    // through a decision that was never reached.
    expect((await api('POST', `/properties/${id}/verification/decision`, stranger.token,
      { decision: 'approve' })).status).toBe(403);
    expect((await api('PATCH', `/properties/${id}/verification/checklist`, stranger.token,
      { item: 'ownership', pass: true })).status).toBe(403);

    // The staff queue is a list of other people's case files, so it carries the same role guard as
    // the decision rather than the thread's participant guard.
    expect((await api('GET', '/admin/property-reviews', stranger.token)).status).toBe(403);

    // The listing is untouched. A guard that refuses and writes anyway is a guard that only looks
    // like one from the caller's side — worth one assertion, because the check is on the response
    // and the damage would be in the database.
    const after = await ok('GET', `/me/listings/${id}`, owner.token);
    expect(after.status).toBe('pending');
  });

  test('the owner cannot approve their own listing even when they are staff', async () => {
    // The maker-checker rule, and the only refusal here that is not about roles at all. A staffer
    // who lists their own flat is a participant *and* holds `properties:write`, so every guard
    // above passes and the listing would sail through with nobody having read it. `decide` checks
    // the owner id separately for exactly this case.
    const { accessToken: staffToken } = await apiLogin(STAFF.rental);
    const id = await listingUnderReview(staffToken, staffToken);

    const refused = await api('POST', `/properties/${id}/verification/decision`, staffToken,
      { decision: 'approve', note: 'looks fine to me' });
    expect(refused.status).toBe(403);

    // A second staffer, with no relationship to the listing, decides it without complaint. This is
    // what separates "the maker-checker rule works" from "the decision route is broken" — without
    // it, a route that answered 403 to everyone would pass the assertion above.
    const { accessToken: otherStaff } = await apiLogin(STAFF.legal);
    const decided = await ok('POST', `/properties/${id}/verification/decision`, otherStaff,
      { decision: 'approve', note: 'checked' });
    expect(decided.status).toBe('approved');
  });
});
