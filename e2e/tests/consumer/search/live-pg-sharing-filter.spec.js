import { test, expect } from '@playwright/test';

/* The PG / Hostel "Sharing" (occupancy) filter CONTROL, against the live backend.
   ------------------------------------------------------------------------------
   Converted out of `tests/consumer/flatmates/pg-sharing.spec.js`, which was filed
   under flatmates by mistake. PG occupancy is not a flatmate concept and never was
   — `propertyTypes.js` says so at the definition of PG_SHARING: the single→dormitory
   model is "deliberately separate from Flatmates's Private/Shared roommate concept".
   A PG is a property type an owner lets by the bed; a flatmate share is a person
   looking for a housemate. They share a English word and nothing else. The spec
   drove `/listings`, not `/flatmates`, so nothing about it belonged in that folder.

   WHY THIS FILE EXISTS RATHER THAN A DELETION
   -------------------------------------------
   Two of the mock's five tests are already owned, and owned better, by
   live-listing-attributes.spec.js ("Sharing filter reads the occupancy list the
   server sent"): it pins the exact seeded pair `sharing=triple -> {p5007, p5033}`
   against `sharing=double -> {p5033}`, an asymmetry that a per-listing hash could
   not satisfy. The mock proved less, from stock it injected into localStorage —
   under a live `property` domain nothing reads that store, so those assertions were
   describing rows that did not exist.

   But that file reaches the filter by URL on purpose, and says so: "Deep links
   rather than clicks ... driving six dropdowns per assertion would test the
   dropdowns. The chip and menu behaviour is covered in live-type-aware-filters."
   That delegation was never honoured for Sharing. live-type-aware-filters covers
   the group-visibility swap and the removable chip for Land Use, Commercial and
   residential types — it does not mention Sharing anywhere. So between the two live
   specs the PG occupancy CONTROL is unowned: no live test opens the dropdown, and
   none checks that selecting PG swaps the BHK group out for the Sharing group.
   That is the half this file takes, and only that half.

   WHAT IS DELIBERATELY NOT CARRIED OVER
   -------------------------------------
   The mock's "PG/Hostel is sellable and filterable by Sharing on the Buy deal".
   The claim is real — `propertyTypes.js` marks pg `buy: true`, so an owner may sell
   a whole PG building — but the seed has no buy-deal PG: `{p5007, p5033}` are both
   rentals. The mock only got an answer because it injected `deal:'buy'` PG rows into
   localStorage and deep-linked past the type dropdown. Reproducing that live means
   adding stock to R__zz_DML_dev_demo_data.sql, whose registry warns against filling rows
   in "to make the grid look complete". Left out rather than faked; it wants a seeded
   buy-deal PG first. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

const filters = (page) => page.locator('aside:has(h3:has-text("Filters"))');
const groupHeading = (page, name) => filters(page).locator('h4.fg-header').filter({ hasText: name });
/* The trigger's accessible name is the group label; the chosen value shows in its
   text. The option list is portaled to <body>, so it is out of this scope. */
const sharingTrigger = (page) => filters(page).getByRole('button', { name: 'Sharing' });
const cards = (page) => page.locator('a[href^="/property/"]');

const slugs = async (page) => {
  const hrefs = await cards(page).evaluateAll((els) => els.map((el) => el.getAttribute('href')));
  return hrefs.map((h) => h.replace('/property/', '')).sort();
};

/* The grid renders from `useDeferredValue(f)` while the URL applies immediately, so
   a one-shot read can catch the pre-filter paint and pass by luck. Always poll. */
const expectSlugs = async (page, expected) => {
  await expect.poll(async () => await slugs(page), { timeout: 15000 }).toEqual([...expected].sort());
};

/* A PG is let by the bed, so "2 BHK" says nothing about what is for sale; a flat is
   let whole, so occupancy says nothing about it. The sidebar is supposed to swap one
   group for the other. Asserting only the PG half would be vacuous — a sidebar that
   rendered every group always would satisfy "Sharing is visible", and a sidebar that
   rendered none would satisfy "BHK is absent". The flat leg is what makes each
   absence mean something: the same two assertions are made in both directions. */
test('picking PG swaps the BHK group out for Sharing, and a flat swaps it back', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=rent&ptype=pg`);
  await expect(groupHeading(page, 'Sharing')).toBeVisible();
  await expect(groupHeading(page, 'BHK')).toHaveCount(0);

  await page.goto(`${BASE}/listings?deal=rent&ptype=flat`);
  await expect(groupHeading(page, 'BHK')).toBeVisible();
  await expect(groupHeading(page, 'Sharing')).toHaveCount(0);
});

/* `paramsToFilters` reads ?sharing= into filter state; the trigger and the chip are
   the two places that state becomes visible. A deep link that narrowed the results
   but left both controls blank would look, to the person who followed the link, like
   an unexplained shortage of PGs. */
test('a ?sharing= deep link shows in the trigger and as a removable chip', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=rent&ptype=pg&sharing=double`);

  await expect(sharingTrigger(page)).toContainText('Double Sharing');
  await expect(page.getByRole('button', { name: /Remove filter Double Sharing/i })).toBeVisible();
});

/* The one test here that drives the control the other live specs decline to drive.
   The seeded asymmetry does the work: p5033 offers double AND triple, p5007 only
   triple, so picking "Double Sharing" must drop exactly one of the two rows. A
   dropdown that opened but never committed its value would leave both rows visible
   and fail; one that committed but over-narrowed would lose p5033 and fail too. */
test('choosing an occupancy in the dropdown narrows the PG results', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=rent&ptype=pg`);
  await expectSlugs(page, ['p5007', 'p5033']);

  await sharingTrigger(page).click();
  await page.getByRole('option', { name: 'Double Sharing' }).click();

  await expect(page.getByRole('button', { name: /Remove filter Double Sharing/i })).toBeVisible();
  // p5007 is triple-only, so it is the row the filter has to remove.
  await expectSlugs(page, ['p5033']);
});

/* Changing the pick, rather than making one from scratch. This starts already
   narrowed to a single row, which is what makes it the strongest assertion in the
   file: `expect.poll(...).toEqual(X)` succeeds the moment it observes X, so any
   assertion whose expected value equals the UNFILTERED grid can be satisfied by the
   paint that happens before the filter applies. Widening cannot be faked that way —
   two rows is not a state this page passes through on its way from one.

   It also separates "the control committed the value I chose" from "the control
   cleared the filter": both would widen the grid, but only the former keeps the
   Triple chip on screen. */
test('changing the occupancy widens the results to match the new pick', async ({ page }) => {
  await page.goto(`${BASE}/listings?deal=rent&ptype=pg&sharing=double`);
  await expectSlugs(page, ['p5033']);

  await sharingTrigger(page).click();
  await page.getByRole('option', { name: 'Triple Sharing' }).click();

  await expect(page.getByRole('button', { name: /Remove filter Triple Sharing/i })).toBeVisible();
  // Both PGs offer triple; only p5033 also offers double.
  await expectSlugs(page, ['p5007', 'p5033']);
});
