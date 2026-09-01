import { test, expect } from '@playwright/test';

// Society Hub — location accuracy: read-only map + "Get directions" deep link, and a
// resident-proposed location-correction flow (KYC + resident gated) routed through the
// ops moderation queue. All state is localStorage (no backend).
// Seed society: verified "Skyline Heights, Baner" (lat 18.5602, lng 73.7861).

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const SLUG = 'skyline-heights-baner';
const KYC_MOBILE = '9876543212';
const RES_MOBILE = '9820011111';

async function seedUser(page, mobile, role = 'owner') {
  await page.addInitScript(([m, r]) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Riya Sharma', mobile: m, role: r, loginAt: Date.now() }));
  }, [mobile, role]);
}
async function seedKyc(page, mobile, role = 'owner') {
  await seedUser(page, mobile, role);
  await page.addInitScript((m) => {
    localStorage.setItem('puneNestAadhaar:' + m, JSON.stringify({ verified: true, aadhaarMobile: m, at: Date.now() }));
  }, mobile);
}
async function seedResident(page, mobile) {
  await page.addInitScript(([s, m]) => {
    localStorage.setItem('pnSocietyResidents', JSON.stringify([
      { id: 'res-' + m, slug: s, mobile: m, status: 'verified', name: 'Riya Sharma', wing: 'A', flat: '101', unitKey: 'A101', at: Date.now() },
    ]));
  }, [SLUG, mobile]);
}
async function gotoHub(page) {
  await page.goto(`${BASE}/society/${SLUG}?tab=location`);
  await expect(page.getByRole('heading', { level: 1, name: /Skyline Heights/i })).toBeVisible({ timeout: 10000 });
}
async function loginAsAdmin(page) {
  await page.goto(`${BASE}/staff-login`);
  await page.getByRole('button', { name: /Admin/i }).first().click();
  await page.waitForURL('**/admin');
}

// ─── AC1: map card + "Get directions" deep link ───
test('society hub shows a Get-directions deep link to the society coordinates', async ({ page }) => {
  await gotoHub(page);
  const section = page.locator('section', { has: page.getByRole('heading', { name: /Location & connectivity/i }) });
  const dir = section.getByRole('link', { name: /Get directions/i });
  await expect(dir).toBeVisible({ timeout: 8000 });
  await expect(dir).toHaveAttribute('href', /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=18\.5602,73\.7861/);
  await expect(dir).toHaveAttribute('target', '_blank');
  await expect(dir).toHaveAttribute('rel', /noopener/);
});

// ─── AC2: verified resident proposes a corrected pin → pending, public pin unchanged ───
test('verified resident proposes a location fix — stored pending, public map not moved yet', async ({ page }) => {
  await seedKyc(page, RES_MOBILE);
  await seedResident(page, RES_MOBILE);
  await gotoHub(page);

  const section = page.locator('section', { has: page.getByRole('heading', { name: /Location & connectivity/i }) });
  await section.getByRole('button', { name: /Suggest correct location/i }).click();

  const dialog = page.getByRole('dialog', { name: 'Suggest society location' });
  await expect(dialog).toBeVisible({ timeout: 8000 });
  await dialog.getByLabel('Latitude').fill('18.565');
  await dialog.getByLabel('Longitude').fill('73.79');
  await dialog.getByRole('button', { name: 'Submit for review' }).click();

  await expect(page.getByText(/map updates once our team approves/i)).toBeVisible({ timeout: 8000 });

  const state = await page.evaluate(() => ({
    fixes: JSON.parse(localStorage.getItem('pnSocietyLocationFixes') || '{}'),
    overlay: JSON.parse(localStorage.getItem('pnSocietyOverlay') || '{}'),
  }));
  expect(state.fixes[SLUG].status).toBe('pending');
  expect(state.fixes[SLUG].lat).toBeCloseTo(18.565, 3);
  // Pending must NOT move the public pin — no coords written to the overlay yet.
  expect(state.overlay[SLUG] && state.overlay[SLUG].lat).toBeFalsy();
});

