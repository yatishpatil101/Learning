import { expect, test } from '../../fixtures/live.js';
import { API, E2E_OTP, apiLogin, uniqueMobile } from '../../helpers/liveAuth.js';
import { tenantRoomAgreement } from '../../helpers/flatmateAgreement.js';
import { withSocietyId } from '../../helpers/liveSociety.js';

const REVIEW_KEYS = ['id', 'kind', 'roomId', 'groupId', 'host', 'address', 'tier', 'flagForReview', 'ownerConsent', 'createdAt'];
const QUEUE_KEYS = ['id', 'kind', 'modStatus', 'authorName', 'headline', 'locality', 'freeText', 'photoCount',
  'recheckReason', 'recheckRequestedAt', 'createdAt'];
const DESK = /\/api\/admin\/(flatmate-reviews|flatmates\/moderation(\/summary)?|flatmates\/[^/]+)$/;

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

async function post(path, token, body) {
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: auth(token), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function seedTenantRoom(host, society) {
  const { accessToken } = await apiLogin(host.mobile);
  const ownerMobile = uniqueMobile();
  for (const payload of [{ ownerMobile, society, locality: 'Kothrud' },
    { ownerMobile, society, locality: 'Kothrud', otp: E2E_OTP }]) {
    await post('/flatmates/owner-consent', accessToken, payload);
  }
  return post('/flatmates/rooms', accessToken, {
    bhk: '2',
    roomType: 'Private room',
    attachedBath: 'attached',
    furnishing: 'semi',
    locality: 'Kothrud',
    ...(await withSocietyId(accessToken, { society })),
    rentShare: 15000,
    deposit: 30000,
    availableFrom: '2026-12-01',
    lookingFor: 'any',
    foodPref: 'any',
    photos: ['https://cdn.example/1.jpg', 'https://cdn.example/2.jpg'],
    note: 'Quiet building, sunny room.',
    hostRole: 'tenant',
    ...(await tenantRoomAgreement(accessToken)),
    ownerConsentMobile: ownerMobile,
  });
}

test('the flatmate desk reads slim cards and true tab counts; the popup alone reads the agreement and mobile', async ({ page, login, consoleErrors }) => {
  const host = { mobile: uniqueMobile(), name: 'Payload Host' };
  const society = `Payload Heights ${Date.now().toString(36).slice(-5)}`;
  const room = await seedTenantRoom(host, society);
  await login.asStaff('rental');

  const calls = [];
  page.on('response', async (res) => {
    const { pathname } = new URL(res.url());
    if (res.request().method() !== 'GET' || !DESK.test(pathname)) return;
    calls.push({ pathname, url: res.url(), body: await res.json().catch(() => null) });
  });

  await page.goto('/ops/flatmate-review');
  await expect(page.getByTestId('flatmate-queue-card').filter({ hasText: society }).first()).toBeVisible();

  const reviews = calls.find((c) => c.pathname.endsWith('/flatmate-reviews'));
  expect(reviews.body.content.length).toBeGreaterThan(0);
  for (const row of reviews.body.content) expect(Object.keys(row).filter((k) => !REVIEW_KEYS.includes(k))).toEqual([]);
  expect(JSON.stringify(reviews.body)).not.toMatch(/agreementDoc|dataUrl|hostMobile|agreementValidTill/);

  const queue = calls.find((c) => c.pathname.endsWith('/flatmates/moderation'));
  expect(queue.body.content.length).toBeLessThanOrEqual(100);
  for (const row of queue.body.content) expect(Object.keys(row).filter((k) => !QUEUE_KEYS.includes(k))).toEqual([]);
  expect(queue.body.content.find((r) => r.id === room.id).photoCount).toBe(2);

  const summaries = calls.filter((c) => c.pathname.endsWith('/moderation/summary'));
  expect(summaries).toHaveLength(1);
  await expect(page.getByTestId('fm-count-pending')).toHaveText(String(summaries[0].body.pending));
  await expect(page.getByTestId('fm-count-published')).toHaveText(String(summaries[0].body.published));

  const before = calls.length;
  await page.getByTestId('flatmate-queue-card').filter({ hasText: society }).first().getByRole('button', { name: 'Review' }).click();
  const dialog = page.getByRole('dialog', { name: /^Review / });
  await expect(dialog.locator('.flatmate-badge-section')).toContainText(host.mobile);
  await expect(dialog.locator('.view-agreement-btn')).toBeVisible();
  const opened = calls.slice(before);
  expect(opened).toHaveLength(1);
  expect(opened[0].pathname).toContain(room.id);
  expect(opened[0].body.review.agreementDoc.dataUrl).toBeTruthy();
  expect(consoleErrors).toEqual([]);
});
