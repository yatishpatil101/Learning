import { test, expect } from '../fixtures/base.js';

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

  test('exposes contact CTAs that gate on sign-in for a signed-out visitor', async ({ page }) => {
    await seedConsent(page);
    await page.goto(`/owner/${OWNER_ID}`);

    await expect(page.getByRole('button', { name: 'Message' })).toBeVisible();
    // Number is protected until requested — Call/WhatsApp render as request buttons.
    await expect(page.getByRole('button', { name: 'Call' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'WhatsApp' })).toBeVisible();

    // Requesting the number while signed out bounces to sign-in (contact reason).
    await page.getByRole('button', { name: 'Call' }).click();
    await expect(page).toHaveURL(/\/signin/);
    await expect(page).toHaveURL(/reason=contact/);
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
