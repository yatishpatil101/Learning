/**
 * LIVE: "have I already listed this?" — the owner-scoped duplicate pre-check.
 *
 * ## The bug this suite exists to keep closed
 *
 * The listing wizard asked this question in the browser. `evaluateListingDedup` scanned
 * `rawDb().listings` — the mock store — and blocked the submission if any listing there shared the
 * unit's identity with the same owner mobile. Against a live API that store is the seeded demo
 * catalogue, 38 fixtures nobody signed in as. So the guard had both failure modes at once:
 *
 *   - it could stop a **real owner** because a fixture happened to share their society and flat
 *     number, and
 *   - the "go to the listing you already have" link it then offered named a **fixture id the server
 *     had never issued**, so it opened an empty form under a sentence claiming otherwise.
 *
 * Register item 23. The fix is this route: the same two signals, read server-side, over the
 * caller's own listings only.
 *
 * ## What is deliberately not here
 *
 * This is not the staff duplicate probe. That one reads *other people's* listings and is
 * advisory — "a collision is a suspicion, not a finding" — and it is staff-only precisely because
 * an owner-facing version of it would turn a guessed meter number into a lookup on a stranger's
 * utility account. The cross-owner test below is the assertion that the two never merged.
 *
 *   cd e2e; npx playwright test tests/platform/live-own-duplicate.spec.js --config=playwright.live.config.js
 */
import { expect, test } from '../../fixtures/live.js';
import { API, authHeaders, uniqueMobile } from '../../helpers/liveAuth.js';

const CHECK = '/me/listings/duplicate-check';

/** One doorway, in a locality the resolver knows so the address arm has a slug to scope by. */
const ADDRESS = 'Flat 402, B Wing, Rohan Nilay';
/** The same doorway as somebody else would write it. Sorted tokens, fillers dropped, same key. */
const ADDRESS_REPHRASED = 'B-402, Rohan Nilay Society, Baner, Pune 411045';

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

/** A fresh owner nobody else in this file shares, so no case can be polluted by another's fixture. */
async function owner() {
  const mobile = uniqueMobile();
  return { mobile, headers: await authHeaders(mobile) };
}

/**
 * A listing created through the real owner route.
 *
 * Never by writing `address_key` directly: the whole claim of this endpoint is that it derives the
 * same key the create derives, and a fixture that set the key by hand would assert that claim
 * against itself.
 */
async function listing(headers, { address, meter, title = 'Bright 2BHK in Baner' }) {
  const created = await api('POST', '/me/listings', headers, {
    ...BASE_LISTING,
    title,
    address,
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

  test('the id it hands back is one the server will actually open', async () => {
    const o = await owner();
    const meter = `MSEDCL-${Date.now()}-open`;
    await listing(o.headers, { address: ADDRESS, meter });

    const res = await check(o.headers, { meter });
    expect(res.body.found).toBe(true);

    // The regression in one line. The old guard named ids out of a demo fixture set, so this
    // request is what it could never survive: ask the server for the listing it just told the owner
    // they already have.
    const opened = await api('GET', `/me/listings/${res.body.existingId}`, o.headers);
    expect(opened.status).toBe(200);
  });

  test('the same doorway written differently still matches — the key is normalised, not the string', async () => {
    const o = await owner();
    const id = await listing(o.headers, { address: ADDRESS });

    const res = await check(o.headers, { address: ADDRESS_REPHRASED });
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(true);
    expect(res.body.existingId).toBe(id);
  });

  test("another owner's identical listing is invisible here", async () => {
    const stranger = await owner();
    const meter = `MSEDCL-${Date.now()}-stranger`;
    await listing(stranger.headers, { address: ADDRESS, meter });

    // Both signals point at a real listing. It is not this caller's, so as far as this route is
    // concerned it does not exist — otherwise typing a guessed meter number becomes a way to ask
    // the platform who else has registered it.
    const nosy = await owner();
    const res = await check(nosy.headers, { address: ADDRESS, meter });
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(false);
    expect(res.body.existingId ?? null).toBeNull();
  });

  test('a different flat in the same building is not a duplicate', async () => {
    const o = await owner();
    await listing(o.headers, { address: ADDRESS });

    const res = await check(o.headers, { address: 'Flat 403, B Wing, Rohan Nilay' });
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(false);
  });

  test('with neither signal it answers no, rather than matching everything', async () => {
    const o = await owner();
    await listing(o.headers, { address: ADDRESS, meter: `MSEDCL-${Date.now()}-none` });

    const res = await check(o.headers, {});
    expect(res.status).toBe(200);
    expect(res.body.found).toBe(false);
  });

  test('an over-long meter number is refused rather than truncated into somebody else\'s key', async () => {
    const o = await owner();

    const res = await check(o.headers, { meter: 'M'.repeat(65) });
    // 422, not 400: the repo reserves 400 for a request the server could not parse and 422 for one
    // it parsed and then refused on a field.
    expect(res.status).toBe(422);
  });

  test('a signed-out caller has no listings to ask about', async () => {
    const res = await api('POST', CHECK, { 'Content-Type': 'application/json' }, {
      locality: 'Baner', city: 'Pune', address: ADDRESS,
    });
    expect(res.status).toBe(401);
  });
});
