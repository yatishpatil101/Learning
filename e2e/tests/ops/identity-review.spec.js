import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders, uniqueMobile } from '../../helpers/liveAuth.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAARElEQVR4AeyROw0AIAxEL5WADzSw4AcRaGLBDzqKg7uhS4c2eVOTy33snemMtrYzDMErASBBB/0OMNTKCSIoi+pfEYAPAAD//68o26gAAAAGSURBVAMAR8QwUeUtYucAAAAASUVORK5CYII=', 'base64');

async function submitCase(request, docType, claims) {
  const mobile = uniqueMobile();
  const headers = await authHeaders(mobile);
  const response = await request.post(`${API}/me/verification/identity`, {
    headers: { authorization: headers.authorization },
    multipart: {
      docType,
      consent: 'true',
      claims: JSON.stringify(claims),
      front: { name: 'front.png', mimeType: 'image/png', buffer: PNG },
      ...(docType === 'pan' ? {} : { back: { name: 'back.png', mimeType: 'image/png', buffer: PNG } }),
      selfie: { name: 'selfie.png', mimeType: 'image/png', buffer: PNG },
    },
  });
  expect(response.status()).toBe(202);
  return { mobile, headers };
}

test('ops can review a pending case and approve it from /ops/kyc-review', async ({ page, login, request }) => {
  const owner = await submitCase(request, 'pan', { number: 'ABCDE1234F', name: 'Asha Patil', dob: '1991-04-12' });
  await login.asAdmin();

  await page.goto('/ops/kyc-review');
  await expect(page.getByRole('heading', { name: 'KYC Review', exact: true })).toBeVisible();
  await page.getByRole('button', { name: new RegExp(owner.mobile) }).click();
  await expect(page.getByText('OCR-derived fields')).toBeVisible();
  await expect(page.getByText('Asha Patil')).toBeVisible();
  await page.getByLabel('Document number').fill('ABCDE1234F');
  await page.getByLabel('Holder name').fill('Asha Patil');
  await page.getByLabel('Date of birth').fill('1991-04-12');
  const approved = page.waitForResponse((response) => response.request().method() === 'POST' && /\/moderation\/identity-reviews\/[^/]+\/approve$/.test(new URL(response.url()).pathname));
  await page.getByRole('button', { name: 'Approve review', exact: true }).click();
  expect((await approved).status()).toBe(200);
  await expect(page.getByText('No pending cases.')).toBeVisible();

  const status = await request.get(`${API}/me/verification/identity`, { headers: { authorization: owner.headers.authorization } });
  expect(status.status()).toBe(200);
  expect(await status.json()).toMatchObject({ status: 'verified', docLast4: '234F' });
});

test('ops can reject a case and the owner sees the retry budget', async ({ page, login, request }) => {
  const owner = await submitCase(request, 'aadhaar', { number: '983000000216', name: 'Asha Patil', dob: '1991-04-12' });
  await login.asAdmin();

  await page.goto('/ops/kyc-review');
  await page.getByRole('button', { name: new RegExp(owner.mobile) }).click();
  await page.getByLabel('Reason').selectOption('blurry');
  await page.getByLabel('Note').fill('Retake in daylight');
  const rejected = page.waitForResponse((response) => response.request().method() === 'POST' && /\/moderation\/identity-reviews\/[^/]+\/reject$/.test(new URL(response.url()).pathname));
  await page.getByRole('button', { name: 'Reject review', exact: true }).click();
  expect((await rejected).status()).toBe(200);
  await expect(page.getByText('No pending cases.')).toBeVisible();

  const status = await request.get(`${API}/me/verification/identity`, { headers: { authorization: owner.headers.authorization } });
  expect(status.status()).toBe(200);
  expect(await status.json()).toMatchObject({ status: 'rejected', rejectionNote: 'Retake in daylight', attemptsRemaining: 2 });
});

test('a decision already in flight cannot be sent twice, or reversed by the other button', async ({ page, login, request }) => {
  // A distinct PAN and holder: the first test approves ABCDE1234F, and an approved document is
  // registered to that person, so reusing it makes the submission itself a 409.
  const owner = await submitCase(request, 'pan', { number: 'BQRTY7788K', name: 'Nikhil Rao', dob: '1988-02-09' });
  await login.asAdmin();

  // The server locks the case during a decision, so a second click comes back 409. Holding the
  // response in flight reproduces the window; the request count proves the client refuses it.
  let approves = 0;
  await page.route('**/moderation/identity-reviews/*/approve', async (route) => {
    approves += 1;
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.continue();
  });
  let rejects = 0;
  await page.route('**/moderation/identity-reviews/*/reject', async (route) => {
    rejects += 1;
    await route.continue();
  });

  await page.goto('/ops/kyc-review');
  await page.getByRole('button', { name: new RegExp(owner.mobile) }).click();
  await page.getByLabel('Document number').fill('BQRTY7788K');
  await page.getByLabel('Holder name').fill('Nikhil Rao');
  await page.getByLabel('Date of birth').fill('1988-02-09');

  // By testid, not by name: both buttons read "Saving…" while a decision is in flight, which is
  // the state under test, so an accessible-name locator is ambiguous exactly when it matters.
  const approve = page.getByTestId('ops-identity-approve');
  const reject = page.getByTestId('ops-identity-reject');
  await approve.click();
  await expect(approve).toBeDisabled();
  // force, because a disabled button is exactly what a real impatient double-click hits; the
  // browser drops the event and React never runs onClick, which is the behaviour under test.
  await approve.click({ force: true });
  await reject.click({ force: true });

  await expect(page.getByText('No pending cases.')).toBeVisible();
  expect(approves).toBe(1);
  expect(rejects).toBe(0);
  // No 409 reached the screen, so no failure was reported for a decision that in fact succeeded.
  // Scoped to the testid, not to role=alert: this page mounts other live regions that never leave.
  await expect(page.getByTestId('ops-identity-decision-error')).toHaveCount(0);

  const status = await request.get(`${API}/me/verification/identity`, { headers: { authorization: owner.headers.authorization } });
  expect(await status.json()).toMatchObject({ status: 'verified' });
});
