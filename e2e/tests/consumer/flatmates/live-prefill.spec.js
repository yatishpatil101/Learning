import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAs, signedInAsNew } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { trackErrors } from '../../../helpers/console.js';
import { postAsGroup } from '../../../helpers/app.js';

// Derive assertions from real owner and tenant inventory so prefill cannot pass against fixture literals.

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

async function myListings(token) {
  const res = await fetch(`${API}/me/listings?size=50`, { headers: auth(token) });
  expect(res.status, 'the owner should be able to read their own listings').toBe(200);
  return (await res.json()).content || [];
}

async function openGroupModal(page) {
  await page.goto('/flatmates');
  await expect(page.getByRole('button', { name: /^Post( Property)?$/ }).first()).toBeVisible({ timeout: 20_000 });
  await postAsGroup(page);
  await expect(page.getByPlaceholder(/2 girls/i)).toBeVisible({ timeout: 10_000 });
}

// `NativeSelect` uses a themed menu rather than a native `select`.
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

    // Assert generated structure so the source row, not fixture text, supplies BHK and locality.
    await expect(titleField(page)).toHaveValue(
      new RegExp(`1 more flatmate for a ${listing.bhk} BHK in ${listing.locality}`, 'i'),
    );
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
    // The positive price proves the empty rent field rejects a real sale value.
    expect(listing.price, 'the sale row should carry a price worth refusing').toBeGreaterThan(0);
    await expect(rentField(page)).toHaveValue('');
  });

  // Real mixed-status inventory ensures this picker filter has an actual row to exclude.
  test('a listing that has not passed moderation is not offered as proof of ownership', async ({ page }) => {
    const { accessToken } = await apiLogin(ACTORS.owner);
    const all = await myListings(accessToken);
    const unapproved = all.find((row) => row.status !== 'approved');
    expect(unapproved, 'the seeded owner needs a non-approved listing for this to mean anything').toBeTruthy();

    await signedInAs(page, ACTORS.owner);
    await openGroupModal(page);
    await page.getByRole('button', { name: /Flat owner/i }).click();
    await page.getByRole('button', { name: /Attach a verified property/i }).click();

    // An approved row anchors the absent unapproved option against an empty menu.
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

    // Resolve the tenancy property because its DTO carries an id but no locality.
    const flat = await (await fetch(`${API}/properties/${tenancy.propertyId}`)).json();
    expect(flat.locality, 'the tenancy flat needs a locality to derive from').toBeTruthy();

    await signedInAs(page, ACTORS.tenant);
    await openGroupModal(page);
    await page.getByRole('button', { name: /Prefill from your Draazy tenancy/i }).click();
    await page.getByRole('option', { name: flat.title, exact: true }).click();

    await expect(titleField(page)).toHaveValue(new RegExp(`^1 more flatmate in ${flat.locality}$`, 'i'));
    await expect(rentField(page)).toHaveValue(String(tenancy.rent));

    const ownerMobile = String(tenancy.owner?.mobile || '').replace(/\D/g, '').slice(-10);
    expect(ownerMobile, 'the tenancy should name the landlord').toHaveLength(10);
    await expect(page.getByPlaceholder(/seeking a replacement/i)).toHaveValue(ownerMobile);

    // Prefill enables consent but never substitutes for the owner's OTP.
    await expect(page.getByRole('button', { name: /Verify owner consent via OTP/i })).toBeEnabled();

    expect(errors, `console errors: ${errors.join('\n')}`).toHaveLength(0);
  });

  test('a tenant with no tenancy on record is not offered a prefill they cannot use', async ({ page }) => {
    await signedInAsNew(page);
    await openGroupModal(page);
    await expect(page.getByRole('button', { name: /Prefill from your Draazy tenancy/i })).toHaveCount(0);
    await expect(titleField(page)).toBeVisible();
  });
});
