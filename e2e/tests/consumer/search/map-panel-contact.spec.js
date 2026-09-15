import { test, expect } from '@playwright/test';
import { API, authHeaders, signedInAsNew, grantIdentityBadge } from '../../../helpers/liveAuth.js';

/* Per ADR-019 the identity badge is a badge, not a gate: a signed-in buyer — verified or not —
 * starts an in-app chat request from the drawer with no verification detour. */

const SLUG = 'p5150';

/** The marker label `PropertyMap` computes for a sale listing (`PropertyMap.jsx:15`). */
const markerLabel = (price) => (price >= 1e7
  ? '\u20B9' + (price / 1e7).toFixed(2) + 'Cr'
  : '\u20B9' + Math.round(price / 1e5) + 'L');

/* The click target is a computed price label, usable as a selector only while unique on screen —
 * asserting that fails with "two markers share this label" rather than opening the wrong drawer. */
async function banerVilla() {
  const res = await fetch(`${API}/properties?deal=buy&localities=baner&size=100`);
  expect(res.ok, `GET /properties -> ${res.status}`).toBe(true);
  const rows = (await res.json()).content || [];

  const villa = rows.find((p) => p.slug === SLUG);
  expect(villa, `${SLUG} is not in the Baner buy stock; the seed fixture did not load`).toBeTruthy();
  expect(villa.lat != null && villa.lng != null, `${SLUG} has no coordinates, so it cannot be pinned`).toBe(true);

  const label = markerLabel(villa.price);
  const sharing = rows.filter((p) => p.lat != null && p.lng != null && markerLabel(p.price) === label);
  expect(sharing.map((p) => p.slug), `more than one Baner marker reads "${label}"`).toEqual([SLUG]);

  return { villa, label };
}

/** Open the map view and click the villa's marker. Returns the drawer, asserted open. */
async function openDrawer(page, label) {
  await page.goto('/listings?deal=buy&view=map&loc=baner');
  const marker = page.locator('.price-marker', { hasText: label }).first();
  await marker.waitFor({ timeout: 20000 });
  await marker.click();

  const drawer = page.locator('.dz-mdp');
  await expect(drawer, 'the marker click did not open the detail drawer').toBeVisible({ timeout: 10000 });
  return drawer;
}

/** `/auth/me` for a mobile, over a real session. */
async function me(mobile) {
  const res = await fetch(`${API}/auth/me`, { headers: await authHeaders(mobile) });
  expect(res.ok, `GET /auth/me -> ${res.status}`).toBe(true);
  return res.json();
}

/* Names `verified` on both sides of the grant: a field-agnostic diff is vacuous here because each
 * `/auth/me` login bumps `lastActive`, so a no-op grant would still look like a change. */
async function grantAndProve(mobile) {
  const before = await me(mobile);
  expect(
    before.verified,
    'a freshly-minted account already holds the Verified badge, so granting it cannot be what '
    + 'distinguishes this test from the unverified one below',
  ).toBe(false);

  await grantIdentityBadge(mobile);

  const after = await me(mobile);
  expect(
    after.verified,
    'granting the identity badge did not verify the account, so the "verified buyer" here is just '
    + 'the unverified buyer again and this pair proves nothing',
  ).toBe(true);
}

test('a verified buyer reaches the owner from the map drawer, in the app and not by phone', async ({ page }) => {
  const { villa, label } = await banerVilla();
  const mobile = await signedInAsNew(page);
  await grantAndProve(mobile);

  const drawer = await openDrawer(page, label);
  await drawer.getByRole('button', { name: /Contact Owner/i }).click();

  // Straight into the thread for this listing. No number-reveal popup, no interstitial.
  await expect(page).toHaveURL(new RegExp(`/messages\\?openProp=${villa.slug}`, 'i'));
  await expect(page.getByText(/Waiting for the owner to accept/i)).toBeVisible({ timeout: 10000 });
});

test('an unverified buyer reaches the same owner the same way (badge-not-gate, ADR-019)', async ({ page }) => {
  /* This owner has not asked for "verified contacts only", so the sameness with the test above is
     the assertion — the failure it guards against is a gate added here in good faith. */
  const { villa, label } = await banerVilla();
  const mobile = await signedInAsNew(page);
  /* Stated here rather than borrowed from the sibling test: otherwise skipping that one quietly
     turns this into an unlabelled duplicate. */
  expect(
    (await me(mobile)).verified,
    'this buyer already holds the Verified badge, so this is the verified test again under another name',
  ).toBe(false);

  const drawer = await openDrawer(page, label);
  await drawer.getByRole('button', { name: /Contact Owner/i }).click();

  await expect(page).toHaveURL(new RegExp(`/messages\\?openProp=${villa.slug}`, 'i'));
  await expect(page.getByText(/Waiting for the owner to accept/i)).toBeVisible({ timeout: 10000 });
});
