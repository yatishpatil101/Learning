import { test, expect } from '../../fixtures/live.js';
import { API, authHeaders, identityChallengeToken, uniqueMobile } from '../../helpers/liveAuth.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAARElEQVR4AeyROw0AIAxEL5WADzSw4AcRaGLBDzqKg7uhS4c2eVOTy33snemMtrYzDMErASBBB/0OMNTKCSIoi+pfEYAPAAD//68o26gAAAAGSURBVAMAR8QwUeUtYucAAAAASUVORK5CYII=', 'base64');
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

function verhoeffValid(digits) {
  let c = 0;
  for (let i = 0; i < digits.length; i += 1) {
    const digit = Number(digits[digits.length - 1 - i]);
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][digit]];
  }
  return c === 0;
}

function validAadhaar(body) {
  for (let digit = 0; digit <= 9; digit += 1) {
    const number = `${body}${digit}`;
    if (verhoeffValid(number)) return number;
  }
  throw new Error(`No Verhoeff digit completes ${body}`);
}

function defaultNumber(docType, mobile) {
  const suffix = mobile.slice(-7);
  if (docType === 'aadhaar') return validAadhaar(`2${mobile.slice(-10)}`);
  if (docType === 'passport') return `Z${suffix}`;
  if (docType === 'voter_id') return `ABC${suffix}`;
  return `EETAB${mobile.slice(-4)}F`;
}

async function submitCase(request, docType, claims) {
  const mobile = uniqueMobile();
  const headers = await authHeaders(mobile);
  const nextClaims = { ...claims, number: claims.number || defaultNumber(docType, mobile) };
  const challenge = await identityChallengeToken(headers.authorization);
  const response = await request.post(`${API}/me/verification/identity`, {
    headers: { authorization: headers.authorization },
    multipart: {
      docType,
      consent: 'true',
      challenge,
      liveness: 'passed',
      claims: JSON.stringify(nextClaims),
      front: { name: 'front.png', mimeType: 'image/png', buffer: PNG },
      ...(['aadhaar', 'voter_id'].includes(docType) ? { back: { name: 'back.png', mimeType: 'image/png', buffer: PNG } } : {}),
      selfie: { name: 'selfie.png', mimeType: 'image/png', buffer: PNG },
    },
  });
  expect(response.status()).toBe(202);
  return { mobile, headers, claims: nextClaims, row: new RegExp(`${mobile.slice(0, 2)}XXXXX${mobile.slice(-3)}`) };
}

