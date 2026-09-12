/**
 * LIVE: the locality curation queue — the listings the catalogue could not place.
 *
 * ## The bug this suite exists to keep closed
 *
 * `properties.locality_slug` is nullable and it is the join every locality surface uses: search
 * facets, `/locality/{slug}`, saved-search alerts, the society join. When an owner types an area
 * the resolver does not recognise, the server declines to invent one and leaves the column null.
 * That is correct — coining a slug from free text is how a typo becomes a permanent landing page.
 *
 * What was wrong was what happened next. The queue a human opened to fix it lived in one browser's
 * `localStorage`, so the listing was approved with a null slug and went live *invisible*: reachable
 * only by direct link, absent from every surface a buyer actually uses, and counted as a success by
 * everyone involved. Register item 24.
 *
 * The fix has two halves and they only work together, so this file asserts both:
 *
 *   1. the queue is server-side and is the *listings*, not a parallel list of invented areas; and
 *   2. approving a listing with no locality is refused outright.
 *
 * Half 2 without half 1 would strand every unfiled listing. Half 1 without half 2 leaves the queue
 * optional, and an optional queue is the `localStorage` one again.
 *
 *   cd e2e; npx playwright test tests/platform/live-locality-queue.spec.js --config=playwright.config.js
 */
import { expect, test, ACTORS, STAFF, MOBILE } from '../../fixtures/live.js';
import { API, authHeaders, uniqueMobile } from '../../helpers/liveAuth.js';

/** Free text no seeded locality can match, so the resolver is forced to leave the column null. */
const UNPLACEABLE = 'Zztest Wasti Phata';

