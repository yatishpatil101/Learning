import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, signedInAs, uniqueMobile, uploadedListingPhotos } from '../../../helpers/liveAuth.js';
import { approveListingWithFetch, rejectListingWithFetch } from '../../../helpers/moderation.js';

const created = new Set();

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function actor(name) {
  const mobile = uniqueMobile();
  const headers = await authHeaders(mobile);
  const res = await api('PATCH', '/auth/me', headers, { name });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { mobile, headers, name };
}

async function approvedListing(owner) {
  const made = await api('POST', '/me/listings', owner.headers, {
    title: `Zztest review-visit ${Date.now()}`,
    deal: 'rent',
    propertyType: 'Flat',
    price: 24000,
    city: 'Pune',
    locality: 'Baner',
    bhk: 2,
    area: 900,
    images: await uploadedListingPhotos(owner.headers),
  });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  created.add(made.body.id);
  const approved = await approveListingWithFetch(made.body.id, await authHeaders(ACTORS.admin));
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  return { id: made.body.id, ref: made.body.slug || made.body.id };
}

async function openReviews(page, ref) {
  await page.goto(`/property/${ref}?tab=amenities`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.querySelectorAll('.reveal,.fade-up,.fade-in').forEach((el) => el.classList.add('visible')));
  await expect(page.getByRole('heading', { name: /ratings/i })).toBeVisible({ timeout: 15_000 });
}

test.afterEach(async () => {
  const headers = await authHeaders(ACTORS.admin);
  for (const id of created) {
    await rejectListingWithFetch(id, headers, { reason: 'Zztest cleanup - review-visit fixture' });
  }
  created.clear();
});

test('a review needs a visit the owner marked completed, then posts and shows as Visited', async ({ page }) => {
  const owner = await actor('Zztest Review Landlord');
  const visitor = await actor('Zztest Review Visitor');
  const { id, ref } = await approvedListing(owner);

  const slot = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const booked = await api('POST', '/visits', visitor.headers, { propertyId: id, slot, mode: 'in-person' });
  expect(booked.status, JSON.stringify(booked.body)).toBe(201);

  const early = await api('POST', `/properties/${id}/reviews`, visitor.headers, { rating: 5, text: 'Too early', categories: {} });
  expect(early.status, 'a booked visit is not standing to review').toBeGreaterThanOrEqual(400);

  await signedInAs(page, visitor.mobile);
  await openReviews(page, ref);
  await page.getByRole('button', { name: 'Rate this property' }).click();
  await expect(page.getByText(/Your visit is booked\. Once the owner confirms you visited/)).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Rate this property' })).toHaveCount(0);

  for (const next of ['confirmed', 'completed']) {
    const moved = await api('PATCH', `/visit-requests/${booked.body.id}/status`, owner.headers, { status: next });
    expect(moved.status, `owner moves the visit to ${next}: ${JSON.stringify(moved.body)}`).toBe(200);
  }

  await openReviews(page, ref);
  await expect(page.getByTestId('tenancy-declare')).toHaveCount(0);
  await page.getByRole('button', { name: 'Rate this property' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rate this property' });
  await expect(dialog).toBeVisible();

  const submit = dialog.getByRole('button', { name: 'Submit review' });
  await expect(submit, 'no overall rating, nothing to submit').toBeDisabled();
  await dialog.getByRole('button', { name: '4 star', exact: true }).click();
  await dialog.getByRole('button', { name: '5 star for Locality' }).click();
  await dialog.getByPlaceholder('What stood out — good or bad?').fill('Exactly as listed; the owner was on time.');
  await dialog.getByRole('button', { name: 'Yes', exact: true }).click();

  const posted = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes(`/properties/${id}/reviews`));
  await submit.click();
  expect((await posted).status()).toBe(201);
  await expect(page.getByText('Thanks! Your review has been posted.')).toBeVisible();
  await expect(dialog).toHaveCount(0);

  const card = page.locator('div.rounded-2xl').filter({ hasText: 'Exactly as listed; the owner was on time.' });
  await expect(card).toBeVisible();
  await expect(card.getByText('Visited', { exact: true })).toBeVisible();

  const read = await api('GET', `/properties/${id}/reviews`, visitor.headers);
  expect(read.status).toBe(200);
  expect(read.body.content).toHaveLength(1);
  expect(read.body.content[0]).toMatchObject({ rating: 4, context: 'visit' });
  expect(read.body.summary.reviewCount).toBe(1);

  const again = await api('POST', `/properties/${id}/reviews`, visitor.headers, { rating: 1, text: 'Second go', categories: {} });
  expect(again.status, 'one review per reviewer per listing').toBe(409);
});

test('the owner of a listing is never offered the review composer, and the API refuses them', async ({ page }) => {
  const owner = await actor('Zztest Review Self Owner');
  const { id, ref } = await approvedListing(owner);

  await signedInAs(page, owner.mobile);
  await openReviews(page, ref);
  await expect(page.getByRole('button', { name: 'Rate this property' })).toHaveCount(0);

  const own = await api('POST', `/properties/${id}/reviews`, owner.headers, { rating: 5, text: 'Great', categories: {} });
  expect(own.status, 'an owner cannot review their own listing').toBeGreaterThanOrEqual(400);
});

test('someone who never visited is told to book a visit first', async ({ page }) => {
  const owner = await actor('Zztest Review Landlord Two');
  const stranger = await actor('Zztest Review Stranger');
  const { ref } = await approvedListing(owner);

  await signedInAs(page, stranger.mobile);
  await openReviews(page, ref);
  await page.getByRole('button', { name: 'Rate this property' }).click();
  await expect(page.getByText(/Book a visit first/)).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Rate this property' })).toHaveCount(0);
});