async function openCase(page, owner, tab) {
  if (tab) await page.getByRole('tab', { name: tab }).click();
  await page.getByPlaceholder('Name or mobile').fill(owner.mobile);
  await page.getByRole('button', { name: owner.row }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

async function tickChecklist(page) {
  for (const box of await page.getByTestId('ops-identity-checklist').getByRole('checkbox').all()) await box.check();
}

async function pendingReview(request, owner) {
  const headers = await authHeaders('9000000000');
  const response = await request.get(`${API}/moderation/identity-reviews?status=pending&q=${owner.mobile}`, { headers: { authorization: headers.authorization } });
  expect(response.status()).toBe(200);
  const body = await response.json();
  const review = (body.content || body.items || []).find((item) => owner.row.test(item.userMobile || ''));
  expect(review).toBeTruthy();
  return { review, headers };
}

async function rejectPendingCase(request, owner) {
  const { review, headers } = await pendingReview(request, owner);
  const rejected = await request.post(`${API}/moderation/identity-reviews/${review.id}/reject`, {
    headers,
    data: { reason: 'other', note: 'Cleaning up read-only controls coverage.' },
  });
  expect(rejected.status()).toBe(200);
}

test('the admin sidebar KYC Review link opens the same queue, not a missing page', async ({ page, login }) => {
  await login.asAdmin();

  await page.goto('/admin');
  await page.getByRole('link', { name: 'KYC Review', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/kyc-review$/);
  await expect(page.getByRole('heading', { name: 'KYC Review', exact: true })).toBeVisible();
  await expect(page.getByText('Page not found')).toHaveCount(0);
});

test('ops can approve with year-only DOB and revoke a verified case', async ({ page, login, request }) => {
  const owner = await submitCase(request, 'aadhaar', { name: 'Asha Patil', dob: '1991-04-12' });
  await login.asAdmin();

  await page.goto('/ops/kyc-review');
  await expect(page.getByRole('heading', { name: 'KYC Review', exact: true })).toBeVisible();
  await openCase(page, owner);
  await expect(page.getByText('Not a masked or photocopied Aadhaar')).toBeVisible();
  await page.getByLabel('Document number').fill(owner.claims.number);
  await page.getByLabel('Holder name').fill('Asha Patil');
  await page.getByTestId('ops-identity-year-only').check();
  await page.getByTestId('ops-identity-birth-year').fill('1991');
  await page.getByTestId('ops-identity-pose-confirmed').check();
  await expect(page.getByTestId('ops-identity-approve')).toBeDisabled();
  await tickChecklist(page);

  const approved = page.waitForResponse((response) => response.request().method() === 'POST' && /\/moderation\/identity-reviews\/[^/]+\/approve$/.test(new URL(response.url()).pathname));
  await page.getByRole('button', { name: 'Approve review', exact: true }).click();
  const approval = await approved;
  expect(approval.status()).toBe(200);

  if ((await approval.json()).awaitingQa) {
    await expect(page.getByText('You approved this — another reviewer must check it.')).toBeVisible();
    await expect(page.getByTestId('ops-identity-revoke-confirm')).toHaveCount(0);
    return;
  }

  await page.getByTestId('ops-identity-revoke-reason').fill('Verified badge granted during e2e revoke coverage.');
  await page.getByRole('button', { name: 'Revoke badge', exact: true }).click();
  await expect(page.getByText('Confirm revocation.')).toBeVisible();
  const revoked = page.waitForResponse((response) => response.request().method() === 'POST' && /\/moderation\/identity-reviews\/[^/]+\/revoke$/.test(new URL(response.url()).pathname));
  await page.getByRole('button', { name: 'Confirm revoke', exact: true }).click();
  expect((await revoked).status()).toBe(200);
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  await page.getByRole('tab', { name: /^Decided/ }).click();
  await page.getByRole('button', { name: 'Revoked', exact: true }).click();
  await page.getByPlaceholder('Name or mobile').fill(owner.mobile);
  await expect(page.getByRole('button', { name: owner.row })).toBeVisible();

  const status = await request.get(`${API}/me/verification/identity`, { headers: { authorization: owner.headers.authorization } });
  expect(await status.json()).toMatchObject({ status: 'revoked' });
});

test('reject reasons use labels and enforce mandatory notes', async ({ page, login, request }) => {
  const owner = await submitCase(request, 'voter_id', { name: 'Vikram Sawant', dob: '1984-08-08' });
  await login.asAdmin();

  await page.goto('/ops/kyc-review');
  await openCase(page, owner);
  await expect(page.getByText('EPIC number on the front')).toBeVisible();
  await page.getByRole('tab', { name: 'Reject', exact: true }).click();
  await page.getByLabel('Reason').selectOption('mismatch');
  await expect(page.getByLabel('Reason')).toHaveValue('mismatch');
  await page.getByLabel('Note').fill('short');
  await expect(page.getByText('This reason needs a note of at least 10 characters.')).toBeVisible();
  await expect(page.getByTestId('ops-identity-reject')).toBeDisabled();
  await page.getByLabel('Note').fill('Document details do not match the submitted account.');

  const rejected = page.waitForResponse((response) => response.request().method() === 'POST' && /\/moderation\/identity-reviews\/[^/]+\/reject$/.test(new URL(response.url()).pathname));
  await page.getByRole('button', { name: 'Reject review', exact: true }).click();
  expect((await rejected).status()).toBe(200);
});

// Identity review is one back-office function (`kyc`): holding it grants viewing and deciding together,
// and no function grants either alone, so a view-only identity staffer no longer exists.
test('a staffer without the KYC function can neither view nor decide cases', async ({ page, login, request }) => {
  const owner = await submitCase(request, 'passport', { name: 'No Function Case', dob: '1990-01-01' });
  const { mobile } = await login.scopeStaff('rental', ['dashboard:read']);
  const staff = await authHeaders(mobile);

  const listed = await request.get(`${API}/moderation/identity-reviews?status=pending&q=${owner.mobile}`, { headers: { authorization: staff.authorization } });
  expect(listed.status()).toBe(403);
  const { review } = await pendingReview(request, owner);
  const rejected = await request.post(`${API}/moderation/identity-reviews/${review.id}/reject`, {
    headers: staff,
    data: { reason: 'other', note: 'A staffer without the KYC function must not be able to decide.' },
  });
  expect(rejected.status()).toBe(403);

  await login.asStaff('rental');
  await page.goto('/staff');
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'KYC Review' })).toHaveCount(0);
  await rejectPendingCase(request, owner);
});

