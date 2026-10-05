import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, signedInAs, uniqueMobile, uploadedListingPhotos } from '../../../helpers/liveAuth.js';
import { approveListingWithFetch, rejectListingWithFetch } from '../../../helpers/moderation.js';

const created = new Set();

const LISTING = {
  title: 'Zztest unavailable visit listing',
  deal: 'rent',
  propertyType: 'Flat',
  bhk: 2,
  price: 42000,
  locality: 'Baner',
  city: 'Pune',
  address: 'Zztest Unavailable Visit Residency, A-902',
  area: 940,
  areaUnit: 'sqft',
  furnishing: 'semi-furnished',
  description: 'Synthetic property detail fixture.',
};

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function owner() {
  const mobile = uniqueMobile();
  return { mobile, headers: await authHeaders(mobile) };
}

async function listing(fields = {}) {
  const me = await owner();
  const res = await api('POST', '/me/listings', me.headers, {
    ...LISTING,
    title: `Zztest unavailable visit ${Date.now().toString(36)}`,
    images: await uploadedListingPhotos(me.headers),
    ...fields,
  });
  expect(res.status, `POST /me/listings (${JSON.stringify(res.body)})`).toBe(201);
  created.add(res.body.id);
  return { owner: me, id: res.body.id };
}

async function setStatus(id, status) {
  const headers = await authHeaders(ACTORS.admin);
  const res = status === 'approved'
    ? await approveListingWithFetch(id, headers)
    : await rejectListingWithFetch(id, headers, { reason: 'Zztest live unavailable and visit fixture' });
  expect(res.status, `PATCH /properties/${id}/status`).toBe(200);
}

test.afterEach(async () => {
  if (!created.size) return;
  const headers = await authHeaders(ACTORS.admin);
  for (const id of created) {
    await rejectListingWithFetch(id, headers, { reason: 'Zztest cleanup' });
  }
  created.clear();
});

test.describe('LIVE — unavailable listings and visit leads', () => {
  test('a removed listing resolves as not found but keeps a browse recovery CTA', async ({ page }) => {
    const { id } = await listing();
    await setStatus(id, 'rejected');

    const detail404 = page.waitForResponse((res) =>
      new URL(res.url()).pathname === `/api/properties/${id}`
      && res.request().method() === 'GET'
      && res.status() === 404);
    await page.goto(`/property/${id}`);
    await detail404;

    await expect(page.getByRole('heading', { name: /property not found/i })).toBeVisible();
    await expect(page.getByText(/under review/i)).toHaveCount(0);
    await expect(page.getByRole('link', { name: /back to results/i })).toHaveAttribute('href', /\/listings$/);
  });

  test('the schedule visit modal posts only the account-scoped visit fields', async ({ page, flags }) => {
    await flags.enable('scheduleVisit');
    const { id } = await listing();
    await setStatus(id, 'approved');

    await signedInAs(page, uniqueMobile());
    await page.goto(`/property/${id}`);
    await page.getByRole('button', { name: /schedule a visit/i }).click();

    const dialog = page.getByRole('dialog', { name: /schedule a visit/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/full name/i)).toHaveCount(0);
    await expect(dialog.getByText(/mobile number/i)).toHaveCount(0);

    const request = page.waitForRequest((req) =>
      new URL(req.url()).pathname === '/api/visits'
      && req.method() === 'POST');
    await dialog.getByRole('button', { name: /confirm visit/i }).click();
    const payload = JSON.parse((await request).postData() || '{}');

    expect(payload.propertyId).toBe(id);
    expect(payload.slot).toBeTruthy();
    expect(payload.mode).toBe('in-person');
    expect(payload).not.toHaveProperty('visitorName');
    expect(payload).not.toHaveProperty('phone');
  });
});
