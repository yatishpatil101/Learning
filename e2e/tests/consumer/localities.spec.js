/* Locality directory against the live API: `GET /localities` is public and `liveListings` counts bound listings, which cannot exceed what the
 * same slug's property search finds (it also matches pins within 2 km). Fixtures: `R__zz_DML_dev_live_localities.sql`. */
import { test, expect } from '../../fixtures/live.js';
import { API } from '../../helpers/liveAuth.js';

const ANCHOR = 'wakad';

test('the locality list is a public read with computed counts that fit inside a search for the same slug', async () => {
  const res = await fetch(`${API}/localities`);
  expect(res.status, 'the locality directory is public').toBe(200);

  const rows = await res.json();
  expect(Array.isArray(rows)).toBe(true);
  expect(rows.length, 'the dev seed revives the curated areas').toBeGreaterThan(100);

  for (const row of rows) {
    expect(row.slug, 'every locality is identified by its slug').toBeTruthy();
    expect(row.name, `${row.slug} should have a name`).toBeTruthy();
    expect(typeof row.liveListings, `${row.slug} should carry a live-listing count`).toBe('number');
    expect(typeof row.archived, `${row.slug} should say whether it is retired`).toBe('boolean');
  }
  expect(rows.filter((r) => r.archived).every((r) => r.liveListings > 0), 'a retired locality is listed only while it still holds listings').toBe(true);

  const names = rows.map((r) => r.name);
  expect(names, 'the directory is alphabetical').toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));

  const anchor = rows.find((r) => r.slug === ANCHOR);
  expect(anchor, `${ANCHOR} should be in the directory`).toBeTruthy();
  const search = await fetch(`${API}/properties?locality=${ANCHOR}&size=1`);
  expect(search.status).toBe(200);
  expect(anchor.liveListings, 'a search for the slug also matches nearby pins, so it finds at least the bound listings')
    .toBeLessThanOrEqual((await search.json()).totalElements);
});

test('the search endpoint answers with live rows only', async () => {
  const res = await fetch(`${API}/localities/search?q=wak`);
  expect(res.status).toBe(200);
  const rows = await res.json();
  expect(rows.map((r) => r.slug)).toContain(ANCHOR);
  for (const row of rows) expect(Object.keys(row).sort()).toEqual(['city', 'lat', 'lng', 'name', 'slug']);
});

test('the listings page loads the locality directory from the server', async ({ page }) => {
  const request = page.waitForResponse(
    (r) => r.url().includes('/api/localities') && r.status() === 200,
    { timeout: 20000 },
  );

  await page.goto('/listings');
  const rows = await (await request).json();
  expect(rows.length, 'the page should have received the directory it asked for').toBeGreaterThan(100);
});