const BASE_LISTING = {
  deal: 'rent',
  propertyType: 'Flat',
  price: 24000,
  city: 'Pune',
  bhk: 2,
  area: 720,
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

/**
 * A listing the catalogue cannot file, under an owner nobody else in the suite shares.
 *
 * Created through the real owner route rather than by writing a null into the column, because the
 * thing under test is that the server *produces* this state on its own. A fixture that forced it
 * would still pass after the resolver started inventing slugs again, which is the regression the
 * whole queue is downstream of.
 */
async function unfiledListing(title) {
  const ownerMobile = uniqueMobile();
  const headers = await authHeaders(ownerMobile);
  const created = await api('POST', '/me/listings', headers, {
    ...BASE_LISTING, title, locality: UNPLACEABLE,
  });
  expect(created.status).toBe(201);
  // The premise of every assertion below. If the server ever starts coining a slug here, the queue
  // tests would pass vacuously against an empty queue.
  expect(created.body.localitySlug ?? null).toBeNull();
  return { id: created.body.id, ownerMobile, headers };
}

const queue = async (headers) => (await api('GET', '/admin/locality-queue', headers)).body;
const find = (rows, id) => (rows?.listings || []).find((r) => r.id === id);

/**
 * Take a listing this spec left unfiled back out of the shared queue.
 *
 * The live database is not reset between runs and the queue is capped at 200 rows, so a spec that
 * deliberately ends with a listing still unfiled has to clear it or it accumulates until real
 * backlog is pushed off the end of the page. Rejection is the right instrument rather than an
 * assign: filing junk under Baner to tidy up would put fake rows on a real locality's landing page,
 * and rejecting is what a curator would actually do with an address that does not exist.
 */
const discard = (id, admin) => api('PATCH', `/properties/${id}/status`, admin,
  { status: 'rejected', reason: 'Zztest cleanup — synthetic queue fixture' });

test.describe('LIVE: the locality curation queue', () => {
  test('a listing the resolver could not place is waiting, with the words its owner typed', async () => {
    const staff = await authHeaders(STAFF.rental);
    const { id } = await unfiledListing('Zztest queue subject');

    const row = find(await queue(staff), id);
    expect(row).toBeTruthy();
    /* The free text is the only thing that makes the row decidable. A curator shown a title and a
       pin is guessing; shown "Zztest Wasti Phata" they can recognise it, or see that it is junk. */
    expect(row.locality).toBe(UNPLACEABLE);
    expect(row.localitySlug).toBeNull();

    await discard(id, await authHeaders(ACTORS.admin));
  });

  test('the queue carries no way to contact the owner', async () => {
    const staff = await authHeaders(STAFF.rental);
    const { id, ownerMobile } = await unfiledListing('Zztest privacy subject');

    /* Clearing this queue is a geography question — which of 155 areas is this. None of it needs a
       name or a number, and shipping them would make the locality console a second readable seller
       list, gated on `properties:read`, that no privacy review ever looked at. */
    const row = JSON.stringify(find(await queue(staff), id));
    expect(row).not.toContain(ownerMobile);
    expect(row).not.toMatch(MOBILE);
    expect(row).not.toMatch(/owner|contact|email/i);

    await discard(id, await authHeaders(ACTORS.admin));
  });

  test('filing a listing under an existing area clears it from the queue', async () => {
    const staff = await authHeaders(STAFF.rental);
    const { id } = await unfiledListing('Zztest assign subject');

    const assigned = await api('PATCH', `/admin/locality-queue/${id}`, staff, { slug: 'baner' });
    expect(assigned.status).toBe(200);
    expect(assigned.body.localitySlug).toBe('baner');

    // Left the queue, which is the assertion that matters — a 200 with no write behind it would
    // pass a weaker test.
    expect(find(await queue(staff), id)).toBeUndefined();
  });

  test('an area that does not exist, or has been retired, is refused', async () => {
    const staff = await authHeaders(STAFF.rental);
    const { id } = await unfiledListing('Zztest bad-slug subject');

    /* The whole point of declining to coin a slug at intake is that free text must not become a
       locality. Letting the curator type one here would put the same hole one screen further in. */
    expect((await api('PATCH', `/admin/locality-queue/${id}`, staff,
      { slug: 'zztest-not-a-locality' })).status).toBe(404);

    /* And the shape check runs before the lookup, so a slug that could never be one never reaches
       the catalogue at all. 422, not 400: the repo reserves 400 for a request the server could not
       parse and 422 for one it parsed and then refused on a field. */
    expect((await api('PATCH', `/admin/locality-queue/${id}`, staff,
      { slug: 'Not A Slug' })).status).toBe(422);

    // Still unfiled after both refusals.
    expect(find(await queue(staff), id)).toBeTruthy();

    await discard(id, await authHeaders(ACTORS.admin));
  });

  test('a listing that already has an area is not re-filed from here', async () => {
    const staff = await authHeaders(STAFF.rental);
    const { id } = await unfiledListing('Zztest refile subject');
    expect((await api('PATCH', `/admin/locality-queue/${id}`, staff, { slug: 'baner' })).status).toBe(200);

    /* This route exists to fill a hole, not to move listings between areas — that is an edit, it is
       the owner's or the moderator's, and it is audited as one. Refusing here keeps the queue's
       write to exactly the transition it is the remedy for. */
    const again = await api('PATCH', `/admin/locality-queue/${id}`, staff, { slug: 'kothrud' });
    expect(again.status).toBe(409);
  });

  test('approving a listing with no area is refused, and filing it first unblocks the approval', async () => {
    const admin = await authHeaders(ACTORS.admin);
    const staff = await authHeaders(STAFF.rental);
    const { id } = await unfiledListing('Zztest approval subject');

    /* The ordering *is* the bug. Approved-and-unfiled is the state that reads as done and behaves
       as missing, so the server refuses to enter it rather than warning about it — a warning is
       what the old console had. */
    const blocked = await api('PATCH', `/properties/${id}/status`, admin, { status: 'approved' });
    expect(blocked.status).toBe(409);
    // The message has to name the remedy, or the curator's next move is to go looking for an
    // override that deliberately does not exist.
    expect(blocked.body.message).toMatch(/locality queue/i);

    expect((await api('PATCH', `/admin/locality-queue/${id}`, staff, { slug: 'baner' })).status).toBe(200);
    expect((await api('PATCH', `/properties/${id}/status`, admin, { status: 'approved' })).status).toBe(200);
  });

  test('rejecting a listing with no area is still allowed', async () => {
    const admin = await authHeaders(ACTORS.admin);
    const { id } = await unfiledListing('Zztest rejection subject');

    /* The block is on publishing something nobody can find, not on deciding it. Junk free text is
       one of the reasons a listing gets rejected, so a guard that made a curator file a fake area
       before they could reject it would manufacture exactly the bad data it is meant to prevent. */
    expect((await api('PATCH', `/properties/${id}/status`, admin,
      { status: 'rejected', reason: 'Zztest — not a real address' })).status).toBe(200);
  });

  test('an ordinary signed-in buyer cannot read the queue', async () => {
    const buyer = await authHeaders(ACTORS.buyer);
    expect((await api('GET', '/admin/locality-queue', buyer)).status).toBe(403);
    expect((await api('PATCH', '/admin/locality-queue/00000000-0000-0000-0000-000000000000',
      buyer, { slug: 'baner' })).status).toBe(403);
  });
});
