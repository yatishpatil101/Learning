import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';

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

async function createApprovedListing(owner) {
  const created = await api('POST', '/me/listings', owner.headers, {
    title: `Zztest dashboard listing ${Date.now()}`,
    deal: 'rent',
    propertyType: 'Flat',
    price: 26000,
    city: 'Pune',
    locality: 'Baner',
    bhk: 2,
    area: 850,
  });
  expect(created.status, 'creating the dashboard listing').toBe(201);
  createdListingIds.add(created.body.id);

  const approved = await api('PATCH', `/properties/${created.body.id}/status`, await authHeaders(ACTORS.admin), {
    status: 'approved',
  });
  expect(approved.status, 'approving the dashboard listing').toBe(200);
}

test.afterEach(async () => {
  const adminHeaders = await authHeaders(ACTORS.admin);
  for (const id of createdListingIds) {
    const rejected = await api('PATCH', `/properties/${id}/status`, adminHeaders, {
      status: 'rejected',
      reason: 'Zztest cleanup - dashboard fixture',
    });
    expect(rejected.status, `cleaning up isolated listing ${id}`).toBe(200);
  }
  createdListingIds.clear();
});

test('the profile completion meter reflects the authenticated server profile, not browser defaults', async ({ page }) => {
  const seeker = await newActor(`Zztest Dashboard Seeker ${Date.now()}`, {
    email: `dashboard-${Date.now()}@example.test`,
    city: 'Pune',
  });

  await signedInAs(page, seeker.mobile);
  await page.goto('/dashboard');

  await expect(page.getByTestId('action-center-clear')).toBeVisible();
  const meter = page.getByTestId('profile-meter');
  await expect(meter).toBeVisible();
  await expect(meter.getByRole('progressbar', { name: 'Profile completion' })).toHaveAttribute('aria-valuenow', '75');
  await expect(meter).toContainText('Verify your identity with Aadhaar');
});

test('a real approved listing unlocks owner-only Requests navigation', async ({ page }) => {
  const owner = await newActor(`Zztest Dashboard Owner ${Date.now()}`);
  await createApprovedListing(owner);

  await signedInAs(page, owner.mobile);
  const listingsRead = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/me/listings'
    && response.request().method() === 'GET'
    && response.status() === 200,
  );
  await page.goto('/dashboard');
  await listingsRead;

  await expect(page.getByTestId('action-center-clear')).toBeVisible();
  await expect(page.locator('aside button', { hasText: 'Requests' }).first()).toBeVisible();
});