// ─── AC3: non-resident KYC user cannot propose ───
test('a non-resident KYC user sees no Suggest-location control and the store refuses their proposal', async ({ page }) => {
  await seedKyc(page, KYC_MOBILE); // KYC but not a verified resident
  await gotoHub(page);
  const section = page.locator('section', { has: page.getByRole('heading', { name: /Location & connectivity/i }) });
  await expect(section.getByRole('button', { name: /Suggest correct location/i })).toHaveCount(0);

  const out = await page.evaluate(async ([s]) => {
    const m = await import('/src/lib/store.js');
    return m.proposeSocietyLocation(s, { lat: 18.56, lng: 73.79 });
  }, [SLUG]);
  expect(out).toBe('forbidden');
});

// ─── AC4: a resident without a badge still contributes (badge-not-gate) ───
test('a signed-in resident opens Suggest-location directly — no Aadhaar gate (store accepts it)', async ({ page }) => {
  await seedUser(page, RES_MOBILE);      // logged in, NOT identity-verified
  await seedResident(page, RES_MOBILE);  // but a verified resident → sees the control
  await gotoHub(page);

  const section = page.locator('section', { has: page.getByRole('heading', { name: /Location & connectivity/i }) });
  await section.getByRole('button', { name: /Suggest correct location/i }).click();
  // Badge-not-gate: the suggest dialog opens straight away; no identity wall.
  await expect(page.getByRole('dialog', { name: 'Suggest society location' })).toBeVisible({ timeout: 8000 });
  await expect(page.getByRole('dialog', { name: /Verify your identity with Aadhaar/i })).toHaveCount(0);

  const out = await page.evaluate(async ([s]) => {
    const m = await import('/src/lib/store.js');
    return m.proposeSocietyLocation(s, { lat: 18.56, lng: 73.79 });
  }, [SLUG]);
  // The store accepts the proposal (pending record), never returns the removed 'kyc'.
  expect(out).not.toBe('kyc');
  expect(out.status).toBe('pending');
});

// ─── AC5: out-of-bounds pin is rejected ───
test('a pin outside the city bounds is refused with "bounds"', async ({ page }) => {
  await seedKyc(page, RES_MOBILE);
  await seedResident(page, RES_MOBILE);
  await gotoHub(page);
  const out = await page.evaluate(async ([s]) => {
    const m = await import('/src/lib/store.js');
    return m.proposeSocietyLocation(s, { lat: 19.99, lng: 72.5 }); // Mumbai-ish, outside Pune
  }, [SLUG]);
  expect(out).toBe('bounds');
});

// ─── AC6: ops approves a location fix → the society map/directions use the new pin ───
test('ops approves a pending location fix → the society directions use the corrected coordinates', async ({ page }) => {
  // Seed a pending fix as if a resident already proposed it. Idempotent so the ops
  // approval isn't clobbered when addInitScript re-runs on later navigations.
  await page.addInitScript((s) => {
    if (!localStorage.getItem('pnSocietyLocationFixes')) {
      localStorage.setItem('pnSocietyLocationFixes', JSON.stringify({
        [s]: { lat: 18.5711, lng: 73.7999, placeId: '', label: 'Skyline Heights main gate', by: 'Riya Sharma', mobile: '9820011111', at: Date.now(), status: 'pending' },
      }));
    }
  }, SLUG);
  await loginAsAdmin(page);
  await page.goto(`${BASE}/admin/societies?tab=moderation`);

  const block = page.locator('div.pn-card', { hasText: 'Location fixes' });
  await expect(block.getByText('18.57110, 73.79990')).toBeVisible({ timeout: 8000 });
  await block.getByRole('button', { name: 'Approve' }).click();

  // Overlay now carries the corrected coordinates.
  const overlay = await page.evaluate(() => JSON.parse(localStorage.getItem('pnSocietyOverlay') || '{}'));
  expect(overlay[SLUG].lat).toBeCloseTo(18.5711, 3);
  expect(overlay[SLUG].locSource).toBe('community');

  // The public hub's directions link now targets the corrected pin.
  await gotoHub(page);
  const section = page.locator('section', { has: page.getByRole('heading', { name: /Location & connectivity/i }) });
  await expect(section.getByRole('link', { name: /Get directions/i })).toHaveAttribute('href', /destination=18\.5711,73\.7999/);
  await expect(section.getByText(/confirmed by a verified resident/i)).toBeVisible();
});
