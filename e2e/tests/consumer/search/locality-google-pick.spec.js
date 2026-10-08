import { test, expect } from '../../../fixtures/live.js';
import { API, authHeaders, signedInAsNew, uniqueMobile, uploadedListingPhotos } from '../../../helpers/liveAuth.js';
import { GOOGLE_LOCALITY_TYPES, mintLocality, pickGoogleLocality, uniqueLocalityName } from '../../../helpers/locality.js';

const resolve = (body) => fetch(`${API}/localities/resolve`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

const baner = { name: 'Baner', lat: 18.559, lng: 73.787, types: GOOGLE_LOCALITY_TYPES };

test.describe('POST /localities/resolve and GET /localities/search', () => {
  test('a place already seen resolves to the same row, and a twin of a live name adopts that row', async () => {
    const name = uniqueLocalityName();
    const first = await mintLocality(name);
    expect(first).toMatchObject({ name, city: expect.any(String) });
    expect(first.slug).toMatch(/^zztest-mint-/);

    expect((await mintLocality(name)).slug).toBe(first.slug);

    const adopted = await (await resolve({ placeId: `adopt-${Date.now().toString(36)}`, ...baner })).json();
    expect(adopted.slug, 'a new place with the name of a live locality nearby must not mint a twin').toBe('baner');
  });

  test('a pick outside Pune, a non-locality place or a malformed place id is refused', async () => {
    expect((await resolve({ placeId: 'outside-pune', ...baner, lat: 28.6, lng: 77.2 })).status).toBe(422);
    expect((await resolve({ placeId: 'a-street', ...baner, name: 'Zztest Street', types: ['route'] })).status).toBe(422);
    const malformed = (await resolve({ placeId: 'bad id!', ...baner })).status;
    expect(malformed).toBeGreaterThanOrEqual(400);
    expect(malformed).toBeLessThan(500);
  });

  test('search answers with live rows in the summary shape, and nothing for an unknown name', async () => {
    const rows = await (await fetch(`${API}/localities/search?q=baner`)).json();
    expect(rows.map((r) => r.slug)).toContain('baner');
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(['city', 'lat', 'lng', 'name', 'slug']);

    expect(await (await fetch(`${API}/localities/search?q=zzqxv-no-such-place`)).json()).toEqual([]);
  });
});

test('a listing posted under a locality name nobody has picked is refused', async () => {
  const headers = await authHeaders(uniqueMobile());
  const res = await fetch(`${API}/me/listings`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      deal: 'rent', propertyType: 'Flat', price: 24000, city: 'Pune', bhk: 2, area: 720,
      title: 'Zztest unknown locality', locality: 'Zzunknown Wasti Phata', images: await uploadedListingPhotos(headers),
    }),
  });
  expect(res.status).toBe(422);
  expect(JSON.stringify(await res.json())).toMatch(/locality/i);
});

test('the Rent-o-meter says there is not enough data for a locality nobody lists in yet', async ({ page }) => {
  await signedInAsNew(page);
  await page.goto('/dashboard#owner-hub');

  await pickGoogleLocality(page, uniqueLocalityName('Zztest Quiet'), {
    field: page.locator('.dz-dropdown', { hasText: 'Select locality' }),
    lat: 18.46,
    lng: 73.9,
    expectValue: null,
  });
  await page.getByRole('button', { name: /Estimate now/i }).click();

  await expect(page.getByTestId('rentometer-not-enough')).toBeVisible();
  await expect(page.getByText(/Estimated monthly rent/i)).toHaveCount(0);
});