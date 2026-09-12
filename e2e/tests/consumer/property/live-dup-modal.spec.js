/**
 * D245 — the duplicate-property BLOCK modal, and the photo hashes the wizard computes, both
 * checked against the real API.
 *
 * Converted from `dup-modal.spec.js`, which could only ever be a mock test: it seeded an existing
 * listing straight into `draazyDB_v5` and then asked the mock provider whether that listing
 * existed. The store answering the question was the store the test had just written, so the guard
 * was proved against itself. Here the listing the guard finds is a **seeded server row** owned by a
 * fixture account, and the answer comes from `POST /me/listings/duplicate-check`.
 *
 * Two claims live in this file, and they are separate on purpose.
 *
 * 1. The guard stops a second post of a flat the owner has already listed, and does it on a signal
 *    the mock version could not carry: the **electricity meter number**, spelled differently from
 *    the way it was spelled the first time. The address the wizard sends here is deliberately NOT
 *    the seeded one, so an address match cannot be what stops the post — the meter is. That is the
 *    normalisation V115 added (`MeterKey`), driven through the real form rather than through a
 *    hand-built request body.
 *
 * 2. The photo hashes the wizard computes in the browser reach the server. This one is folded in
 *    here rather than left with `live-dedup.spec.js` for a specific reason: `live-dedup` posts wire
 *    JSON with `fetch`, which sits BELOW `toListingCreate`. Dropping `photoHashes` from that mapper
 *    would leave every test in this repository green while the feature became unreachable from a
 *    browser — the exact failure the whole V116 change exists to correct, since the arm had never
 *    once fired for anybody. Only a test that uploads a real file through the wizard can fail on
 *    that one line, so that is what the second test does.
 *
 * Both wizard drives in test 2 are real drives. It would be shorter to plant the first listing over
 * the API with a hard-coded hash, but the hash would then be a value read out of `imageHash.js` by
 * eye and written into the fixture — an assumption about the product, dressed as a fixture. Two
 * drives assume nothing: whatever the browser computes, it computes twice, and the server is asked
 * whether it noticed.
 */
import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { pickDate } from '../../../helpers/datePicker.helper.js';
import { signIn, signedInAsNew, authHeaders, API } from '../../../helpers/liveAuth.js';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/**
 * Kunal Bhosale — the duplicate-guard fixture owner, seeded with ONE pending listing and an
 * allowance of two.
 *
 * The allowance is the whole reason he exists. On the free tier a single listing exhausts the
 * quota, so a second post is refused by the paywall before the duplicate guard is ever consulted,
 * and a test written against such an account would assert the modal it wanted while the product
 * showed a different one. His second slot is what makes the block below attributable to the guard.
 */
const KUNAL = '9700000090';
const KUNAL_LISTING = 'd0000000-0000-4000-8000-0000000000d1';

/** Kunal's seeded meter, respaced. Same digits, so `MeterKey` reduces both to one key. */
const KUNAL_METER_RESPELLED = '1700-4455-6677';

/**
 * An address that is NOT Kunal's seeded one (his is `C-701, Dup Guard Residency, Baner`).
 *
 * Deliberate: if the wizard typed his real address the post would be stopped by the doorway arm and
 * the meter could be broken without this test noticing. Typing a different flat in a different
 * society leaves the meter as the only signal the two listings share.
 */
const OTHER_FLAT = 'A-101';
const OTHER_SOCIETY = 'ZZ Different Society Entirely';

/** The fresh accounts test 2 mints, so their listings can be taken back out of the catalogue. */
const owners = new Set();

/**
 * Withdraw whatever the fresh owners posted.
 *
 * Rejection rather than deletion, for the reason `live-seam-write` gives: there is no delete route,
 * and rejection is how the moderation desk itself withdraws a listing, so the database is left in a
 * shape the product can actually produce. It also takes the rows out of the OCCUPYING set the
 * duplicate probe queries, which matters here more than usual — every listing this file creates
 * carries the same photograph, so leaving them behind would seed a growing pile of mutual
 * duplicates for any later spec that uploads the same fixture image.
 *
 * Kunal is never in this set. His listing is seed data that other specs read.
 */
