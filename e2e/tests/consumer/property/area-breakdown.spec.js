import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { authHeaders, API, uniqueMobile, uploadedListingPhotos } from '../../../helpers/liveAuth.js';
import { approveListingWithFetch, rejectListingWithFetch } from '../../../helpers/moderation.js';

const created = new Set();

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null) };
}

test.afterEach(async () => {
  if (!created.size) return;
  const headers = await authHeaders(ACTORS.admin);
  for (const id of created) {
    const done = await rejectListingWithFetch(id, headers, {
      reason: 'Zztest cleanup \u2014 synthetic area-breakdown fixture',
    });
    // Asserted, because a cleanup that silently failed leaves an approved synthetic listing in the
    // catalogue for the rest of the run and surfaces three specs later as a count off by one.
    expect(done.status, `cleaning up synthetic listing ${id}`).toBe(200);
  }
  created.clear();
});
/** The first published listing whose owner stated a carpet area, with its detail body. */
async function findWithBreakdown() {
  /* `content`, not `items`: this fetch sits below `unwrapPage`, so it sees Spring's own page
     envelope rather than the shape the provider normalises it into. */
  const list = await (await fetch(`${API}/properties?size=60`)).json();
  for (const row of list?.content || []) {
    const detail = await (await fetch(`${API}/properties/${row.slug || row.id}`)).json();
    if (detail?.carpetArea != null) {
      return { ref: row.slug || row.id, detail };
    }
  }
  return null;
}

test('the detail page prints the carpet area the listing carries, not a factor of its headline area', async ({ page }) => {
  const found = await findWithBreakdown();
  expect(found, 'no published listing states a carpet area — the seed no longer covers this case').toBeTruthy();
  const { ref, detail } = found;
  /* The teeth, checked before the page is opened: if the stated carpet area happens to equal
     `area * 0.70` the test cannot tell the fix from the defect, so say so rather than pass. */

  expect(Number.isFinite(Number(detail.area)),
    `${ref} states a carpet area but no headline area, so there is no fabricated value to compare `
    + 'against and the guard below would silently compare NaN').toBe(true);
  const fabricated = Math.round(Number(detail.area) * 0.70);
  const real = Math.round(Number(detail.carpetArea));
  expect(fabricated,
    `${ref}'s stated carpet area is exactly area x 0.70, so the old fabrication and the real value `
    + 'are the same number and this assertion proves nothing').not.toBe(real);

  await page.goto(`/property/${ref}`);
  const table = page.locator('.glass').filter({ hasText: 'Area Breakdown' }).first();
  await expect(table).toBeVisible({ timeout: 20000 });

  await expect(table).toContainText(real.toLocaleString('en-IN'));
  await expect(table).not.toContainText(fabricated.toLocaleString('en-IN'));

  if (detail.superBuiltUpArea == null) {
    await expect(page.getByText(/Carpet area is \d+% of super built-up/)).toHaveCount(0);
  } else {
    const pct = Math.round((Number(detail.carpetArea) / Number(detail.superBuiltUpArea)) * 100);
    await expect(page.getByText(`Carpet area is ${pct}% of super built-up.`)).toBeVisible();
  }
});

  // A fresh owner, because the free tier allows one listing per account.
test('a listing with no breakdown shows its one stated figure and invents no other', async ({ page }) => {
  const headers = await authHeaders(uniqueMobile());
  const AREA = 1000;
  const res = await api('POST', '/me/listings', headers, {
    title: `Zztest area-breakdown ${Date.now()}`,
    deal: 'rent',
    propertyType: 'Flat',
    price: 26000,
    city: 'Pune',
    locality: 'Baner',
    bhk: 2,
    area: AREA,
    images: await uploadedListingPhotos(headers),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  created.add(res.body.id);
  const ref = res.body.slug || res.body.id;

  const approve = await approveListingWithFetch(res.body.id, await authHeaders(ACTORS.admin));
  expect(approve.status).toBe(200);

  await page.goto(`/property/${ref}`);
  const table = page.locator('.glass').filter({ hasText: 'Area Breakdown' }).first();
  await expect(table).toBeVisible({ timeout: 20000 });

  await expect(table).toContainText(AREA.toLocaleString('en-IN'));
  await expect(table).not.toContainText(Math.round(AREA * 0.84).toLocaleString('en-IN'));
  await expect(table).not.toContainText(Math.round(AREA * 0.70).toLocaleString('en-IN'));
  await expect(table).toContainText('The owner has not broken this down');
  await expect(page.getByText(/Carpet area is \d+% of super built-up/)).toHaveCount(0);
});
