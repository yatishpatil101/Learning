/* The Floor Plan section shows the plan the owner tagged, or none: a type-and-BHK schematic makes two 2 BHKs
 * look like the same home. Each case posts its own listing, since seeded rows legitimately store an SVG. */
import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { authHeaders, API, uniqueMobile } from '../../../helpers/liveAuth.js';

const created = new Set();

/* Distinctly not a schematic: `/floorplans/*.svg` is what the retired fallback produced, so a fixture pointing
   there could not tell a stored plan from a synthesised one. Never fetched — assertions read `src`. */
const PHOTOS = [
  'https://zztest.invalid/floor-plan-fixture/living.jpg',
  'https://zztest.invalid/floor-plan-fixture/the-plan.png',
  'https://zztest.invalid/floor-plan-fixture/kitchen.jpg',
];
const PLAN = PHOTOS[1];

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
    const done = await api('PATCH', `/properties/${id}/status`, headers, {
      status: 'rejected',
      reason: 'Zztest cleanup \u2014 synthetic floor-plan fixture',
    });
    // Asserted, because a cleanup that silently failed leaves an approved synthetic listing in the
    // catalogue for the rest of the run and surfaces later as a count off by one.
    expect(done.status, `cleaning up synthetic listing ${id}`).toBe(200);
  }
  created.clear();
});

/**
 * Posts and approves a listing, returning its id and the reference the detail route takes.
 * A fresh owner each time, because the free tier allows one listing per account.
 */
async function publish(fields) {
  const headers = await authHeaders(uniqueMobile());
  const res = await api('POST', '/me/listings', headers, {
    title: `Zztest floor-plan ${Date.now()}`,
    deal: 'rent',
    propertyType: 'Flat',
    price: 26000,
    city: 'Pune',
    locality: 'Baner',
    bhk: 2,
    area: 1000,
    images: PHOTOS,
    ...fields,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  created.add(res.body.id);
  const approve = await api('PATCH', `/properties/${res.body.id}/status`, await authHeaders(ACTORS.admin), {
    status: 'approved',
  });
  expect(approve.status).toBe(200);
  return { id: res.body.id, ref: res.body.slug || res.body.id, headers };
}

/** The Floor Plan section, located by its own heading rather than by position on the page. */
function section(page) {
  return page.locator('section').filter({ has: page.getByRole('heading', { name: 'Floor Plan' }) }).first();
}

test('a tagged photo is the plan the detail page shows', async ({ page }) => {
  const { ref } = await publish({ floorPlan: PLAN });

  await page.goto(`/property/${ref}`);
  await expect(section(page)).toBeVisible({ timeout: 20000 });

  const img = page.locator('img[alt="Floor plan"]');
  await expect(img).toHaveAttribute('src', PLAN);
  /* The teeth: `toHaveAttribute` alone would pass on a page that could *also* render a schematic. A 2 BHK
     Flat is precisely the listing the retired fallback answered for, with `/floorplans/2bhk.svg`. */
  await expect(page.locator('img[src*="/floorplans/"]')).toHaveCount(0);
});

test('a listing with no tagged photo shows no plan rather than a schematic', async ({ page }) => {
  // Photos, but none of them tagged — the shape every listing had before the tag was carried, and
  // the shape of any owner who simply has no plan to share.
  const { ref } = await publish({});

  await page.goto(`/property/${ref}`);
  await expect(section(page)).toBeVisible({ timeout: 20000 });

  await expect(page.locator('img[alt="Floor plan"]')).toHaveCount(0);
  await expect(page.locator('img[src*="/floorplans/"]')).toHaveCount(0);
  // Said, not merely omitted: the heading claims the section answers "how is this laid out", so an
  // empty block under it reads as a page that failed to load rather than an owner who said nothing.
  await expect(section(page)).toContainText('has not shared a floor plan');
  /* The section still earns its place, which is why the image is dropped rather than the whole
     block: the area rows are a separate statement and are unaffected by having no drawing. */
  await expect(section(page)).toContainText('Area Breakdown');
  await expect(section(page)).toContainText((1000).toLocaleString('en-IN'));
});

test('re-tagging moves the plan and untagging withdraws it', async ({ page }) => {
  const { id, ref, headers } = await publish({ floorPlan: PLAN });

  const moved = await api('PATCH', `/me/listings/${id}`, headers, { floorPlan: PHOTOS[0] });
  expect(moved.status, JSON.stringify(moved.body)).toBe(200);
  await page.goto(`/property/${ref}`);
  await expect(page.locator('img[alt="Floor plan"]')).toHaveAttribute('src', PHOTOS[0], { timeout: 20000 });

  /* Blank is what the wizard sends when the owner removes the tag, and PATCH drops undefined keys — so a
     mapper collapsing '' to undefined would keep publishing the old plan with nothing else failing. */
  const cleared = await api('PATCH', `/me/listings/${id}`, headers, { floorPlan: '' });
  expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
  await page.goto(`/property/${ref}`);
  await expect(section(page)).toBeVisible({ timeout: 20000 });
  await expect(page.locator('img[alt="Floor plan"]')).toHaveCount(0);
  await expect(section(page)).toContainText('has not shared a floor plan');
});

/* The plan is published at full width but travels in its own key, so a PATCH carrying only `floorPlan` trips
   no gallery re-check. Re-tagging a reviewed photo is exempt; pointing at an unreviewed one is not. */
test('an approved listing cannot be pointed at a picture no reviewer saw', async () => {
  const { id, headers } = await publish({ floorPlan: PLAN });

  const smuggled = await api('PATCH', `/me/listings/${id}`, headers, {
    floorPlan: 'https://zztest.invalid/floor-plan-fixture/never-reviewed.png',
  });
  expect(smuggled.status, JSON.stringify(smuggled.body)).toBe(422);

  // The same picture is accepted once it arrives as a photo, which is the path that is re-checked.
  const withGallery = await api('PATCH', `/me/listings/${id}`, headers, {
    images: [...PHOTOS, 'https://zztest.invalid/floor-plan-fixture/never-reviewed.png'],
    floorPlan: 'https://zztest.invalid/floor-plan-fixture/never-reviewed.png',
  });
  expect(withGallery.status, JSON.stringify(withGallery.body)).toBe(200);
});
