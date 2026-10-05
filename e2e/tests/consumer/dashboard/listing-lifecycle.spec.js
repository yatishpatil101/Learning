import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, uploadedListingPhotos, signedInAs, uniqueMobile } from '../../../helpers/liveAuth.js';
import { approveListing, rejectListing } from '../../../helpers/moderation.js';

const createdListingIds = new Set();

async function api(method, path, headers, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function owner() {
  const mobile = uniqueMobile();
  const headers = await authHeaders(mobile);
  const updated = await api('PATCH', '/auth/me', headers, { name: `Zztest Lifecycle ${Date.now()}` });
  expect(updated.status).toBe(200);
  return { mobile, headers };
}

async function listing(request, headers, status = 'approved') {
  const created = await api('POST', '/me/listings', headers, {
    title: `Zztest lifecycle listing ${Date.now()}`,
    deal: 'rent',
    propertyType: 'Flat',
    price: 26000,
    city: 'Pune',
    locality: 'Baner',
    bhk: 2,
    area: 850,
    images: await uploadedListingPhotos(headers),
  });
  expect(created.status).toBe(201);
  createdListingIds.add(created.body.id);
  if (status !== 'pending') {
    const adminHeaders = await authHeaders(ACTORS.admin);
    const reviewed = status === 'approved'
      ? await approveListing(request, created.body.id, adminHeaders)
      : await api('PATCH', `/properties/${created.body.id}/status`, adminHeaders, { status });
    const reviewedStatus = typeof reviewed.status === 'function' ? reviewed.status() : reviewed.status;
    expect(reviewedStatus).toBe(200);
  }
  return created.body.id;
}

test.afterEach(async ({ request }) => {
  const adminHeaders = await authHeaders(ACTORS.admin);
  for (const id of createdListingIds) {
    await rejectListing(request, id, adminHeaders, { reasonCode: 'other' });
  }
  createdListingIds.clear();
});

test('owner can pause and resume an approved listing from My listings', async ({ page, request }) => {
  const me = await owner();
  await listing(request, me.headers);

  await signedInAs(page, me.mobile);
  await page.goto('/dashboard#listings');
  await expect(page.getByText('1 of 1 free listing used')).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByText('Paused', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();

  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByText('Live', { exact: true })).toBeVisible();
});

test('pending owner listing explains the 24 hour moderation SLA', async ({ page, request }) => {
  const me = await owner();
  await listing(request, me.headers, 'pending');

  await signedInAs(page, me.mobile);
  await page.goto('/dashboard#listings');

  await expect(page.getByText('Under review', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Our team usually reviews listings within 24 hours.')).toBeVisible();
  const tracker = page.getByTestId('progress-tracker');
  await expect(tracker).toHaveAttribute('data-track', 'owner');
  await expect(tracker).toHaveAttribute('data-step', 'submitted');
  await expect(tracker).toContainText('1/3');
});

test('a clarification request shows the owner the review is paused on them', async ({ page, request }) => {
  const me = await owner();
  const id = await listing(request, me.headers, 'pending');
  const admin = await authHeaders(ACTORS.admin);
  const started = await request.post(`${API}/properties/${id}/verification/start`, { headers: admin });
  expect(started.status(), await started.text()).toBe(200);
  const asked = await request.post(`${API}/properties/${id}/verification/decision`, {
    headers: admin,
    data: { decision: 'needs_info', reasonCode: 'other', note: 'Please confirm the floor.' },
  });
  expect(asked.status(), await asked.text()).toBe(200);

  await signedInAs(page, me.mobile);
  await page.goto('/dashboard#listings');

  const tracker = page.getByTestId('progress-tracker');
  await expect(tracker).toHaveAttribute('data-step', 'in_review');
  await expect(tracker).toHaveAttribute('data-blocked', 'needs_info');
  await expect(tracker).toContainText('Waiting on you');
});

test('a staff-posted listing waits for its owner to confirm it, and the tracker moves when they do', async ({ page }) => {
  const mobile = uniqueMobile();
  const title = `Zztest confirm listing ${Date.now()}`;
  const posted = await api('POST', '/admin/properties', await authHeaders(ACTORS.admin), {
    ownerMobile: mobile,
    ownerName: 'Zztest Confirm Owner',
    listing: { title, deal: 'rent', propertyType: 'Flat', price: 26000, city: 'Pune', locality: 'Baner', bhk: 2, area: 850 },
  });
  expect(posted.status).toBe(201);
  createdListingIds.add(posted.body.id);

  await signedInAs(page, mobile);
  await page.goto('/dashboard#listings');

  await expect(page.getByText('Confirm your listing', { exact: true }).first()).toBeVisible();
  const tracker = page.getByTestId('progress-tracker');
  await expect(tracker).toHaveAttribute('data-step', 'created');
  await expect(tracker).not.toContainText('Link sent');
  await expect(page.getByTestId('report-listing-wrong')).toBeVisible();

  await page.getByTestId('confirm-listing').click();
  await expect(tracker).toHaveAttribute('data-step', 'owner_confirmed');
  await expect(page.getByTestId('confirm-listing')).toHaveCount(0);
  await expect(page.getByText('Under review', { exact: true }).first()).toBeVisible();
});
