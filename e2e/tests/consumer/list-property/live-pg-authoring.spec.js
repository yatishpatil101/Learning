/**
 * Authoring a PG / Hostel in the posting wizard, against the live backend.
 *
 * Converted out of `tests/consumer/flatmates/pg-listing-details.spec.js`, which was
 * filed under flatmates by mistake. It drives `/list-property` — the owner's "Post a
 * property" wizard — and never once opens the flatmates board. PG occupancy is a
 * property-type concept, not a roommate one; `propertyTypes.js` draws that line at
 * the definition of PG_SHARING, calling the single→dormitory model "deliberately
 * separate from Flatmates's Private/Shared roommate concept".
 *
 * The mock signed in by writing `draazyUser` and an Aadhaar record straight into
 * localStorage, so it could only ever prove that the renderer branches correctly:
 * the browser had been told it was signed in, and nothing the wizard asked the
 * server for was ever really asked. Here the account is registered over HTTP and
 * carries a genuine JWT, so a wizard that mounts under a seeded key but throws on a
 * real `/me` response — or a step whose fields are assembled from a live call —
 * fails here and could not have failed there.
 *
 * No Aadhaar badge is granted: the wizard has no identity gate (D-no-gate), and
 * granting one would quietly assert the opposite of what `live-no-gate` proves.
 *
 * Nothing here duplicates live-types.spec.js. That file walks Commercial, Open Plot,
 * Independent House, Farm Land, Warehouse and Shop through their branches; PG is the
 * one canonical type it lists in the dropdown and then never selects.
 */
import { test, expect } from '../../../fixtures/live.js';
import { signedInAsNew } from '../../../helpers/liveAuth.js';

async function gotoForm(page) {
  const mobile = await signedInAsNew(page);
  await page.goto('/list-property');
  await page.waitForSelector('.lp-steps', { timeout: 20000 });
  return mobile;
}

/* `Select.jsx` portals its menu and only flips `portalOpen` one requestAnimationFrame
   after the open (Select.jsx:178); until then it is `opacity: 0; pointer-events: none`
   (dropdown.css:198). Waiting on the class fails loudly if the menu never opens,
   which a fixed sleep does not. */
async function menuOpen(page) {
  await expect(page.locator('.dz-dropdown__menu.is-portal-open')).toBeVisible();
}

async function pickType(page, label) {
  await page.locator('[data-err="propertyType"]').click();
  await menuOpen(page);
  await page.locator('.dz-dropdown__option', { hasText: label }).first().click();
}

const label = (page, text) => page.getByText(text, { exact: true });

/* A PG is let by the bed and usually occupies a whole building, so the two fields a
   flat needs — which floor the unit is on, and how big the unit is — are meaningless
   for it, and a field it needs (how many floors the building has) is meaningless for
   a flat. The wizard is supposed to swap them.
 *
 * The Flat leg at the end is what stops this being vacuous. "Floor No. is absent" and
 * "Built-up Area is absent" would both be satisfied by a step that had failed to
 * render at all, or by a typo in the label under test; bouncing the type and finding
 * the same two labels present proves they exist, are spelled this way, and were
 * withheld from the PG on purpose. */
test('a PG asks for building floors and occupancy, not a unit floor and built-up area', async ({ page }) => {
  await gotoForm(page);
  await page.locator('.lp-step').getByText('Rent', { exact: true }).first().click();
  await pickType(page, 'PG / Hostel');

  // Occupancy is authored as a pill group, with the owner-facing note explaining
  // that a PG usually offers several and each is priced separately.
  await expect(page.getByText(/Select every room-sharing option your PG offers/i)).toBeVisible();
  await expect(label(page, 'Single (No Sharing)')).toBeVisible();
  await expect(label(page, 'Double Sharing')).toBeVisible();
  await expect(label(page, 'Dormitory (6+)')).toBeVisible();

  // A whole-building let counts its floors; it does not sit on one.
  await expect(label(page, 'No. of Floors')).toBeVisible();
  await expect(label(page, 'Floor No.')).toHaveCount(0);
  // A PG is sold by the bed, so a unit area would be a fabrication.
  await expect(label(page, 'Built-up Area')).toHaveCount(0);

  // Bounce to a Flat: the two withheld fields come back, and the PG-only occupancy
  // group goes away.
  await pickType(page, 'Flat / Apartment');
  await expect(label(page, 'Floor No.')).toBeVisible();
  await expect(label(page, 'Built-up Area')).toBeVisible();
  await expect(page.getByText(/Select every room-sharing option your PG offers/i)).toHaveCount(0);
});

/* Furnishing inventory is per-type. The pairing is the assertion: a furnished PG
   offers a Study Table and not a Kitchen Trolley, because a PG resident gets a desk
   in their room and does not get the kitchen. Asserting only the absence would pass
   against an inventory that never rendered; asserting both against the same list at
   the same moment cannot. */
test('a furnished PG lists PG inventory, not household inventory', async ({ page }) => {
  await gotoForm(page);
  await page.locator('.lp-step').getByText('Rent', { exact: true }).first().click();
  await pickType(page, 'PG / Hostel');

  await label(page, 'Furnished').click();

  await expect(label(page, 'Study Table')).toBeVisible();
  await expect(label(page, 'Kitchen Trolley')).toHaveCount(0);
});
