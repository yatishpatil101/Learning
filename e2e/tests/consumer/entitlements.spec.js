/* The quota lives on the server: "used" counts contact_requests rows and referralBonus is recomputed, not stored;
   specs mint their own accounts (uniqueMobile) because spending a quota mutates the account it runs as. */
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

  /* The listing ceiling is reported but not enforced on POST /me/listings; see docs/system/open-questions.md. */
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

  /* A repeat press is idempotent per (requester, listing): same gate back, and a row-count used cannot charge. */
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

  /* 422 with a code, not 403; the wire field is `error` and http.js renames it to `code` on ApiError. */
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
