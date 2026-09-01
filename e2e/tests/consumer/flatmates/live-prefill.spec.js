import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAs, signedInAsNew } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { trackErrors } from '../../../helpers/console.js';

/**
 * LIVE: one-tap replacement posting — the group form filled from property the server already holds.
 *
 * ## Why this converts, when the ledger said it could not
 *
 * `prefill.spec.js` was carried as a permanent mock keeper on the grounds that it was "UI-only".
 * It is not. Both pickers it drives have been on the seam since before the mock was written —
 * `useFlatmates.jsx:250` reads the owner's inventory through `propertyService.myListings`, and
 * `:273` reads the tenant's through `rentService.myTenancies`, each with an http provider behind
 * it. What made the mock look unconvertible was its *seeding*, not its subject: it wrote
 * `draazyListings:<mobile>` and `dzTenancies:<mobile>` into localStorage, and by the end it was
 * also reaching into `draazyDB_v5` post-boot because the first key had stopped being the source
 * of truth. Three storage reaches to arrange two rows the seeded server already has.
 *
 * So nothing about the product had to change for this file to exist. It signs in as the seeded
 * owner and the seeded tenant and drives the same four claims against their real inventory.
 *
 * ## The fixtures are read, not hard-coded
 *
 * Every expectation below is derived from what `/me/listings` and `/me/tenancies` actually answer,
 * rather than from the titles the seed happens to use today. Prefill's whole job is to copy the
 * server's own values into the form, so a test that asserted a literal would be pinning the seed
 * rather than the copy — and would go green if prefill were deleted and the seed renamed to match.
 * Reading first also lets the sale case pick a genuinely non-rent row instead of assuming one.
 *
 * ## What is deliberately still not claimed
 *
 * Prefill fills descriptive fields and the owner's number. It never fills the trust tier, and the
 * tenant case asserts that directly: the consent button becomes *available*, not satisfied — the
 * owner's OTP is still the only thing that can verify consent, and `prefillGroupFromTenancy` sets
 * `consentVerified: false` on purpose.
 */

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

/** The signed-in owner's own inventory, as the picker's loader reads it. */
async function myListings(token) {
  const res = await fetch(`${API}/me/listings?size=50`, { headers: auth(token) });
  expect(res.status, 'the owner should be able to read their own listings').toBe(200);
  return (await res.json()).content || [];
}

/* The group modal is behind the Post chooser, on the "still looking" branch — a group is people
   without a place, so that is where the product files it. Same three clicks as
   `live-group-lifecycle.spec.js`; scoped to `.sf-modal` because the board underneath carries a
   Post button of its own. */
