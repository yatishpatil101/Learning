// @ts-check
/**
 * Community proposals against the live API (D242 slice 4) — detail suggestions, the resident
 * WhatsApp invite, and corrected map pins.
 *
 * These three were the most complete pieces of theatre in the product. A resident who spent ten
 * minutes filling in their society's builder, year, tower count and amenities sent that work to
 * `dzSocietySuggestions` in their own browser and nowhere else. The ops queue meant to review it
 * read the *reviewer's* browser, so it was permanently empty. Same for the WhatsApp invite — the
 * one control on the page that connects a new neighbour to the people already there — and same for
 * a corrected map pin, so every society imported with a bad coordinate stayed wrong for everybody
 * however many residents fixed it on their own screen.
 *
 * API-level rather than a browser walk, like its sibling society specs: what is being proved is
 * that the proposal leaves the device, that the server decides who may propose and who may see the
 * invite, and that an approval actually reaches the catalogue. The hub does not call these
 * endpoints until slice C7 repoints it.
 */
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
    const { id } = await lodged.json();

    expect((await decide(request, id, 'approved')).status()).toBe(200);

    const after = await (await request.get(`${API}/societies/${slug}`)).json();
    expect(after.builder).toBe('Sunteck Realty');
    expect(after.towers).toBe(6);
    // The five columns the suggestion never mentioned are exactly as they were.
    expect(after.units).toBe(before.units);
    expect(after.year).toBe(before.year);
    expect(after.maintenancePerSqft).toBe(before.maintenancePerSqft);
    expect(after.amenities).toEqual(before.amenities);
  });

  test('anyone signed in may suggest details — that is how a thin society gets filled in', async ({ request }) => {
    const slug = await freshSociety(request);
    // No flat here, no claim, nothing. The whole point: demanding a verified resident before
    // accepting a builder name is what leaves bulk-imported societies blank forever.
    const stranger = await newAccount();

    const res = await propose(request, stranger, slug, { kind: 'details', builder: 'Kolte Patil' });
    expect(res.status(), await res.text()).toBe(201);
    expect((await res.json()).authorIsResident).toBe(false);
  });

  test('the WhatsApp invite is withheld from a stranger, approved or not', async ({ request }) => {
    const slug = await freshSociety(request);
    const resident = await newAccount();
    await makeResident(request, resident, slug, 'C-1201');

    const lodged = await propose(request, resident, slug, { kind: 'whatsapp', inviteUrl: INVITE });
    expect(lodged.status(), await lodged.text()).toBe(201);
    const lodgedBody = await lodged.json();
    expect(lodgedBody.inviteUrl, 'the author is shown their own link back').toBe(INVITE);
    expect((await decide(request, lodgedBody.id, 'approved')).status()).toBe(200);

    // Signed out. Told the group is there — the nudge to verify a flat — and nothing more.
    const anon = await request.get(`${API}/societies/${slug}/proposals`);
    expect(anon.status()).toBe(200);
    const anonView = await anon.json();
    expect(anonView.whatsappAvailable).toBe(true);
    expect(anonView.whatsappJoinUrl).toBeNull();

    // Signed in, but with no flat in this building. Same answer: the invite is a key to a private
    // resident space, and an account is not a flat.
    const outsider = await newAccount();
    const seen = await request.get(`${API}/societies/${slug}/proposals`, {
      headers: await authHeaders(outsider),
    });
    expect((await seen.json()).whatsappJoinUrl).toBeNull();

    // The resident who lives there gets it.
    const insider = await request.get(`${API}/societies/${slug}/proposals`, {
      headers: await authHeaders(resident),
    });
    expect((await insider.json()).whatsappJoinUrl).toBe(INVITE);
  });

  test('a stranger cannot post the group link at all', async ({ request }) => {
    const slug = await freshSociety(request);
    const stranger = await newAccount();

    const res = await propose(request, stranger, slug, { kind: 'whatsapp', inviteUrl: INVITE });
    expect(res.status(), await res.text()).toBe(403);
  });

  test('a link that only contains a WhatsApp URL is refused', async ({ request }) => {
    const slug = await freshSociety(request);
    const resident = await newAccount();
    await makeResident(request, resident, slug, 'A-101');

    // The exact shape an unanchored regex waves through, and the exact link an operator glancing
    // at a queue would approve.
    const res = await propose(request, resident, slug, {
      kind: 'whatsapp',
      inviteUrl: 'https://evil.example/?x=https://chat.whatsapp.com/AAAAAAAA',
    });
    expect(res.status(), await res.text()).toBe(400);
  });

  test('an approved pin moves the society and says a neighbour moved it', async ({ request }) => {
    const slug = await freshSociety(request);
    const resident = await newAccount();
    await makeResident(request, resident, slug, 'D-404');

    const lodged = await propose(request, resident, slug, {
      kind: 'location',
      lat: 18.5211,
      lng: 73.8567,
      placeId: 'ChIJe2eProposalsPin01',
      label: 'Main gate',
    });
    expect(lodged.status(), await lodged.text()).toBe(201);
    const { id } = await lodged.json();
    expect((await decide(request, id, 'approved')).status()).toBe(200);

    const after = await (await request.get(`${API}/societies/${slug}`)).json();
    expect(after.lat).toBeCloseTo(18.5211, 4);
    expect(after.lng).toBeCloseTo(73.8567, 4);
    expect(after.placeId).toBe('ChIJe2eProposalsPin01');
    // Provenance in the same write as the coordinates. A coordinate a neighbour walked to and one
    // lifted from a RERA filing are both coordinates, and only one of them has been to the
    // building — the hub captions the map with this.
    expect(after.locSource).toBe('community');
  });

  test('a pin in another city is refused', async ({ request }) => {
    const slug = await freshSociety(request);
    const resident = await newAccount();
    await makeResident(request, resident, slug, 'B-202');

    // A valid coordinate. Just not one anywhere near Pune — which is what a stray map drag looks
    // like, and what used to be able to relocate a society across the country.
    const res = await propose(request, resident, slug, {
      kind: 'location',
      lat: 28.6139,
      lng: 77.209,
    });
    expect(res.status(), await res.text()).toBe(400);
  });

  test('re-proposing corrects your own pending row; somebody else cannot overwrite it', async ({ request }) => {
    const slug = await freshSociety(request);
    const first = await newAccount();

    const a = await propose(request, first, slug, { kind: 'details', builder: 'Original Builders' });
    expect(a.status()).toBe(201);
    const firstId = (await a.json()).id;

    const b = await propose(request, first, slug, { kind: 'details', builder: 'Corrected Builders' });
    expect(b.status(), 'a correction is still a lodged proposal, not a new one').toBe(201);
    expect((await b.json()).id, 'the same row, corrected').toBe(firstId);

    // Somebody else's pending submission is not yours to replace. Overwriting would discard their
    // work silently, and the partial unique index forbids a second row anyway.
    const second = await newAccount();
    const clash = await propose(request, second, slug, { kind: 'details', builder: 'Third Party' });
    expect(clash.status(), await clash.text()).toBe(409);
  });

  test('a decision is final — the second one is refused rather than applied twice', async ({ request }) => {
    const slug = await freshSociety(request);
    const author = await newAccount();

    const lodged = await propose(request, author, slug, { kind: 'details', builder: 'Godrej' });
    const { id } = await lodged.json();
    expect((await decide(request, id, 'approved')).status()).toBe(200);

    const again = await decide(request, id, 'rejected');
    expect(again.status(), await again.text()).toBe(409);

    const after = await (await request.get(`${API}/societies/${slug}`)).json();
    expect(after.builder, 'the approved value survives the attempted reversal').toBe('Godrej');
  });

  test('a rejection changes nothing about the society', async ({ request }) => {
    const slug = await freshSociety(request);
    const before = await (await request.get(`${API}/societies/${slug}`)).json();
    const author = await newAccount();

    const lodged = await propose(request, author, slug, {
      kind: 'details',
      builder: 'Not This One',
      units: 999,
    });
    const { id } = await lodged.json();
    expect((await decide(request, id, 'rejected')).status()).toBe(200);

    const after = await (await request.get(`${API}/societies/${slug}`)).json();
    expect(after.builder).toBe(before.builder);
    expect(after.units).toBe(before.units);
  });

  test('the ops queue shows the invite it exists to screen, and carries no mobile numbers', async ({ request }) => {
    const slug = await freshSociety(request);
    const resident = await newAccount();
    await makeResident(request, resident, slug, 'E-505');
    expect((await propose(request, resident, slug, { kind: 'whatsapp', inviteUrl: INVITE })).status()).toBe(201);

    const res = await request.get(`${API}/admin/society-proposals?status=pending&kind=whatsapp`, {
      headers: await authHeaders(OPS),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const row = body.content.find((p) => p.societySlug === slug);
    expect(row, 'the proposal just lodged is in the queue an operator reads').toBeTruthy();
    // Screening the link for a scam is the entire point of the review, and an operator cannot
    // screen what the response redacts.
    expect(row.inviteUrl).toBe(INVITE);
    // A display name is enough to talk about somebody. A phone number is not needed to decide
    // whether a link is a scam, so it is not published.
    expect(JSON.stringify(row)).not.toContain(resident);
  });

  test('the queue is staff-only, and proposing needs an account', async ({ request }) => {
    const slug = await freshSociety(request);
    const nobody = await newAccount();

    const queue = await request.get(`${API}/admin/society-proposals`, {
      headers: await authHeaders(nobody),
    });
    expect(queue.status()).toBe(403);

    const anon = await request.post(`${API}/societies/${slug}/proposals`, {
      data: { kind: 'details', builder: 'Anonymous Builders' },
    });
    expect(anon.status()).toBe(401);
  });

  test('an empty suggestion is refused rather than queued as a no-op', async ({ request }) => {
    const slug = await freshSociety(request);
    const author = await newAccount();

    // Nothing an operator could act on. Accepting it puts a row in the queue whose approval
    // changes nothing, which costs somebody a decision for no reason.
    const res = await propose(request, author, slug, { kind: 'details' });
    expect(res.status(), await res.text()).toBe(400);
  });
});
