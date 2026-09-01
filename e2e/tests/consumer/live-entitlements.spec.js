/* The owner-contact quota, against the live API.
 *
 * This is the spec for D31b, and the thing it is really asserting is *where the number lives*.
 *
 * Until this change the quota was a browser fact: `dzContactsUsed:<mobile>` in localStorage, plus a
 * referral bonus the same browser had also counted, minus a limit the same browser enforced before
 * it made any request at all. Every one of those was defeated by clearing site data, and none of
 * them was visible from a second device. The mock suite could not have caught that, because on a
 * mock build the browser *is* the server and both halves agree by construction.
 *
 * So the assertions below are deliberately of two kinds:
 *
 *  1. **The used count is derived, not stored.** Nothing writes a counter. `used` is
 *     `count(contact_requests where requester = me)`, so it moves when a request row appears and
 *     stays put when a press does not create one. A second `POST /contacts/request` for the same
 *     listing is idempotent — `uq_contact_requests_requester_property` (V9) sees to that — and must
 *     therefore cost nothing, which is the property a stored counter would get wrong the first time
 *     somebody double-clicked.
 *
 *  2. **The referral bonus is derived too.** `referralBonus` is recomputed from the referrals that
 *     justify it every time it is asked for, rather than being added to a balance at approval time.
 *     That is what makes a clawback whole: there is no grant to reverse.
 *
 * Fixtures: created here, not seeded. A spec that spends a quota mutates the account it runs as, so
 * it invents its own numbers with `uniqueMobile()` rather than editing a fixture other specs assert
 * against. The seeded catalogue supplies the listings to spend contacts on.
 */
import { test, expect } from '../../fixtures/live.js';
import { API, apiLogin, uniqueMobile } from '../../helpers/liveAuth.js';

const auth = (token) => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

/** `settings.fees.freeContactLimit` — the free tier, mirrored so a drift shows up as a failure. */
const FREE_LIMIT = 15;

/** A handful of live listing ids to spend contacts against. */
async function someListingIds(count) {
  const res = await fetch(`${API}/properties?size=${count}`);
  expect(res.status).toBe(200);
  const rows = (await res.json()).content;
  expect(rows.length, 'the seeded catalogue has listings to contact').toBeGreaterThanOrEqual(count);
  return rows.map((r) => r.id);
}

const entitlements = async (token) =>
  fetch(`${API}/me/entitlements`, { headers: auth(token) }).then((r) => r.json());

const askFor = async (token, propertyId) =>
  fetch(`${API}/contacts/request`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify({ propertyId }),
  });

test('the entitlement is the signed-in user’s own, and anonymous callers get nothing', async () => {
  const bare = await fetch(`${API}/me/entitlements`);
  expect(bare.status, 'a quota is a fact about a person, so it needs one').toBe(401);
});

test('a fresh account starts on the free allowance and nothing is stored to make it so', async () => {
  const { accessToken } = await apiLogin(uniqueMobile());
  const ent = await entitlements(accessToken);

  expect(ent.contacts.unlimited).toBe(false);
  expect(ent.contacts.used, 'an account that has contacted nobody has spent nothing').toBe(0);
  expect(ent.contacts.allowance).toBe(FREE_LIMIT);
  expect(ent.contacts.remaining).toBe(FREE_LIMIT);
  expect(ent.contacts.referralBonus, 'no referrals, no bonus').toBe(0);

  /* The listing half comes along on the same read. It is reported and — for now — deliberately not
     enforced on `POST /me/listings`; see the D31b entry in docs/system/open-questions.md. A spec
     asserting the ceiling *blocks* a post would be asserting something this change did not build. */
  expect(ent.listings.allowance).toBeGreaterThanOrEqual(1);
  expect(ent.listings.referralBonus).toBe(0);
});

test('opening a contact spends exactly one, and re-opening the same one spends nothing', async () => {
  const { accessToken } = await apiLogin(uniqueMobile());
  const [first] = await someListingIds(1);

  expect((await askFor(accessToken, first)).status).toBe(200);
  const after = await entitlements(accessToken);
  expect(after.contacts.used).toBe(1);
  expect(after.contacts.remaining).toBe(FREE_LIMIT - 1);

  /* The press that costs nothing. `POST /contacts/request` is idempotent per (requester, listing),
     so this returns the existing gate rather than opening a second door — and a used count that is
     a row count, rather than a tally of presses, cannot charge for it. */
  expect((await askFor(accessToken, first)).status).toBe(200);
  const again = await entitlements(accessToken);
  expect(again.contacts.used, 'a repeat request is the same door, not a second one').toBe(1);
  expect(again.contacts.remaining).toBe(FREE_LIMIT - 1);
});

test('the allowance is a wall, and it is the server that holds it', async () => {
  const { accessToken } = await apiLogin(uniqueMobile());
  const ids = await someListingIds(FREE_LIMIT + 1);

  for (const id of ids.slice(0, FREE_LIMIT)) {
    expect((await askFor(accessToken, id)).status, 'the free allowance is spendable in full').toBe(200);
  }

  const spent = await entitlements(accessToken);
  expect(spent.contacts.used).toBe(FREE_LIMIT);
  expect(spent.contacts.remaining).toBe(0);

  /* 422 with a code, not 403 and not a silently empty gate. The wire field is `error` — the seam's
     `http.js` renames it to `code` on the way into `ApiError`, which is what the two call sites
     branch on, so the assertion here has to speak the envelope's own name. */
  const refused = await askFor(accessToken, ids[FREE_LIMIT]);
  expect(refused.status).toBe(422);
  expect((await refused.json()).error).toBe('contact_quota_exhausted');

  /* And the refusal cost nothing. A gate that charged for the press it refused would drift the
     counter every time an exhausted user tried again. */
  const after = await entitlements(accessToken);
  expect(after.contacts.used).toBe(FREE_LIMIT);

  /* Exhaustion never closes a door already open. The buyer still has fifteen conversations they
     paid for, and re-reading any of them must keep working. */
  expect((await askFor(accessToken, ids[0])).status, 'an open request survives exhaustion').toBe(200);
});