async function openGroupModal(page) {
  await page.goto('/flatmates');
  await expect(page.getByRole('button', { name: /^Post$/ }).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: /^Post$/ }).first().click();
  await page.locator('.sf-modal').getByRole('button', { name: /I'm still looking for a place/i }).click();
  await page.locator('.sf-modal').getByRole('button', { name: /We're already a group/i }).click();
  await expect(page.getByPlaceholder(/2 girls/i)).toBeVisible({ timeout: 10_000 });
}

/** Pick a listing out of the owner's picker. `NativeSelect` renders a themed menu, not a `<select>`. */
async function attachProperty(page, title) {
  await page.getByRole('button', { name: /Attach a verified property/i }).click();
  await page.getByRole('option', { name: title, exact: true }).click();
}

const titleField = (page) => page.getByPlaceholder(/2 girls/i);
const rentField = (page) => page.getByPlaceholder(/e\.g\. 34000/i);

test.describe('LIVE: group-form prefill', () => {
  test('an owner attaching a real rent listing gets its locality and its rent, both from the server', async ({ page }) => {
    const errors = trackErrors(page);
    const { accessToken } = await apiLogin(ACTORS.owner);
    const listing = (await myListings(accessToken))
      .find((row) => row.status === 'approved' && row.deal === 'rent');
    expect(listing, 'the seeded owner needs an approved rent listing').toBeTruthy();

    await signedInAs(page, ACTORS.owner);
    await openGroupModal(page);
    await page.getByRole('button', { name: /Flat owner/i }).click();
    await attachProperty(page, listing.title);

    /* The title is generated, not copied: `replacementTitle` builds "1 more flatmate for a {bhk}
       in {locality}". Asserting its shape rather than a literal keeps this honest about which
       parts came from the row — the bedroom count and the locality are the listing's, and the
       sentence around them is the product's. */
    await expect(titleField(page)).toHaveValue(
      new RegExp(`1 more flatmate for a ${listing.bhk} BHK in ${listing.locality}`, 'i'),
    );
    // The rent is copied outright, because a monthly rent is a monthly rent.
    await expect(rentField(page)).toHaveValue(String(listing.price));

    expect(errors, `console errors: ${errors.join('\n')}`).toHaveLength(0);
  });

  test('a sale listing prefills the title but leaves rent empty, because a sale price is not a monthly rent', async ({ page }) => {
    const { accessToken } = await apiLogin(ACTORS.owner);
    const listing = (await myListings(accessToken))
      .find((row) => row.status === 'approved' && row.deal !== 'rent');
    expect(listing, 'the seeded owner needs an approved non-rent listing').toBeTruthy();

    await signedInAs(page, ACTORS.owner);
    await openGroupModal(page);
    await page.getByRole('button', { name: /Flat owner/i }).click();
    await attachProperty(page, listing.title);

    await expect(titleField(page)).toHaveValue(
      new RegExp(`1 more flatmate for a ${listing.bhk} BHK in ${listing.locality}`, 'i'),
    );
    /* The point of the test. The row carries a price — a large one — and prefill has to decline to
       use it. An empty box is the assertion, so the sale price is named here to prove the value
       existed and was refused rather than being absent. */
    expect(listing.price, 'the sale row should carry a price worth refusing').toBeGreaterThan(0);
    await expect(rentField(page)).toHaveValue('');
  });

  /* Live-only. The picker is fed by `myListings(...).filter(isApproved)`, and the seeded owner
     holds a `flagged` row alongside their approved ones — so the filter has something real to
     exclude. The mock could not make this claim: it wrote its own two rows into localStorage, so
     there was never an unapproved listing on the account to leave out. */
  test('a listing that has not passed moderation is not offered as proof of ownership', async ({ page }) => {
    const { accessToken } = await apiLogin(ACTORS.owner);
    const all = await myListings(accessToken);
    const unapproved = all.find((row) => row.status !== 'approved');
    expect(unapproved, 'the seeded owner needs a non-approved listing for this to mean anything').toBeTruthy();

    await signedInAs(page, ACTORS.owner);
    await openGroupModal(page);
    await page.getByRole('button', { name: /Flat owner/i }).click();
    await page.getByRole('button', { name: /Attach a verified property/i }).click();

    // An approved row is present first, so "the flagged one is absent" cannot be an empty menu.
    const approved = all.find((row) => row.status === 'approved');
    await expect(page.getByRole('option', { name: approved.title, exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: unapproved.title, exact: true })).toHaveCount(0);
  });

  test('a sitting tenant prefills from their real tenancy, and the owner-consent step becomes one tap', async ({ page }) => {
    const errors = trackErrors(page);
    const { accessToken } = await apiLogin(ACTORS.tenant);
    const tenancies = await (await fetch(`${API}/me/tenancies`, { headers: auth(accessToken) })).json();
    const tenancy = (Array.isArray(tenancies) ? tenancies : [tenancies]).find((row) => row.status !== 'ended');
    expect(tenancy, 'the seeded tenant needs an active tenancy').toBeTruthy();

    /* `TenancyDto` names no property — it carries the flat's id and nothing else about it, so that
       renaming a property cannot leave the lease disagreeing with itself. `toRentalCards` resolves
       it, which is what lets the picker say which flat this is and what lets the prefill derive a
       locality at all. Resolved here for the same reason. */
    const flat = await (await fetch(`${API}/properties/${tenancy.propertyId}`)).json();
    expect(flat.locality, 'the tenancy flat needs a locality to derive from').toBeTruthy();

    await signedInAs(page, ACTORS.tenant);
    await openGroupModal(page);
    // "Current tenant" is the default role, so the tenancy picker is already on screen.
    await page.getByRole('button', { name: /Prefill from your Draazy tenancy/i }).click();
    await page.getByRole('option', { name: flat.title, exact: true }).click();

    /* No bedroom count here, unlike the owner path — `prefillGroupFromTenancy` passes only the
       locality. The tenancy is a lease, and the number of bedrooms in the flat is the landlord's
       fact rather than a term of it. */
    await expect(titleField(page)).toHaveValue(new RegExp(`^1 more flatmate in ${flat.locality}$`, 'i'));
    await expect(rentField(page)).toHaveValue(String(tenancy.rent));

    /* The owner's number comes off the tenancy, which is the whole reason this path can shorten
       consent: Draazy brokered the lease, so it already knows who the landlord is. */
    const ownerMobile = String(tenancy.owner?.mobile || '').replace(/\D/g, '').slice(-10);
    expect(ownerMobile, 'the tenancy should name the landlord').toHaveLength(10);
    await expect(page.getByPlaceholder(/seeking a replacement/i)).toHaveValue(ownerMobile);

    /* Available, not satisfied. Prefill fills the number and explicitly leaves `consentVerified`
       false — the owner's OTP is still the only thing that can turn this into consent. */
    await expect(page.getByRole('button', { name: /Verify owner consent via OTP/i })).toBeEnabled();

    expect(errors, `console errors: ${errors.join('\n')}`).toHaveLength(0);
  });

  test('a tenant with no tenancy on record is not offered a prefill they cannot use', async ({ page }) => {
    await signedInAsNew(page);
    await openGroupModal(page);
    await expect(page.getByRole('button', { name: /Prefill from your Draazy tenancy/i })).toHaveCount(0);
    // The form itself is still there — this is a missing shortcut, not a blocked path.
    await expect(titleField(page)).toBeVisible();
  });
});
