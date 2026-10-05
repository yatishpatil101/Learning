import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, E2E_OTP, authHeaders, uploadedListingPhotos, seedConsent, uniqueMobile } from '../../../helpers/liveAuth.js';
import { approveListingWithFetch, rejectListingWithFetch } from '../../../helpers/moderation.js';

const WRONG_OTP = E2E_OTP === '111111' ? '222222' : '111111';
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
  expect(res.status, `naming ${name}`).toBe(200);
  return { mobile, headers, name };
}

async function fixture() {
  const owner = await actor('Zztest Inline OTP Owner');
  const res = await api('POST', '/me/listings', owner.headers, {
    title: `Zztest inline-otp ${Date.now()}`,
    deal: 'rent',
    propertyType: 'Flat',
    bhk: 2,
    price: 31000,
    area: 970,
    areaUnit: 'sqft',
    furnishing: 'semi-furnished',
    city: 'Pune',
    locality: 'Baner',
    address: 'D120 Inline OTP Residency, C-704',
    images: await uploadedListingPhotos(owner.headers),
  });
  expect(res.status, `creating listing (${JSON.stringify(res.body)})`).toBe(201);
  created.add(res.body.id);

  const admin = await authHeaders(ACTORS.admin);
  const appr = await approveListingWithFetch(res.body.id, admin);
  expect(appr.status, 'approving listing').toBe(200);
  return { owner, id: res.body.id };
}

async function openTheGate(buyer, owner, propertyId) {
  const req = await api('POST', '/contacts/request', buyer.headers, { propertyId });
  expect(req.status, `requesting contact (${JSON.stringify(req.body)})`).toBe(200);
  expect(req.body.status).toBe('pending');

  const inbox = await api('GET', '/me/contact-requests', owner.headers);
  expect(inbox.status, 'owner inbox').toBe(200);
  const row = (inbox.body?.content ?? []).find((r) => r.propertyId === propertyId);
  expect(row, 'contact request row').toBeTruthy();

  const grant = await api('PATCH', `/me/contact-requests/${row.id}`, owner.headers, { status: 'approved' });
  expect(grant.status, 'approving contact request').toBe(200);
}

async function openListing(page, id) {
  await seedConsent(page);
  await page.goto(`/property/${id}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.querySelectorAll('.reveal,.fade-up,.fade-in').forEach((el) => el.classList.add('visible')));
  await expect(page.getByRole('heading', { level: 1, name: '2 BHK Flat for Rent in Baner' })).toBeVisible({ timeout: 20000 });
}

async function openInlineOtp(page) {
  await page.getByRole('button', { name: /Contact Owner/i }).first().click();
  const sheet = page.getByRole('dialog', { name: /sign in to contact the owner/i });
  await expect(sheet).toBeVisible();
  return sheet;
}

async function sendOtp(sheet, mobile) {
  await sheet.getByLabel(/Mobile Number/i).fill(mobile);
  await sheet.getByRole('button', { name: /Send OTP/i }).click();
  await expect(sheet.getByLabel('OTP digit 1')).toBeVisible();
}

async function fillOtp(sheet, code) {
  for (let i = 0; i < 6; i++) {
    await sheet.getByLabel(`OTP digit ${i + 1}`).fill(code[i]);
  }
}

test.afterEach(async () => {
  const admin = await authHeaders(ACTORS.admin);
  for (const id of created) {
    await rejectListingWithFetch(id, admin, {
      reason: 'Zztest cleanup — inline OTP gate fixture',
    });
  }
  created.clear();
});

test.describe('Inline OTP contact gate', () => {
  test('signed-out Contact Owner opens inline OTP, rejects a wrong code, then resumes the modal on the same URL', async ({ page }) => {
    const { owner, id } = await fixture();
    const buyer = await actor('Zztest Inline OTP Buyer');
    await openTheGate(buyer, owner, id);
    await openListing(page, id);

    const before = page.url();
    const sheet = await openInlineOtp(page);
    await expect(page).toHaveURL(before);

    await sendOtp(sheet, buyer.mobile);
    await fillOtp(sheet, WRONG_OTP);
    await sheet.getByRole('button', { name: /Verify & Sign In/i }).click();
    await expect(sheet.locator('#inline-otp-status')).toHaveText(/That code isn't right\. 2 attempts? left/i);

    await fillOtp(sheet, E2E_OTP);
    await sheet.getByRole('button', { name: /Verify & Sign In/i }).click();

    await expect(page.getByRole('dialog', { name: /Contact the owner/i })).toBeVisible({ timeout: 20000 });
    await expect(page).toHaveURL(new RegExp(`/property/${id}`));
    await page.locator('.dz-modal').getByRole('button', { name: /Close/i }).click();
    await expect(page.getByRole('button', { name: /Request number/i })).toHaveCount(0);
    await expect(page.locator(`.dz-owner-rail a[href$="${owner.mobile.slice(-10)}"]`).first()).toBeVisible();
  });

  test('Back closes the inline OTP sheet without leaving the property page', async ({ page }) => {
    const { id } = await fixture();
    await openListing(page, id);

    await openInlineOtp(page);
    await page.goBack();

    await expect(page.getByRole('dialog', { name: /sign in to contact the owner/i })).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/property/${id}`));
  });

  test('mobile inline OTP keeps fields readable and the verify button reachable', async ({ page }) => {
    const { id } = await fixture();
    const buyer = await actor('Zztest Mobile Inline OTP Buyer');
    await page.setViewportSize({ width: 360, height: 640 });
    await openListing(page, id);

    const sheet = await openInlineOtp(page);
    const mobileInput = sheet.locator('#inline-otp-mobile');
    await expect(mobileInput).toBeVisible();
    const fontSize = await mobileInput.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(16);

    await sendOtp(sheet, buyer.mobile);
    await fillOtp(sheet, E2E_OTP);
    const verify = sheet.getByRole('button', { name: /Verify & Sign In/i });
    await expect(verify).toBeInViewport();
    const box = await verify.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44);
  });
});
