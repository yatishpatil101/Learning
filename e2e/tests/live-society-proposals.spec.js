// @ts-check
// Community proposals, API-level, against the live backend. Edge cases are in SocietyProposalTest.
import { expect, test } from '@playwright/test';
import { API, apiLogin, authHeaders, uniqueMobile } from '../helpers/liveAuth.js';
import { mintSociety } from '../helpers/liveSociety.js';

/** The seeded platform admin. Real staff mobiles are not guessable and an invented one 403s. */
const OPS = '9000000000';

/** Shaped to survive the anchored regex the service validates against. */
const INVITE = 'https://chat.whatsapp.com/E2eProposals001';

const minted = new Set();

/**
 * A brand-new account, distinct from every other one this file makes.
 *
 * `uniqueMobile()` is derived from the clock, so two calls inside the same millisecond collide and
 * the second silently signs in as the first — which would turn "somebody else cannot overwrite
 * your pending proposal" into a test of whether you can overwrite your own.
 */
async function newAccount() {
  for (let i = 0; i < 40; i += 1) {
    const mobile = uniqueMobile();
    if (!minted.has(mobile)) {
      minted.add(mobile);
      await apiLogin(mobile, { api: API });
      return mobile;
    }
    await new Promise((r) => setTimeout(r, 2));
  }
  throw new Error('could not mint a unique mobile');
}

/**
 * A society nobody else in this run is proposing against, and that carries no pending proposal.
 *
 * Minted rather than searched for. `uq_society_proposal_pending` allows exactly one pending proposal
 * per society per kind, so a society that already carries one answers 409 to the first write of a
 * test that has not got as far as testing conflicts yet — and the seeded pending detail suggestion
 * sits on the alphabetically first unclaimed society, which is precisely what the old "take the
 * first unclaimed row" helper picked. Worse, its `taken` set was module-scoped and `fullyParallel`
 * runs this file's tests in separate workers, so the set never kept two of them apart. A society
 * that did not exist a moment ago has no pending anything, and nobody else is holding it.
 *
 * Unclaimed too, which keeps the authorisation assertions honest: the only insider is a resident
 * this test made.
 */
async function freshSociety(request) {
  return mintSociety(request, await newAccount(), 'Proposals');
}

/** Verify `mobile` into `flat` the long way round, through the ops queue. */
async function makeResident(request, mobile, slug, flat) {
  const applied = await request.post(`${API}/societies/${slug}/residents`, {
    headers: await authHeaders(mobile),
    data: { flat, relation: 'owner' },
  });
  expect(applied.status()).toBe(200);
  const { id } = await applied.json();

  const decided = await request.patch(`${API}/societies/${slug}/residents/${id}`, {
    headers: await authHeaders(OPS),
    data: { status: 'verified' },
  });
  expect(decided.status()).toBe(200);
}

async function propose(request, mobile, slug, data) {
  return request.post(`${API}/societies/${slug}/proposals`, {
    headers: await authHeaders(mobile),
    data,
  });
}

async function decide(request, id, status) {
  return request.patch(`${API}/admin/society-proposals/${id}`, {
    headers: await authHeaders(OPS),
    data: { status },
  });
}

test.describe('society community proposals', () => {
  test('an approved detail suggestion reaches the catalogue, and does not blank what it left out', async ({ request }) => {
    const slug = await freshSociety(request);
    const before = await (await request.get(`${API}/societies/${slug}`)).json();
    const author = await newAccount();

    // Deliberately partial. The dangerous version of this feature overwrites every column, so a
    // neighbour correcting the builder silently wipes the tower count somebody else contributed.
    const lodged = await propose(request, author, slug, {
      kind: 'details',
      builder: 'Sunteck Realty',
      towers: 6,
    });
    expect(lodged.status(), await lodged.text()).toBe(201);
    const { id, authorIsResident } = await lodged.json();
    // No flat, no claim: demanding a verified resident before accepting a builder name is what
    // leaves bulk-imported societies blank forever.
    expect(authorIsResident).toBe(false);

    expect((await decide(request, id, 'approved')).status()).toBe(200);

    const again = await decide(request, id, 'rejected');
    expect(again.status(), await again.text()).toBe(409);

    const after = await (await request.get(`${API}/societies/${slug}`)).json();
    expect(after.builder, 'the approved value survives the attempted reversal').toBe('Sunteck Realty');
    expect(after.towers).toBe(6);
    // The five columns the suggestion never mentioned are exactly as they were.
    expect(after.units).toBe(before.units);
    expect(after.year).toBe(before.year);
    expect(after.maintenancePerSqft).toBe(before.maintenancePerSqft);
    expect(after.amenities).toEqual(before.amenities);
  });

  test('the author is shown their own WhatsApp invite back, and the ops queue carries it without a mobile number', async ({ request }) => {
    const slug = await freshSociety(request);
    const resident = await newAccount();
    await makeResident(request, resident, slug, 'E-505');

    const lodged = await propose(request, resident, slug, { kind: 'whatsapp', inviteUrl: INVITE });
    expect(lodged.status(), await lodged.text()).toBe(201);
    expect((await lodged.json()).inviteUrl, 'the author is shown their own link back').toBe(INVITE);

    const res = await request.get(`${API}/admin/society-proposals?status=pending&kind=whatsapp`, {
      headers: await authHeaders(OPS),
    });
    expect(res.status()).toBe(200);
    const row = (await res.json()).content.find((p) => p.societySlug === slug);
    expect(row, 'the proposal just lodged is in the queue an operator reads').toBeTruthy();
    // Screening the link for a scam is the entire point of the review, and an operator cannot
    // screen what the response redacts.
    expect(row.inviteUrl).toBe(INVITE);
    expect(JSON.stringify(row)).not.toContain(resident);
  });
});