test('a staffer holding the KYC function reviews cases and gets the decision controls', async ({ page, login, request }) => {
  const owner = await submitCase(request, 'passport', { name: 'Kyc Staff Case', dob: '1990-01-01' });
  await login.scopeStaff('rental', ['dashboard:read', 'identity:read']);
  await login.asStaff('rental');

  await page.goto('/staff/kyc-review');
  await openCase(page, owner);
  await expect(page.getByText('Passport is not expired')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Approve' })).toBeVisible();
  await expect(page.getByText('identity:write is required to decide it.')).toHaveCount(0);

  await page.getByRole('tab', { name: 'Reject', exact: true }).click();
  await page.getByLabel('Reason').selectOption('other');
  await page.getByLabel('Note').fill('Rejected by a staffer holding the KYC function.');
  const rejected = page.waitForResponse((response) => response.request().method() === 'POST' && /\/moderation\/identity-reviews\/[^/]+\/reject$/.test(new URL(response.url()).pathname));
  await page.getByRole('button', { name: 'Reject review', exact: true }).click();
  expect((await rejected).status()).toBe(200);
});

test('a decision already in flight cannot be sent twice, or reversed by the other button', async ({ page, login, request }) => {
  const owner = await submitCase(request, 'pan', { name: 'Nikhil Rao', dob: '1988-02-09' });
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
  await openCase(page, owner);
  await page.getByLabel('Document number').fill(owner.claims.number);
  await page.getByLabel('Holder name').fill('Nikhil Rao');
  await page.getByLabel('Date of birth').fill('1988-02-09');
  await page.getByTestId('ops-identity-pose-confirmed').check();
  await tickChecklist(page);

  // By testid, not by name: both buttons read "Saving…" while a decision is in flight, which is
  // the state under test, so an accessible-name locator is ambiguous exactly when it matters.
  const approve = page.getByTestId('ops-identity-approve');
  const rejectTab = page.getByRole('tab', { name: 'Reject', exact: true });
  const approved = page.waitForResponse((response) => /\/moderation\/identity-reviews\/[^/]+\/approve$/.test(new URL(response.url()).pathname));
  await approve.click();
  await expect(approve).toBeDisabled();
  await expect(rejectTab).toBeDisabled();
  // force, because a disabled button is exactly what a real impatient double-click hits; the
  // browser drops the event and React never runs onClick, which is the behaviour under test.
  await approve.click({ force: true });
  await rejectTab.click({ force: true });
  expect((await approved).status()).toBe(200);

  expect(approves).toBe(1);
  expect(rejects).toBe(0);
  // No 409 reached the screen, so no failure was reported for a decision that in fact succeeded.
  // Scoped to the testid, not to role=alert: this page mounts other live regions that never leave.
  await expect(page.getByTestId('ops-identity-decision-error')).toHaveCount(0);

  const status = await request.get(`${API}/me/verification/identity`, { headers: { authorization: owner.headers.authorization } });
  expect(await status.json()).toMatchObject({ status: 'verified' });
});
