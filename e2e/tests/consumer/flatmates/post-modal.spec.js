import { test, expect } from '@playwright/test';
import { trackErrors } from '../../../helpers/console.js';

/* "Post your flatmate request" modal redesign — MOCK-ONLY KEEPER.
 *
 * ## What is left here, and why
 *
 * One claim: the redesigned form still offers the fields it was redesigned to offer —
 * Preferred localities and Lifestyle as themed `pn-dropdown` triggers rather than chip
 * rows, plus the two P0 matching selects ("Looking to share with", "Room preference").
 * That is a statement about the form's shape, not about anything a server stores: none
 * of those three controls is read back over the API by any live spec, so there is no
 * live assertion to make. It stays here until the matching fields reach a route that
 * can testify about them.
 *
 * ## The submit test was retired, not lost
 *
 * This file used to end with "picking a locality via the dropdown and submitting posts
 * the request" — budget, open the localities dropdown, pick Baner, click "Post request",
 * then look for the "in review" banner on the Team up tab.
 *
 * `live-my-listings.spec.js` now drives that exact path against a real server, and drives
 * it harder: it waits on the `POST /flatmates/posts` response and asserts **201**, then
 * reads `GET /me/flatmate-posts` back on a connection the page is not holding. A form that
 * renders "posted" while the request 400s is precisely the failure the mock could not
 * produce, because the mock provider stores the client's own object and hands it back. The
 * "in review" half is owned there too, by the second test in that file. Keeping a weaker
 * duplicate here would have reported coverage that the live twin already owns outright. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const MOBILE = '9811122233';

async function seedUser(page) {
  await page.addInitScript((mobile) => {
    localStorage.setItem('puneNestUser', JSON.stringify({ name: 'Share Tester', mobile, role: 'owner', loginAt: Date.now() }));
    localStorage.setItem('puneNestAadhaar:' + mobile, JSON.stringify({ verified: true, aadhaarMobile: mobile, at: Date.now() }));
  }, MOBILE);
}

test('post modal shows dropdowns for localities/lifestyle and the new P0 selects', async ({ page }) => {
  const errors = trackErrors(page);

  await seedUser(page);
  await page.goto(`${BASE}/flatmates?post=1`);

  await expect(page.getByRole('heading', { name: /Post your flatmate request/i })).toBeVisible({ timeout: 10000 });

  // Localities is a dropdown trigger (aria-label), not a row of chips.
  const locTrigger = page.getByRole('button', { name: 'Preferred localities' });
  await expect(locTrigger).toBeVisible();

  // New P0 fields are present.
  await expect(page.getByText('Looking to share with')).toBeVisible();
  await expect(page.getByText('Room preference')).toBeVisible();

  // Lifestyle dropdown trigger is present.
  await expect(page.getByRole('button', { name: 'Lifestyle preferences' })).toBeVisible();

  expect(errors, `console errors: ${errors.join('\n')}`).toHaveLength(0);
});
