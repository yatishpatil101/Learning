import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, uploadedListingPhotos, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';
import { approveListing, rejectListing } from '../../../helpers/moderation.js';
import { openBadgeVault, uploadBadgeProof } from '../../../helpers/badgeVault.js';
import { PHOTO_PNG } from '../../../helpers/listingPhotos.helper.js';

const createdListingIds = new Set();
let actorSequence = 0;

async function api(method, path, headers, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function newActor(name, details = {}) {
  const base = uniqueMobile();
  const mobile = `${base.slice(0, -1)}${actorSequence++ % 10}`;
  const headers = await authHeaders(mobile);
  const updated = await api('PATCH', '/auth/me', headers, { name, ...details });
  expect(updated.status, `setting up ${name}`).toBe(200);
  return { mobile, headers, name, user: updated.body };
}

async function createApprovedListing(request, owner) {
  const created = await api('POST', '/me/listings', owner.headers, {
    title: `Zztest dashboard listing ${Date.now()}`,
    deal: 'rent',
    propertyType: 'Flat',
    price: 26000,
    city: 'Pune',
    locality: 'Baner',
    flatNumber: 'D-904',
    society: 'Dashboard Verify Homes',
    pincode: '411045',
    propLat: 18.559,
    propLng: 73.776,
    bhk: 2,
    area: 850,
    images: await uploadedListingPhotos(owner.headers),
  });
  expect(created.status, 'creating the dashboard listing').toBe(201);
  createdListingIds.add(created.body.id);

  const approved = await approveListing(request, created.body.id, await authHeaders(ACTORS.admin));
  expect(approved.status(), await approved.text()).toBe(200);
  return created.body.id;
}

test.afterEach(async ({ request }) => {
  const adminHeaders = await authHeaders(ACTORS.admin);
  for (const id of createdListingIds) {
    const rejected = await rejectListing(request, id, adminHeaders, { reasonCode: 'other', reason: 'Zztest cleanup - dashboard fixture' });
    expect(rejected.status(), await rejected.text()).toBe(200);
  }
  createdListingIds.clear();
});

test('the overview shows the optional Verified badge nudge before profile completion', async ({ page }) => {
  const seeker = await newActor(`Zztest Dashboard Seeker ${Date.now()}`, {
    email: `dashboard-${Date.now()}@example.test`,
    city: 'Pune',
  });

  await signedInAs(page, seeker.mobile);
  await page.goto('/dashboard');

  await expect(page.getByTestId('action-center-clear')).toBeVisible();
  await expect(page.getByTestId('verify-badge-cta')).toBeVisible();
  await expect(page.getByTestId('verify-badge-cta')).toContainText(/optional/i);
  await expect(page.getByTestId('profile-meter')).toHaveCount(0);
});

// Ownership evidence is optional at posting time, so an owner who skipped it needs a way back to it.
test('an owner with an approved listing gets Requests navigation and a Verified property badge CTA that opens that listing in the document vault', async ({ page, request }) => {
  const owner = await newActor(`Zztest Dashboard Verify ${Date.now()}`);
  await createApprovedListing(request, owner);

  await signedInAs(page, owner.mobile);
  const listingsRead = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/me/dashboard'
    && response.request().method() === 'GET'
    && response.status() === 200,
  );
  await page.goto('/dashboard');
  await listingsRead;

  await expect(page.getByTestId('action-center-clear')).toBeVisible();
  await expect(page.locator('aside button', { hasText: 'Requests' }).first()).toBeVisible();

  await page.goto('/dashboard#listings');
  const verify = page.getByRole('link', { name: 'Get Verified property badge' }).first();
  await expect(verify).toBeVisible();
  await verify.click();

  await expect(page).toHaveURL(/\/dashboard\?tab=documents&prop=.+/);
  const card = page.getByTestId('badge-request-card');
  await expect(card).toBeVisible();
  await expect(card.getByTestId('badge-state')).toHaveText('Not requested');
  await expect(card.getByTestId('request-badge')).toBeDisabled();
});

test('the vault badge request goes under review, and a staff decline comes back with its reason', async ({ page, request }) => {
  const owner = await newActor(`Zztest Dashboard Badge ${Date.now()}`);
  const listingId = await createApprovedListing(request, owner);

  await signedInAs(page, owner.mobile);
  const card = await openBadgeVault(page, listingId);
  await expect(card).toHaveAttribute('data-state', 'none');
  await uploadBadgeProof(page, card, 'Electricity Bill', { name: 'bill.png', mimeType: 'image/png', buffer: PHOTO_PNG });
  await card.getByTestId('request-badge').click();
  await expect(card.getByTestId('badge-state')).toHaveText('Under review');

  const asked = await api('GET', `/me/listings/${listingId}`, owner.headers);
  expect(asked.body.ownershipRequestedAt, 'the request reached the server').toBeTruthy();
  expect(asked.body.recheckReason).toBe('Ownership documents');

  await page.goto('/dashboard#listings');
  await expect(page.getByTestId('badge-under-review').first()).toBeVisible();

  const reason = 'The bill is for a different flat';
  const declined = await api('POST', `/properties/${listingId}/verification/ownership/decline`,
    await authHeaders(ACTORS.admin), { reason });
  expect(declined.status).toBe(200);

  await page.reload();
  await expect(page.getByTestId('badge-declined').first()).toBeVisible();
  const again = await openBadgeVault(page, listingId);
  await expect(again).toHaveAttribute('data-state', 'declined');
  await expect(again).toContainText(reason);
  await expect(again.getByTestId('request-badge'), 'the owner can ask again once a paper is filed').toBeEnabled();
});

test('on a phone the identity banner and listing status card leave no dead rows', async ({ page, request }) => {
  const owner = await newActor(`Zztest Dashboard Banner ${Date.now()}`);
  await createApprovedListing(request, owner);
  await page.setViewportSize({ width: 440, height: 956 });

  await signedInAs(page, owner.mobile);
  await page.goto('/dashboard#properties');
  const banner = page.getByTestId('verify-listings-banner');
  await expect(banner).toContainText('Verify your identity to rank all your listings higher');

  const box = await banner.boundingBox();
  const cta = await banner.getByRole('button', { name: 'Verify identity' }).boundingBox();
  const dismiss = await banner.getByRole('button', { name: 'Dismiss' }).boundingBox();
  const headline = await banner.getByText('Verify your identity to rank all your listings higher').boundingBox();
  expect(cta.width, 'the CTA fills the row instead of leaving a gap beside it').toBeGreaterThan(box.width * 0.85);
  expect(dismiss.y, 'dismiss sits on the headline row, not its own line').toBeLessThan(headline.y + headline.height);
  expect(dismiss.height).toBeGreaterThanOrEqual(44);

  await banner.getByRole('button', { name: 'Dismiss' }).click();
  await expect(banner).toHaveCount(0);

  const status = page.getByTestId('listing-status-card').first();
  const pill = await status.getByText('Live', { exact: true }).boundingBox();
  const line = await status.getByText('Buyers can now find and contact you.').boundingBox();
  const card = await status.boundingBox();
  const badge = await status.getByRole('link', { name: 'Get Verified property badge' }).boundingBox();
  expect(line.y, 'the status line shares the pill row').toBeLessThan(pill.y + pill.height);
  expect(badge.width, 'the badge CTA fills the row').toBeGreaterThan(card.width * 0.8);
});
