import { test, expect } from '@playwright/test';
import { API, apiLogin, authHeaders, signedInAs, uniqueMobile, uploadedListingPhotos } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { approveListingWithFetch, rejectListingWithFetch } from '../../../helpers/moderation.js';

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const created = [];

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, text };
}

async function ownerListingWithLead() {
  const ownerMobile = uniqueMobile();
  const owner = await apiLogin(ownerMobile);
  const images = await uploadedListingPhotos(owner);
  const title = `Zztest properties card ${Date.now().toString(36)}`;
  const listing = await api('POST', '/me/listings', auth(owner.accessToken), {
    title,
    deal: 'rent',
    propertyType: 'Flat',
    bhk: 2,
    price: 27000,
    area: 910,
    areaUnit: 'sqft',
    furnishing: 'semi-furnished',
    city: 'Pune',
    locality: 'Baner',
    address: 'D190 Slug Card Residency, A-901',
    images,
  });
  expect(listing.status, listing.text).toBe(201);
  created.push(listing.body.id);
  expect((await approveListingWithFetch(listing.body.id, await authHeaders(ACTORS.admin))).status).toBe(200);

  const buyer = await apiLogin(uniqueMobile());
  const asked = await api('POST', '/contacts/request', auth(buyer.accessToken), {
    propertyId: listing.body.id,
    message: 'Please share details for the card count regression.',
  });
  expect(asked.status, asked.text).toBe(200);
  expect(asked.body.status).toBe('pending');

  return { ownerMobile, title };
}

test.afterAll(async () => {
  const admin = await authHeaders(ACTORS.admin);
  for (const id of created) {
    await rejectListingWithFetch(id, admin, { reason: 'Zztest cleanup — my properties card' });
  }
});

test('owner property card shows every action inline on mobile and counts pending slugged-listing leads', async ({ page }) => {
  const { ownerMobile, title } = await ownerListingWithLead();
  await page.setViewportSize({ width: 390, height: 844 });
  await signedInAs(page, ownerMobile);
  await page.goto('/dashboard#properties');

  const card = page.locator('.rounded-xl', { hasText: title }).first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card.getByRole('button', { name: /^1 waiting$/ })).toBeVisible();

  await card.getByRole('button', { name: /^1 waiting$/ }).click();
  await expect(page).toHaveURL(/#leads$/);
  await page.goto('/dashboard#properties');
  await expect(card).toBeVisible({ timeout: 20_000 });

  const actionRow = card.locator('div.border-t', { has: page.getByRole('button', { name: /^1 waiting$/ }) }).last();
  await expect(actionRow.getByRole('link', { name: /^Edit$/ })).toBeVisible();
  await expect(actionRow.getByRole('link', { name: 'View listing' })).toBeVisible();
  await expect(actionRow.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await expect(actionRow.getByRole('button', { name: /More/i })).toHaveCount(0);
  await expect(actionRow.locator('a:visible, button:visible').last()).toHaveText('Take down');

  const heights = await actionRow.locator('a:visible, button:visible')
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
  expect(Math.min(...heights), 'every inline action is a thumb-sized target').toBeGreaterThanOrEqual(44);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, 'card must not create horizontal overflow at 390px').toBeLessThanOrEqual(1);
});

test.fixme('recheck reason is visible without hover when a clarification listing fixture is available', async () => {});
