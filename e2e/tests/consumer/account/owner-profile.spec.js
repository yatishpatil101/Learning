import { test, expect } from '../../../fixtures/base.js';

// Public owner profile (/owner/:id).
//
// Behaviour verified from: pages/consumer/Owner.jsx and lib/mockApi/users.js
// (getOwner(id) resolves a user by `id` and attaches their listings where
// listing.ownerId === id). The page is public (no ProtectedRoute in App.jsx);
// contact actions gate behind sign-in via the contact flow.
//
// U1006 = "Meera Joshi", a seeded Pune owner with 8 listings in src/data/db.json.
const OWNER_ID = 'U1006';
const OWNER_NAME = 'Meera Joshi';

async function seedConsent(page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'pn_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: false, version: 1, ts: Date.now() }),
    );
  });
}

test.describe('Owner profile — /owner/:id', () => {
  test('renders the profile header for a seeded owner', async ({ page }) => {
    await seedConsent(page);
    await page.goto(`/owner/${OWNER_ID}`);

    await expect(page.getByRole('heading', { name: OWNER_NAME })).toBeVisible();
    // Trust badges + positioning line straight from Owner.jsx.
    await expect(page.getByText('Verified Owner').first()).toBeVisible();
    await expect(page.getByText('Zero Brokerage', { exact: true })).toBeVisible();
    await expect(page.getByText('Property Owner · Direct dealing, no middlemen')).toBeVisible();
    // Header stat block.
    await expect(page.getByText('Properties Listed')).toBeVisible();
    await expect(page.getByText('Member Since')).toBeVisible();
  });

  test('shows the owner listing grid and About section', async ({ page }) => {
    await seedConsent(page);
    await page.goto(`/owner/${OWNER_ID}`);

    await expect(page.getByRole('heading', { name: 'About the Owner' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Properties by this Owner' })).toBeVisible();
    // The grid links out to each property; a seeded owner has real inventory.
    await expect(page.locator('a[href^="/property/"]').first()).toBeVisible();
    expect(await page.locator('a[href^="/property/"]').count()).toBeGreaterThan(0);
  });

  test('routes contact through a listing rather than granting it profile-wide', async ({ page }) => {
    await seedConsent(page);
    await page.goto(`/owner/${OWNER_ID}`);

    // In-app chat is L1 and needs no number, so Message stays available to anyone.
    await expect(page.getByRole('button', { name: 'Message' })).toBeVisible();

    // The number is NOT requestable here. The contact gate is per listing: an approval on one
    // property is not an approval on this owner's others, so a profile-level request would be
    // granting a permission the system does not model. Call/WhatsApp used to render as request
    // buttons here and must not come back.
    await expect(page.getByRole('button', { name: 'Call' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'WhatsApp' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Request number' })).toHaveCount(0);

    // The number stays masked, and the CTA points at the listings where the gate actually lives.
    await expect(page.getByText(/^\+91 \d\d••• •••\d\d$/).first()).toBeVisible();
    const viaListing = page.getByRole('link', { name: 'Contact via a listing' }).first();
    await expect(viaListing).toBeVisible();
    await expect(viaListing).toHaveAttribute('href', '#owner-listings');
  });

  test('shows a not-found state for an unknown owner id', async ({ page }) => {
    await seedConsent(page);
    await page.goto('/owner/NOPE-does-not-exist');

    await expect(page.getByRole('heading', { name: 'Owner not found' })).toBeVisible();
    await expect(page.getByText('This profile may have been removed or the link is incorrect.')).toBeVisible();
    await expect(page.getByRole('link', { name: /Browse listings/i })).toBeVisible();
  });

  test('the owner profile loads with no real console errors', async ({ page, consoleErrors }) => {
    await seedConsent(page);
    await page.goto(`/owner/${OWNER_ID}`);
    await expect(page.getByRole('heading', { name: OWNER_NAME })).toBeVisible();
    expect(consoleErrors).toEqual([]);
  });
});
