/* The Floor Plan section shows the plan the owner tagged, or none: a type-and-BHK schematic makes two 2 BHKs
 * look like the same home. Each case posts its own listing, since seeded rows legitimately store an SVG. */
import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { authHeaders, API, uniqueMobile, storedPhotoUrl, ownerIdOf } from '../../../helpers/liveAuth.js';
import { approveListingWithFetch, rejectListingWithFetch } from '../../../helpers/moderation.js';

const created = new Set();

const photosFor = (headers) => {
  const ownerId = ownerIdOf(headers);
  return [storedPhotoUrl('', ownerId), storedPhotoUrl('', ownerId), storedPhotoUrl('', ownerId)];
};

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
      reason: 'Zztest cleanup \u2014 synthetic floor-plan fixture',
    });
    // Asserted, because a cleanup that silently failed leaves an approved synthetic listing in the
    // catalogue for the rest of the run and surfaces later as a count off by one.
    expect(done.status, `cleaning up synthetic listing ${id}`).toBe(200);
  }
  created.clear();
});

async function publish(fields) {
  const headers = await authHeaders(uniqueMobile());
  const images = photosFor(headers);
  const neverReviewed = storedPhotoUrl('', ownerIdOf(headers));
  const resolvedFields = typeof fields === 'function' ? fields(images) : fields;
  const res = await api('POST', '/me/listings', headers, {
    title: `Zztest floor-plan ${Date.now()}`,
    deal: 'rent',
    propertyType: 'Flat',
    price: 26000,
    city: 'Pune',
    locality: 'Baner',
    bhk: 2,
    area: 1000,
    images,
    ...resolvedFields,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  created.add(res.body.id);
  const approve = await approveListingWithFetch(res.body.id, await authHeaders(ACTORS.admin));
  expect(approve.status).toBe(200);
  return { id: res.body.id, ref: res.body.slug || res.body.id, headers, images, neverReviewed };
}

function section(page) {
  return page.locator('section').filter({ has: page.getByRole('heading', { name: 'Floor Plan' }) }).first();
}

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
  await expect(section(page)).toContainText('Area Breakdown');
  await expect(section(page)).toContainText((1000).toLocaleString('en-IN'));
});

test('a tagged photo is the plan the detail page shows; re-tagging moves it, an unreviewed picture cannot be pointed at, and untagging withdraws it', async ({ page }) => {
  test.slow();
  const { id, ref, headers, images, neverReviewed } = await publish((photos) => ({ floorPlan: photos[1] }));
  const plan = page.locator('img[alt="Floor plan"]');

  await test.step('a tagged photo is the plan the detail page shows', async () => {
    await page.goto(`/property/${ref}`);
    await expect(section(page)).toBeVisible({ timeout: 20000 });

    // A 2 BHK Flat is precisely the listing the retired fallback answered for, with `/floorplans/2bhk.svg`.
    await expect(plan).toHaveAttribute('src', images[1]);
    await expect(page.locator('img[src*="/floorplans/"]')).toHaveCount(0);
  });

  await test.step('re-tagging moves the plan', async () => {
    const moved = await api('PATCH', `/me/listings/${id}`, headers, { floorPlan: images[0] });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    await page.goto(`/property/${ref}`);
    await expect(plan).toHaveAttribute('src', images[0], { timeout: 20000 });
  });

  /* The plan is published at full width but travels in its own key, so a PATCH carrying only `floorPlan` trips
     no gallery re-check. Re-tagging a reviewed photo is exempt; pointing at an unreviewed one is not. */
  await test.step('an approved listing cannot be pointed at a picture no reviewer saw', async () => {
    const smuggled = await api('PATCH', `/me/listings/${id}`, headers, { floorPlan: neverReviewed });
    expect(smuggled.status, JSON.stringify(smuggled.body)).toBe(422);

    const withGallery = await api('PATCH', `/me/listings/${id}`, headers, {
      images: [...images, neverReviewed],
      floorPlan: neverReviewed,
    });
    expect(withGallery.status, JSON.stringify(withGallery.body)).toBe(200);
  });

  /* Blank is what the wizard sends when the owner removes the tag, and PATCH drops undefined keys, so a
     mapper collapsing '' to undefined would keep publishing the old plan with nothing else failing. */
  await test.step('untagging withdraws the plan', async () => {
    const cleared = await api('PATCH', `/me/listings/${id}`, headers, { floorPlan: '' });
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
    await page.goto(`/property/${ref}`);
    await expect(section(page)).toBeVisible({ timeout: 20000 });
    await expect(plan).toHaveCount(0);
    await expect(section(page)).toContainText('has not shared a floor plan');
  });
});
