// @ts-check
/** Mints a society only this test writes to: seeded rows are global to the database, so a per-worker guard cannot arbitrate them.
 * `POST /societies` is the real consumer route; the row arrives empty and public. */
import { expect } from '@playwright/test';
import { ACTORS } from '../fixtures/live.js';
import { API, authHeaders, uniqueMobile, uploadedListingPhotos } from './liveAuth.js';
import { approveListingWithFetch, rejectListingWithFetch } from './moderation.js';
import { stubPlaceId } from './places.js';

const slugId = (s) => s.replace(/[^A-Za-z0-9_-]/g, '-');

/** Per-worker mint counter so two mints in one millisecond differ; a place-id collision makes the server answer 200 with
 * the existing row, which is why the `expect(201)` below is load-bearing. */
let sequence = 0;

/** Mint a private society and return its slug; `Zz` sorts it last and Wakad is a real seeded locality (an unknown one is dropped: FK). */
export async function mintSociety(request, author, label) {
  sequence += 1;
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${sequence}`;
  const res = await request.post(`${API}/societies`, {
    headers: await authHeaders(author),
    data: {
      placeId: slugId(`e2e-${label}-${stamp}`),
      name: `Zz Live ${label} ${stamp}`,
      localityLabel: 'Wakad',
      localitySlug: 'wakad',
      lat: 18.5989,
      lng: 73.7629,
    },
  });
  // 200 means the name matched something that already existed — see `sequence` above.
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).slug;
}

// Signed-out visitors can bind it by exact place via pickGoogleSociety (only minting needs an account).
// `placeLabel` is the Google name of the place when it differs from the society's own.
export async function mintPickableSociety(author, name, { lat = 18.5975, lng = 73.7701, placeLabel = name } = {}) {
  const res = await fetch(`${API}/societies`, {
    method: 'POST',
    headers: await authHeaders(author),
    body: JSON.stringify({ placeId: stubPlaceId(placeLabel), name, localityLabel: 'Wakad', localitySlug: 'wakad', lat, lng }),
  });
  const body = await res.json();
  expect([200, 201], JSON.stringify(body)).toContain(res.status);
  return body.slug;
}

// A live (approved) listing bound to the society, so area search finds a home there.
export async function publishSocietyListing(slug, name, { deal = 'buy' } = {}) {
  const read = await fetch(`${API}/societies/${slug}`);
  const society = await read.json();
  expect(read.status, JSON.stringify(society)).toBe(200);
  const headers = await authHeaders(uniqueMobile());
  const created = await fetch(`${API}/me/listings`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: `Zztest society home ${Date.now()}`,
      deal,
      propertyType: 'Flat',
      bhk: 2,
      area: 900,
      price: deal === 'rent' ? 25000 : 9500000,
      city: 'Pune',
      locality: 'Wakad',
      society: name,
      societyId: society.id,
      images: await uploadedListingPhotos(headers),
    }),
  });
  const listing = await created.json();
  expect(created.status, JSON.stringify(listing)).toBe(201);
  const approved = await approveListingWithFetch(listing.id, await authHeaders(ACTORS.admin));
  expect(approved.status, approved.text).toBe(200);
  return listing.id;
}

export async function retireListing(id) {
  await rejectListingWithFetch(id, await authHeaders(ACTORS.admin), { reasonCode: 'other' });
}

// Posts name a society by id and the server derives the stored name from it, so a spec that wants
// a room "in <label>" mints that society first.
export async function withSocietyId(token, body) {
  if (!body.society || body.societyId) return body;
  const res = await fetch(`${API}/societies`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      placeId: slugId(`e2e-named-${body.society}`),
      name: body.society,
      localityLabel: 'Baner',
      localitySlug: 'baner',
      lat: 18.559,
      lng: 73.776,
    }),
  });
  const minted = await res.json();
  expect([200, 201], JSON.stringify(minted)).toContain(res.status);
  return { ...body, societyId: minted.id };
}

// The hub shows its Reviews tab from three reviews, one per author.
export async function seedSocietyReviews(request, slug, count, { rating = 5, categories } = {}) {
  const seen = new Set();
  for (let i = 0; i < count; i += 1) {
    let mobile = uniqueMobile();
    while (seen.has(mobile)) { await new Promise((r) => setTimeout(r, 2)); mobile = uniqueMobile(); }
    seen.add(mobile);
    const res = await request.post(`${API}/reviews/society/${slug}`, {
      headers: await authHeaders(mobile),
      data: { rating, ...(categories ? { categories } : {}) },
    });
    expect(res.status(), await res.text()).toBe(201);
  }
}

// For a shared seeded society: tops its reviews up to `min` rather than adding three more per caller.
export async function ensureSocietyReviews(request, slug, min) {
  const res = await request.get(`${API}/reviews/society/${slug}`);
  expect(res.status()).toBe(200);
  const have = Number((await res.json()).summary?.reviewCount ?? 0);
  if (have < min) await seedSocietyReviews(request, slug, min - have);
}
