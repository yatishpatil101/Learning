/**
 * Two regressions from the List Property freeze QA pass, checked against the server.
 *
 * Converted from `rent-maintenance.spec.js`. The first claim is the one that gains: `submit.js`
 * compared `rentMaintMode` against a stale `'excluded'` while the UI and the store used `'extra'`,
 * so the amount the owner typed was dropped in silence — the listing saved, the success screen
 * showed, and the maintenance figure was simply gone. The mock version caught that by reading the
 * browser store back. This one reads `GET /me/listings`, so the amount has to have survived the
 * mapper and the column as well as the branch, and a re-break anywhere along that path fails here.
 *
 * The browser calls it `rentMaintenance` and the server calls it `maintenance`; there is one column
 * either way. `live-seam-write` owns the wider claim about which wizard field lands in which
 * response field — this file is narrower, and its subject is the mode branch that decides whether
 * an amount is sent at all.
 *
 * The keyboard test is unchanged in substance: pill semantics are client-side, and it runs here
 * only because it shares the file it was written in.
 */
import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { pickDate } from '../../../helpers/datePicker.helper.js';
import { signedInAsNew, authHeaders, API } from '../../../helpers/liveAuth.js';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/**
 * The owners this file minted, so their listings can be taken back out of the catalogue.
 *
 * Tracked by mobile rather than by listing id: only one of the two tests posts, and it learns the
 * id late, so a failure part-way through the wizard would otherwise leave a row behind. Teardown
 * rejects rather than deletes — there is no delete route, and rejection is the state the moderation
 * desk itself uses to withdraw a listing.
 */
const owners = new Set();

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
        body: JSON.stringify({ status: 'rejected', reason: 'Zztest cleanup \u2014 synthetic rent-maintenance fixture' }),
      });
    }
  }
  owners.clear();
});

/* `.lp-steps` rather than the mock's `.lp-meter`: the meter renders on the listing-limit paywall as
   well as on the wizard, so it cannot tell the two branches apart. */
async function gotoFlow(page) {
  const mobile = await signedInAsNew(page);
  owners.add(mobile);
  await page.goto('/list-property');
  await page.waitForSelector('.lp-steps', { timeout: 20000 });
  return mobile;
}

async function pickOption(page, dataErr, label) {
  await page.locator(`[data-err="${dataErr}"]`).click();
  /* `Select` portals its menu and only flips `portalOpen` one requestAnimationFrame after the open
     (Select.jsx:178); until then it is `opacity: 0; pointer-events: none` (dropdown.css:198). */
  await expect(page.locator('.pn-dropdown__menu.is-portal-open')).toBeVisible();
  await page.locator('.pn-dropdown__option', { hasText: label }).first().click();
}

test('Rent "Charged Extra" maintenance amount is saved on the listing', async ({ page }) => {
  const mobile = await gotoFlow(page);

  // Step 1 — rent flat.
  await page.locator('.radio-pill', { hasText: 'Rent' }).first().click();
  await page.locator('[data-err="propertyType"]').click();
  await expect(page.locator('.pn-dropdown__menu.is-portal-open')).toBeVisible();
  await page.locator('.pn-dropdown__option', { hasText: 'Flat / Apartment' }).first().click();
  await page.locator('input[data-err="carpetArea"]').fill('900');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('.gm-style', { timeout: 30000 });

  // Step 2 — location + rent pricing + Charged Extra maintenance.
  await pickOption(page, 'locality', 'Baner');
  await page.locator('input[data-err="flatNumber"]').fill('B-1204');
  await page.locator('input[data-err="society"]').fill('Skyline Heights');
  await page.locator('input[data-err="pincode"]').fill('411045');
  await page.locator('input[data-err="monthlyRent"]').fill('30000');
  await page.locator('input[data-err="deposit"]').fill('60000');
  await page.locator('.radio-pill', { hasText: 'Charged Extra' }).click();
  await page.locator('input[placeholder="e.g. 2,500"]').fill('2500');
  await pickDate(page, '[data-err="availableFrom"]', '2025-12-31');
  await page.getByRole('button', { name: /Next Step/i }).click();
  await page.waitForSelector('text=/Photos & documents/i', { timeout: 15000 });

  // Step 3 — one photo + the required Ownership Proof doc for a rent listing.
  const buf = Buffer.from(PNG, 'base64');
  await page.locator('input[type="file"][accept="image/*"]').first().setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: buf });
  await page.locator('input[type="file"][accept="image/*,.pdf"]').first().setInputFiles({ name: 'doc.png', mimeType: 'image/png', buffer: buf });
  await page.getByRole('button', { name: /Submit Property/i }).click();
  await expect(page.locator('text=/Listed Successfully/i')).toBeVisible({ timeout: 30000 });

  // The saved listing must carry the extra maintenance amount, not a null.
  const res = await fetch(`${API}/me/listings`, { headers: await authHeaders(mobile) });
  expect(res.status).toBe(200);
  const body = await res.json();
  const rows = Array.isArray(body) ? body : (body.content ?? body.items ?? []);
  // Brand-new account, one listing posted, free tier allows one — no search needed.
  expect(rows).toHaveLength(1);
  expect(rows[0].deal).toBe('rent');
  expect(rows[0].maintenance).toBe(2500);
});

test('Pill and Toggle selection atoms are keyboard-operable', async ({ page }) => {
  await gotoFlow(page);

  // A pill exposes button semantics + pressed state and toggles via keyboard.
  const rentPill = page.locator('.radio-pill', { hasText: 'Rent' }).first();
  await expect(rentPill).toHaveAttribute('role', 'button');
  await rentPill.focus();
  await rentPill.press('Enter');
  await expect(rentPill).toHaveClass(/selected/);
  await expect(rentPill).toHaveAttribute('aria-pressed', 'true');

  // Space also activates (and must not scroll the page away).
  const salePill = page.locator('.radio-pill', { hasText: 'Sale' }).first();
  await salePill.focus();
  await salePill.press(' ');
  await expect(salePill).toHaveClass(/selected/);
});