test.afterEach(async () => {
  if (!owners.size) return;
  const adminHeaders = await authHeaders(ACTORS.admin);
  for (const mobile of owners) {
    const res = await fetch(`${API}/me/listings`, { headers: await authHeaders(mobile) });
    if (res.status !== 200) continue;
    const body = await res.json();
    const rows = Array.isArray(body) ? body : (body.content ?? body.items ?? []);
    for (const row of rows) {
      await fetch(`${API}/properties/${row.id}/status`, {
        method: 'PATCH',
        headers: adminHeaders,
        body: JSON.stringify({ status: 'rejected', reason: 'Zztest cleanup \u2014 synthetic dup-modal fixture' }),
      });
    }
  }
  owners.clear();
});

async function pickOption(page, dataErr, label) {
  await page.locator(`[data-err="${dataErr}"]`).click();
  /* `Select` portals its menu and only flips `portalOpen` one requestAnimationFrame after the open
     (Select.jsx:178); until then it is `opacity: 0; pointer-events: none` (dropdown.css:198). */
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
  await page.locator('.dz-dropdown__option', { hasText: label }).first().click();
}

/**
 * Drive the whole wizard for one rent flat and press Submit.
 *
 * Stops at the press. What happens next is the difference between the two tests — a block in one, a
 * success screen in the other — and asserting it here would hide it.
 *
 * `.lp-steps` rather than `.lp-meter` for the boot wait: `.lp-meter` is the completion progress bar
 * and it renders on the listing-limit paywall too, so an account that had been quota-blocked would
 * sail past that wait and fail much later on a missing field, describing the wrong problem.
 */
async function driveTheWizard(page, { flat, society, locality = 'Baner', meter }) {
  await page.goto('/list-property');
  await page.waitForSelector('.lp-steps', { timeout: 20000 });

  // Step 1 — a rent flat: the fewest gating answers, and the duplicate signals are identical
  // either way.
  await page.locator('.radio-pill', { hasText: 'Rent' }).first().click();
  await pickOption(page, 'propertyType', 'Flat / Apartment');
  await page.locator('input[data-err="carpetArea"]').fill('900');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });

  // Step 2 — location and rent pricing.
  await pickOption(page, 'locality', locality);
  await page.locator('input[data-err="flatNumber"]').fill(flat);
  await page.locator('input[data-err="society"]').fill(society);
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.locator('input[data-err="monthlyRent"]').fill('30000');
  await page.locator('input[data-err="deposit"]').fill('60000');
  if (meter) {
    // Optional, so it carries no `data-err`; the placeholder is the stable handle.
    await page.getByPlaceholder(/MSEDCL electricity bill/i).fill(meter);
  }
  await pickDate(page, '[data-err="availableFrom"]', '2025-12-31');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Photos & documents/i', { timeout: 15000 });

  // Step 3 — one photograph and the ownership proof a rent listing asks for. The photograph is the
  // input to `hashPhotos`, so this upload is the start of the wire test 2 follows.
  const buf = Buffer.from(PNG, 'base64');
  await page.locator('input[type="file"][accept="image/*"]').first()
    .setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: buf });
  await page.locator('input[type="file"][accept="image/*,.pdf"]').first()
    .setInputFiles({ name: 'doc.png', mimeType: 'image/png', buffer: buf });
  await page.getByRole('button', { name: /Submit Property/i }).click();
}

/** Every listing the account owns, in whatever status. */
async function myListings(mobile) {
  const res = await fetch(`${API}/me/listings`, { headers: await authHeaders(mobile) });
  expect(res.status).toBe(200);
  const body = await res.json();
  return Array.isArray(body) ? body : (body.content ?? body.items ?? []);
}

