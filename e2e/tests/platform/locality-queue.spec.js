// LIVE: the locality curation queue — the listings the catalogue could not place.
import { expect, test, ACTORS, STAFF, MOBILE } from '../../fixtures/live.js';
import { API, authHeaders, uploadedListingPhotos, uniqueMobile } from '../../helpers/liveAuth.js';
import { approveListing, tickChecklist } from '../../helpers/moderation.js';

// Free text no seeded locality can match, so the resolver is forced to leave the column null.
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

// A listing the catalogue cannot file, under an owner nobody else in the suite shares.
async function unfiledListing(title) {
  const ownerMobile = uniqueMobile();
  const headers = await authHeaders(ownerMobile);
  const created = await api('POST', '/me/listings', headers, {
    ...BASE_LISTING, title, locality: UNPLACEABLE, images: await uploadedListingPhotos(headers),
  });
  expect(created.status).toBe(201);
  // The premise of every assertion below. If the server ever starts coining a slug here, the queue
  // tests would pass vacuously against an empty queue.
  expect(created.body.localitySlug ?? null).toBeNull();
  return { id: created.body.id, ownerMobile, headers };
}

const queue = async (headers) => (await api('GET', '/admin/locality-queue', headers)).body;
const find = (rows, id) => (rows?.listings || []).find((r) => r.id === id);

// Take a listing this spec left unfiled back out of the shared queue.
const discard = (id, admin) => api('PATCH', `/properties/${id}/status`, admin,
  { status: 'rejected', reasonCode: 'other', reason: 'Zztest cleanup — synthetic queue fixture' });

test.describe('LIVE: the locality curation queue', () => {
  test('a listing the resolver could not place is waiting, with the words its owner typed', async () => {
    const staff = await authHeaders(STAFF.rental);
    const { id, ownerMobile } = await unfiledListing('Zztest queue subject');

    const row = find(await queue(staff), id);
    expect(row).toBeTruthy();
    // The free text is the only thing that makes the row decidable.
    expect(row.locality).toBe(UNPLACEABLE);
    expect(row.localitySlug).toBeNull();

    // Locality queue must not become a seller list gated only on `properties:read`.
    const raw = JSON.stringify(row);
    expect(raw).not.toContain(ownerMobile);
    expect(raw).not.toMatch(MOBILE);
    expect(raw).not.toMatch(/owner|contact|email/i);

    await discard(id, await authHeaders(ACTORS.admin));
  });

  test('approving a listing with no area is refused, and filing it first unblocks the approval', async ({ request }) => {
    const admin = await authHeaders(ACTORS.admin);
    const staff = await authHeaders(STAFF.rental);
    const { id } = await unfiledListing('Zztest approval subject');

    await tickChecklist(request, id, admin);
    // The ordering *is* the bug.
    const blocked = await api('PATCH', `/properties/${id}/status`, admin, { status: 'approved' });
    expect(blocked.status).toBe(409);
    // The message has to name the remedy, or the curator's next move is to go looking for an
    // override that deliberately does not exist.
    expect(blocked.body.message).toMatch(/locality queue/i);

    // The shape check runs before the lookup, so a slug that could never be one never reaches the catalogue.
    expect((await api('PATCH', `/admin/locality-queue/${id}`, staff, { slug: 'Not A Slug' })).status).toBe(422);
    // Filing is a curator's job: an ordinary signed-in buyer is refused on the write as well as the read.
    expect((await api('PATCH', `/admin/locality-queue/${id}`, await authHeaders(ACTORS.buyer), { slug: 'baner' })).status).toBe(403);
    expect(find(await queue(staff), id), 'still unfiled after both refusals').toBeTruthy();

    expect((await api('PATCH', `/admin/locality-queue/${id}`, staff, { slug: 'baner' })).status).toBe(200);
    expect((await approveListing(request, id, admin)).status()).toBe(200);
  });

});
