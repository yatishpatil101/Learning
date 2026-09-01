import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';

/* A flatmate request posted via the Flatmates modal must appear under
   Dashboard > My Listings — even for a NON-owner user. Previously the request
   was stored in a separate key the dashboard never read, AND the My Listings
   tab was gated behind an owner check that a seeker didn't satisfy, so the tab
   itself was hidden. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const MOBILE = '9811122233';

async function seedUser(page) {
  await page.addInitScript((mobile) => {
    // Deliberately a NON-owner role: a plain seeker who has only posted a request.
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Share Tester', mobile, role: 'buyer', loginAt: Date.now() }));
    localStorage.setItem('puneNestAadhaar:' + mobile, JSON.stringify({ verified: true, aadhaarMobile: mobile, at: Date.now() }));
  }, MOBILE);
}

async function postRequest(page) {
  await page.goto(`${BASE}/flatmates?post=1`);
  await expect(page.getByRole('heading', { name: /Post your flatmate request/i })).toBeVisible({ timeout: 10000 });
  await page.locator('input[placeholder="₹ e.g. 15000"]').fill('16000');
  await page.getByRole('button', { name: 'Preferred localities' }).click();
  await page.locator('.pn-dropdown__option', { hasText: 'Baner' }).first().click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Post request/i }).click();
  /* The own-request manage banner lives on the **Team up** tab only: a flatmate request is
     a person looking for people, so it is not inventory the "Move in now" tab lists. Posting does
     not switch tabs, and the page opens on Move in now — so the banner has to be navigated to
     rather than waited for where the old single-list page used to put it. */
  await page.getByRole('button', { name: /Team up —/i }).click();
  /* The banner reads "in review", not "live": D72 holds every new post until a
     moderator approves it. The author still manages it from here and from My
     Listings, which is what this file is about — a post waiting for review must
     not vanish from its owner's own dashboard. */
  await expect(page.getByText(/in review/i).first()).toBeVisible({ timeout: 10000 });
}

test('a non-owner seeker sees My Listings tab and their flatmate request in it', async ({ page }) => {
  const errors = trackErrors(page);

  await seedUser(page);
  await postRequest(page);

  // The My Listings surface (My Properties → My Listings sub) must be reachable
  // for this non-owner user via the #listings deep-link.
  await page.goto(`${BASE}/dashboard#listings`);
  await page.waitForTimeout(800);

  // The request appears as a flatmate request card.
  await expect(page.getByText('Looking to share — Baner').first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('Flatmate request').first()).toBeVisible();

  expect(errors, `console errors: ${errors.join('\n')}`).toHaveLength(0);
});

test('My Listings type filter narrows to Flatmate requests', async ({ page }) => {
  await seedUser(page);
  await postRequest(page);

  await page.goto(`${BASE}/dashboard#listings`);
  await page.waitForTimeout(800);

  // The type filter dropdown is present; pick "Flatmate requests".
  const filter = page.getByRole('button', { name: 'Filter listings by type' });
  await expect(filter).toBeVisible({ timeout: 10000 });
  await filter.click();
  await page.locator('.pn-dropdown__option', { hasText: 'Flatmate requests' }).first().click();

  await expect(page.getByText('Looking to share — Baner').first()).toBeVisible();
});

/* A user whose ONLY posting is a flatmate group must still see the My Listings
   tab and their group in it. The owner-gate used to check rooms + requests but not
   groups, so a group-only host saw no My Listings tab at all — no way to find what
   they posted. */
test('a group-only host sees My Listings tab and their flatmate group in it', async ({ page }) => {
  const GMOBILE = '9822044455';
  await page.addInitScript((m) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Group Host', mobile: m, role: 'buyer', loginAt: Date.now() }));
    localStorage.setItem('puneNestFlatmateGroups', JSON.stringify([{
      id: 'mg777', title: 'My 2BHK group in Baner', locality: 'Baner', policy: 'any',
      rent: 30000, seatsTotal: 3, seatsOpen: 1,
      members: [{ name: 'Group Host', initials: 'GH', verified: true }],
      tags: [], note: '', time: 'Just now', createdAt: Date.now(),
      ownerMobile: m, ownerName: 'Group Host', hostRole: 'owner', verificationTier: 'identity',
    }]));
  }, GMOBILE);

  await page.goto(`${BASE}/dashboard#listings`);
  await page.waitForTimeout(800);

  await expect(page.getByText('My 2BHK group in Baner').first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('Flatmate group').first()).toBeVisible();
});

