import { test, expect } from '../../fixtures/live.js';
import { API, authHeaders, identityChallengeToken, uniqueMobile } from '../../helpers/liveAuth.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAARElEQVR4AeyROw0AIAxEL5WADzSw4AcRaGLBDzqKg7uhS4c2eVOTy33snemMtrYzDMErASBBB/0OMNTKCSIoi+pfEYAPAAD//68o26gAAAAGSURBVAMAR8QwUeUtYucAAAAASUVORK5CYII=', 'base64');

const ROW_KEYS = ['id', 'status', 'userName', 'userMobile', 'docType', 'submittedAt', 'decidedAt', 'revokedAt',
  'approvedByName', 'claimedByName', 'claimedByMe', 'qaSampledAt'];
const REVIEW_PATH = /\/api\/moderation\/identity-reviews(\/[^/]+)?(\/claim)?$/;

async function submitPan(request) {
  const mobile = uniqueMobile();
  const headers = await authHeaders(mobile);
  const challenge = await identityChallengeToken(headers.authorization);
  const response = await request.post(`${API}/me/verification/identity`, {
    headers: { authorization: headers.authorization },
    multipart: {
      docType: 'pan',
      consent: 'true',
      challenge,
      liveness: 'passed',
      claims: JSON.stringify({ number: `EETAB${mobile.slice(-4)}F`, name: 'Payload Applicant', dob: '1990-01-01' }),
      front: { name: 'front.png', mimeType: 'image/png', buffer: PNG },
      selfie: { name: 'selfie.png', mimeType: 'image/png', buffer: PNG },
    },
  });
  expect(response.status()).toBe(202);
  return mobile;
}

test('the KYC desk lists slim rows; opening a case is one detail read and one slim claim; closing is a 204', async ({ page, login, request, consoleErrors }) => {
  const mobile = await submitPan(request);
  await login.asAdmin();

  const calls = [];
  page.on('response', async (res) => {
    const { pathname } = new URL(res.url());
    if (!REVIEW_PATH.test(pathname)) return;
    const body = res.status() === 204 ? null : await res.json().catch(() => null);
    calls.push({ method: res.request().method(), pathname, search: new URL(res.url()).search, status: res.status(), body });
  });

  await page.goto('/ops/kyc-review');
  await page.getByPlaceholder('Name or mobile').fill(mobile);
  await expect.poll(() => calls.some((c) => c.method === 'GET' && c.search.includes(mobile))).toBe(true);
  const row = page.getByRole('button', { name: new RegExp(mobile) });
  await expect(row).toBeVisible();

  const list = calls.filter((c) => c.method === 'GET' && c.pathname.endsWith('/identity-reviews') && c.search.includes(mobile) && c.body?.content?.length);
  expect(list.length).toBeGreaterThan(0);
  for (const r of list.at(-1).body.content) expect(Object.keys(r).filter((k) => !ROW_KEYS.includes(k))).toEqual([]);
  expect(JSON.stringify(list.at(-1).body)).not.toMatch(/accountEmail|holderDob|docLast4|claimedHash/);

  const before = calls.length;
  await row.click();
  await expect(page.getByLabel('Document number')).toBeVisible();
  await expect.poll(() => calls.slice(before).filter((c) => c.method === 'POST' && c.pathname.endsWith('/claim')).length).toBe(1);
  const opened = calls.slice(before);
  expect(opened.filter((c) => c.method === 'GET' && !c.pathname.endsWith('/summary') && !c.pathname.endsWith('/identity-reviews'))).toHaveLength(1);
  const claim = opened.find((c) => c.pathname.endsWith('/claim'));
  expect(claim.status).toBe(200);
  expect(Object.keys(claim.body).sort()).toEqual(['claimedByMe', 'claimedByName']);
  expect(claim.body.claimedByMe).toBe(true);

  const closedAt = calls.length;
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect.poll(() => calls.slice(closedAt).filter((c) => c.method === 'DELETE').length).toBe(1);
  expect(calls.slice(closedAt).find((c) => c.method === 'DELETE').status).toBe(204);
  expect(consoleErrors).toEqual([]);
});