test.describe('LIVE — posting a flat the owner has already listed', () => {
  test('the meter number stops a second post, even under a different address', async ({ page }) => {
    await signIn(page, KUNAL);

    const before = await myListings(KUNAL);
    // The precondition, asserted rather than assumed: the guard can only be what stops the post if
    // the account still has a slot free. One listing against an allowance of two.
    expect(before).toHaveLength(1);
    expect(before[0].id).toBe(KUNAL_LISTING);

    await driveTheWizard(page, {
      flat: OTHER_FLAT,
      society: OTHER_SOCIETY,
      meter: KUNAL_METER_RESPELLED,
    });

    await expect(page.getByText(/already listed this property/i)).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: /Go to my existing listing/i })).toBeVisible();
    await expect(page.locator('text=/Listed Successfully/i')).toHaveCount(0);

    // The claim the modal makes, checked where it counts. A guard that showed the words and posted
    // the listing anyway would satisfy every assertion above.
    expect(await myListings(KUNAL)).toHaveLength(1);

    /* The CTA opens the editor on the id the guard named. That id came from the server, and the
       editor prefills from `propertyService.myListing` — the same seam — so the owner lands on the
       listing they were told about rather than on an empty form under the words "here is the one
       you already have", which is what the pre-D237 mismatch produced. */
    await page.getByRole('button', { name: /Go to my existing listing/i }).click();
    await expect(page).toHaveURL(new RegExp(`edit=${KUNAL_LISTING}`), { timeout: 10000 });
  });

  test('a photograph uploaded in the wizard reaches the server as a comparable hash', async ({ page, browser }) => {
    // Two full wizard drives plus two sign-ins; the per-test default is not enough.
    test.setTimeout(240_000);

    // The first owner posts the photograph. Nothing is asserted about duplication here — there is
    // nothing yet to duplicate.
    const first = await signedInAsNew(page);
    owners.add(first);
    await driveTheWizard(page, { flat: 'P-1', society: 'ZZ Photo Wire One', locality: 'Kothrud' });
    await expect(page.locator('text=/Listed Successfully/i')).toBeVisible({ timeout: 30000 });
    const [firstListing] = await myListings(first);
    expect(firstListing).toBeTruthy();

    /* A second browser context, because `signedInAsNew` replaces the session in the page it is
       given and the first owner's listing must already exist and stay owned by somebody else. The
       probe only fires across owners — a person may photograph their own flat twice. */
    const second = await browser.newContext();
    const page2 = await second.newPage();
    let secondMobile;
    try {
      secondMobile = await signedInAsNew(page2);
      owners.add(secondMobile);
      // A different society in a different locality: the address arm is blind here by construction,
      // so a note about this listing can only have come from the photograph.
      await driveTheWizard(page2, { flat: 'Q-9', society: 'ZZ Photo Wire Two', locality: 'Wakad' });
      await expect(page2.locator('text=/Listed Successfully/i')).toBeVisible({ timeout: 30000 });
    } finally {
      await second.close();
    }

    const [secondListing] = await myListings(secondMobile);
    expect(secondListing).toBeTruthy();

    /* Read as staff. The finding is an internal note, and the owner it is written about gets a 404
       on this route by design (`PropertyVerificationService.ownerVisibleCase`) — an owner is not
       told which of their signals tripped a review. */
    const admin = await authHeaders(ACTORS.admin);
    const res = await fetch(`${API}/properties/${secondListing.id}/verification`, { headers: admin });
    expect(res.status, 'a case file exists on the second listing, so something was filed about it').toBe(200);
    const file = await res.json();
    const photoNote = (file.messages || []).find((m) => /reuses photographs/.test(m.body || ''));
    expect(photoNote, 'the photo arm filed a note naming the earlier listing').toBeTruthy();
    expect(photoNote.internal).toBe(true);
    expect(photoNote.body).toContain(firstListing.id);
  });
});
