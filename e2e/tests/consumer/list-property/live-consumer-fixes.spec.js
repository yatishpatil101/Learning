/**
 * Consumer "Post a property" fixes — the cascade reset, and the detail page reading real specs.
 *
 * Converted from `consumer-fixes.spec.js`, and one test is deliberately narrower than its source.
 *
 * The original built its world by reading `db.json` off disk, splicing two hand-written listing
 * objects into it and writing the whole catalogue to `puneNestDB_v5`. Those objects carried keys the
 * browser store accepts and the contract does not, and that is the finding this conversion turned
 * up rather than a detail of the port: `propertyMapper.js:417` names bathrooms, balconies, lock-in,
 * ownership type and preferred tenants as fields **the server never stores**, and `ListingCreate`
 * has no `facing` or age either — they exist on `PropertyResponse` but nothing an owner posts can
 * set them. So the mock test asserted six Key Details tiles of which two have no column anywhere in
 * the live system and two more cannot be written by the person posting the listing.
 *
 * That is worth stating plainly: the detail page renders Bathrooms, Parking, Facing and Age tiles
 * that a live owner-created listing cannot populate. Those tiles are not covered here, because the
 * only way to cover them would be to seed a row the product has no path to. Left as a gap on
 * purpose — a test that fabricated the row would report a feature that does not work.
 *
 * What survives is the claim the tiles were evidence for: the page reads the owner's saved values
 * rather than deriving them. Furnishing is the case that carries it — it is stored, it is settable,
 * and it has a canonical key the page has to resolve to a label. Deposit is the other, and the
 * sharper one, because the bug was a *formula*: a rental with no saved deposit fell back to price
 * multiplied out, so a saved ₹45,000 that displays as ₹40,000 is the regression.
 *
 * The cascade-reset test is unchanged in substance. It never touched a listing.
 */
import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { signedInAsNew, authHeaders, API } from '../../../helpers/liveAuth.js';

const created = new Set();

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json().catch(() => null) };
}

/**
 * Post one listing as a fresh owner and moderate it live, returning the public slug.
 *
 * Approval is required because the detail page under test is the public one — an unmoderated
 * listing is not readable there, and the test would be asserting on a 404 page.
 */
async function publishListing(fields) {
  const mobile = `97${String(Date.now()).slice(-8)}`;
  const headers = await authHeaders(mobile);
  const res = await api('POST', '/me/listings', headers, {
    title: `Zztest consumer-fixes ${Date.now()}`,
    city: 'Pune',
    // A real entry in `GET /localities`, so the resolver files the listing rather than leaving
    // `locality_slug` null and dropping it into the curation queue `live-locality-queue` owns.
    locality: 'Baner',
    ...fields,
  });
  expect(res.status).toBe(201);
  created.add(res.body.id);

  const approved = await api('PATCH', `/properties/${res.body.id}/status`, await authHeaders(ACTORS.admin), {
    status: 'approved',
  });
  expect(approved.status).toBe(200);
  return res.body.slug || res.body.id;
}

test.afterEach(async () => {
  if (!created.size) return;
  const headers = await authHeaders(ACTORS.admin);
  for (const id of created) {
    await api('PATCH', `/properties/${id}/status`, headers, {
      status: 'rejected',
      reason: 'Zztest cleanup \u2014 synthetic consumer-fixes fixture',
    });
  }
  created.clear();
});

async function pickType(page, label) {
  await page.locator('[data-err="propertyType"]').click();
  /* `Select` portals its menu and only flips `portalOpen` one requestAnimationFrame after the open
     (Select.jsx:178); until then it is `opacity: 0; pointer-events: none` (dropdown.css:198). */
  await expect(page.locator('.pn-dropdown__menu.is-portal-open')).toBeVisible();
  await page.locator('.pn-dropdown__option', { hasText: label }).first().click();
}

test('switching property type clears the previous type-specific answers (cascade reset)', async ({ page }) => {
  await signedInAsNew(page);
  await page.goto('/list-property');
  /* `.lp-steps` rather than the mock's `.lp-meter`: the meter renders on the listing-limit paywall
     as well as on the wizard, so it cannot tell the two branches apart. */
  await page.waitForSelector('.lp-steps', { timeout: 20000 });

  await pickType(page, 'PG / Hostel');
  const single = page.locator('.radio-pill', { hasText: 'Single (No Sharing)' });
  await single.click();
  await expect(single).toHaveClass(/selected/);

  // Bounce to a Flat and back — the PG-only sharing pick must not survive.
  await pickType(page, 'Flat / Apartment');
  await pickType(page, 'PG / Hostel');
  await expect(page.locator('.radio-pill', { hasText: 'Single (No Sharing)' })).not.toHaveClass(/selected/);
});

test('detail page shows the owner’s real furnishing and floor, not a value derived from BHK', async ({ page }) => {
  const slug = await publishListing({
    deal: 'buy', propertyType: 'Flat', bhk: 3, area: 1200, price: 12000000,
    /* Spelled the server's way, not the browser's. `publishListing` posts with `fetch`, which sits
       below `propertyMapper`, so it has to speak the contract vocabulary itself — the UI key `semi`
       is rejected 422 here. That difference is the whole point of the assertion below: the page can
       only print "Semi-Furnished" if the mapper translated `semi-furnished` back to `semi` on the
       way in, because the label lookup in useProperty.js knows the UI keys and nothing else. A page
       that derived furnishing from anything else would land on the default instead. */
    furnishing: 'semi-furnished',
    floor: 5,
  });

  await page.goto(`/property/${slug}`);
  await expect(page.getByRole('heading', { name: /Key Details/i })).toBeVisible({ timeout: 20000 });

  const detail = (label) => page.locator('.detail-card', { has: page.getByText(label, { exact: true }) });
  await expect(detail('Furnishing')).toContainText('Semi-Furnished');
  await expect(detail('Floor')).toContainText('5');
});

test('detail page shows the owner’s real deposit for a rental (not price × 2)', async ({ page }) => {
  const slug = await publishListing({
    deal: 'rent', propertyType: 'Flat', bhk: 2, area: 900, price: 20000,
    // The bug: an absent deposit fell back to a multiple of the rent. ₹45,000 is deliberately not
    // ₹40,000, so the fallback and the saved value cannot be confused.
    deposit: 45000,
  });

  await page.goto(`/property/${slug}`);
  await expect(page.getByRole('heading', { name: /Key Details/i })).toBeVisible({ timeout: 20000 });
  // The Deposit stat tile reflects the saved ₹45,000, not the ₹40,000 fallback.
  await expect(page.getByText('₹45,000').first()).toBeVisible();
});
