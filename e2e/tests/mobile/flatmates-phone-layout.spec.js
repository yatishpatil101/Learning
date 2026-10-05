import { test, expect } from '@playwright/test';
import { API, apiLogin, authHeaders, uploadedListingPhotos, signedInAs, uniqueMobile } from '../../helpers/liveAuth.js';
import { ACTORS } from '../../fixtures/live.js';
import { approveListingWithFetch, rejectListingWithFetch } from '../../helpers/moderation.js';

/* Phone-only: the bottom-bar `+` that exists only below the desktop breakpoint, and the split
   modal's fit inside a narrow viewport. */

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const sheet = (page) => page.getByRole('dialog', { name: /What do you want to post/ });

async function api(method, path, headers, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* a 204 has no body */ }
  return { status: response.status, text, json };
}

const listingIds = [];

test.afterAll(async () => {
  for (const id of listingIds) {
    await rejectListingWithFetch(id, await authHeaders(ACTORS.admin), {
      reason: 'Zztest cleanup — synthetic phone-layout fixture',
    });
  }
});

test('the bottom-bar + opens the posting sheet from a route that is not /flatmates', async ({ page }) => {
  await page.goto('/listings');

  await page.getByRole('button', { name: /Post Property/i }).click();
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page).getByRole('button', { name: /I'm looking for a place/ })).toBeVisible();
});

test('the split modal fits the phone, keeps its confirm reachable and closes on Escape', async ({ page }) => {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);
  const listing = await api('POST', '/me/listings', auth(accessToken), {
    deal: 'rent',
    propertyType: 'Flat',
    price: 36000,
    city: 'Pune',
    bhk: 3,
    area: 1100,
    locality: 'Baner',
    title: `Zztest phone split ${Date.now().toString(36)}`,
    images: await uploadedListingPhotos(accessToken),
  });
  expect(listing.status, listing.text).toBe(201);
  listingIds.push(listing.json.id);
  const approved = await approveListingWithFetch(listing.json.id, await authHeaders(ACTORS.admin));
  expect(approved.status, approved.text).toBe(200);

  await signedInAs(page, mobile);
  await page.goto('/dashboard#properties');
  await expect(page.getByText('Zztest phone split').first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Let room by room', exact: true }).click();

  const modal = page.getByRole('dialog', { name: 'Let this flat room by room' });
  await expect(modal).toBeVisible();
  const viewportWidth = page.viewportSize().width;
  const box = await modal.boundingBox();
  expect(box.x, 'the modal must not hang off the left edge').toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, 'the modal must not hang off the right edge').toBeLessThanOrEqual(viewportWidth + 1);

  const rent = modal.locator('input[inputmode="numeric"]').first();
  await rent.fill('15000');
  await expect(rent).toHaveValue('15,000');
  const paint = await rent.evaluate((el) => {
    const s = getComputedStyle(el);
    return { color: s.color, background: s.backgroundColor };
  });
  expect(paint.color, 'the typed rent must not be painted in its own background colour')
    .not.toBe(paint.background);

  const digit = modal.getByRole('button', { name: '3', exact: true }).first();
  const offset = await digit.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const text = range.getBoundingClientRect();
    const buttonBox = el.getBoundingClientRect();
    return Math.abs((text.left + text.right) / 2 - (buttonBox.left + buttonBox.right) / 2);
  });
  expect(offset, 'the digit must sit in the middle of its box').toBeLessThan(2);

  const confirm = modal.getByRole('button', { name: /List \d+ rooms?/ });
  await confirm.scrollIntoViewIfNeeded();
  const confirmBox = await confirm.boundingBox();
  expect(confirmBox.x, 'the confirm button must not clip on the left').toBeGreaterThanOrEqual(0);
  expect(confirmBox.x + confirmBox.width, 'the confirm button must not clip on the right')
    .toBeLessThanOrEqual(viewportWidth + 1);

  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
});
