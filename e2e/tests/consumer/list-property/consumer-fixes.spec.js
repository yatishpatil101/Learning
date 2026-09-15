/* Bathrooms, Parking, Facing and Age tiles are an uncovered gap on purpose: no owner-posting path
 * can set them, and seeding such a row would report a feature that does not work. */
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

/* Approval is required because the detail page under test is the public one — an unmoderated
 * listing would leave the test asserting on a 404 page. */
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
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
  await page.locator('.dz-dropdown__option', { hasText: label }).first().click();
}

test('switching property type clears the previous type-specific answers (cascade reset)', async ({ page }) => {
  await signedInAsNew(page);
  await page.goto('/list-property');
  /* `.lp-steps` rather than the mock's `.lp-meter`: the meter renders on the listing-limit paywall
     as well as on the wizard, so it cannot tell the two branches apart. */
  await page.waitForSelector('.lp-steps', { timeout: 20000 });

  await pickType(page, 'Flat / Apartment');
  const threeBhk = page.locator('[data-err="bhk"] .radio-pill', { hasText: '3' });
  await threeBhk.click();
  await expect(threeBhk).toHaveClass(/selected/);

  // Bounce to a plot, which has no BHK at all, and back - the pick must not survive.
  await pickType(page, 'Open Plot');
  await pickType(page, 'Flat / Apartment');
  await expect(page.locator('[data-err="bhk"] .radio-pill', { hasText: '3' })).not.toHaveClass(/selected/);});

test('detail page shows the owner’s real furnishing and floor, not a value derived from BHK', async ({ page }) => {
  const slug = await publishListing({
    deal: 'buy', propertyType: 'Flat', bhk: 3, area: 1200, price: 12000000,
    /* Spelled the server's way: `publishListing` posts with `fetch` below `propertyMapper`, so the
       UI key `semi` is rejected 422 here — and the page can only print "Semi-Furnished" if the
       mapper translated `semi-furnished` back on the way in. */
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
