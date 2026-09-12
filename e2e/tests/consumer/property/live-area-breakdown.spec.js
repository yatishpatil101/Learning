/**
 * The area breakdown was a constant wearing three labels.
 *
 * `FloorPlan.jsx` printed a Super Built-up, a Built-up and a Carpet Area row for every listing.
 * Only one number was ever involved:
 *
 *     const superA = p.area || 0;
 *     const built  = Math.round(superA * 0.84);
 *     const carpet = Math.round(superA * 0.70);
 *
 * `carpetArea`, `builtUpArea` and `superBuiltUpArea` are real nullable columns (V114) declared on
 * `PropertyResponse`, and `propertyMapper.toViewModel` dropped all three — so the page had nothing
 * to print and invented a loading factor instead. Beside it sat a note reading "Carpet area is 70%
 * of super built-up", which was true of every listing on the site for the same reason the numbers
 * were: 0.70 was the constant that produced them.
 *
 * Carpet area is the figure RERA makes a builder answerable for and the basis on which a buyer
 * compares two flats. Rendering a guess there, in the same weight and the same type as the price,
 * is the D244 bathroom fabrication again on a number a buyer may act on — and worse, because two
 * listings from two different builders were reported as having identical efficiency.
 *
 * ## Why the stated case reads a published listing rather than posting one
 *
 * There is no write path. `ListingCreateRequest` and `ListingUpdateRequest` carry none of the three
 * columns, so no owner can set them and a test cannot post one — the seed is the only writer, and
 * it sets `carpetArea` alone. That gap is real and is recorded in `tasks/todo.md`; it is a product
 * decision, not a mapper bug, and it does not change what the page must do with the row the seed
 * does carry. The assertion is still exact: the figure on screen is compared against the figure the
 * API returned for that same listing, so nothing here is a hard-coded fact about the seed beyond
 * "at least one published listing states a carpet area" — which is asserted rather than skipped
 * past, because that catalogue is bundled seed data and its loss is a regression, not a condition.
 * `p5120` (Skyline Heights, Baner, `carpet_area = 890`) is the row that satisfies it today.
 */
import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { authHeaders, API, uniqueMobile } from '../../../helpers/liveAuth.js';

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
    const done = await api('PATCH', `/properties/${id}/status`, headers, {
      status: 'rejected',
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
    /* Carpet area alone, because that is the only one of the three the seed sets — and it is the
       one that matters: the figure RERA makes a builder answerable for. A listing with a stated
       super built-up would exercise the ratio note as well, and the second half of this test
       asserts the note is absent when there is nothing to take a ratio of. */
    if (detail?.carpetArea != null) {
      return { ref: row.slug || row.id, detail };
    }
  }
  return null;
}

test('the detail page prints the carpet area the listing carries, not a factor of its headline area', async ({ page }) => {
  const found = await findWithBreakdown();
  /* Asserted, not skipped. The catalogue this reads is bundled seed data, not an environment, so
     "no listing states a carpet area" is a regression in the seed rather than a condition to route
     around — and a skipped test is invisible in a summary that only counts failures, which would
     leave COVERAGE claiming this case while nothing checked it. `p5120` (Skyline Heights, Baner) is
     the row that satisfies it today, at `carpet_area = 890`. */
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

  /* Both sides formatted the way `fmtNum` formats them. An unformatted negative assertion is worse
     than none: `1050` does not appear in a row rendering "1,050 sq.ft.", so the fabrication could be
     on screen in full for any listing over ~1429 sq.ft. and this line would still pass. */
  await expect(table).toContainText(real.toLocaleString('en-IN'));
  await expect(table).not.toContainText(fabricated.toLocaleString('en-IN'));

  /* Nothing states a super built-up, so there is no ratio to report. The old note asserted 70%
     regardless, which was true of every listing on the site because 0.70 was the constant that
     generated both numbers it compared. */
  if (detail.superBuiltUpArea == null) {
    await expect(page.getByText(/Carpet area is \d+% of super built-up/)).toHaveCount(0);
  } else {
    const pct = Math.round((Number(detail.carpetArea) / Number(detail.superBuiltUpArea)) * 100);
    await expect(page.getByText(`Carpet area is ${pct}% of super built-up.`)).toBeVisible();
  }
});

test('a listing with no breakdown shows its one stated figure and invents no other', async ({ page }) => {
  /* A fresh owner, because the free tier allows one listing per account. Nothing here can set the
     three columns, which is exactly the case under test: the overwhelming majority of real
     listings have no breakdown, and every one of them used to display three. */
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
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  created.add(res.body.id);
  const ref = res.body.slug || res.body.id;

  const approve = await api('PATCH', `/properties/${res.body.id}/status`, await authHeaders(ACTORS.admin), {
    status: 'approved',
  });
  expect(approve.status).toBe(200);

  await page.goto(`/property/${ref}`);
  const table = page.locator('.glass').filter({ hasText: 'Area Breakdown' }).first();
  await expect(table).toBeVisible({ timeout: 20000 });

  /* Derived from the area actually posted, and formatted the way the row would render them, so
     that changing `AREA` cannot quietly turn the two negative assertions into searches for strings
     the page could never contain either way. */
  await expect(table).toContainText(AREA.toLocaleString('en-IN'));
  await expect(table).not.toContainText(Math.round(AREA * 0.84).toLocaleString('en-IN'));
  await expect(table).not.toContainText(Math.round(AREA * 0.70).toLocaleString('en-IN'));
  await expect(table).toContainText('The owner has not broken this down');
  // And with nothing to take a ratio of, the note that used to assert 70% unconditionally is gone.
  await expect(page.getByText(/Carpet area is \d+% of super built-up/)).toHaveCount(0);
});
