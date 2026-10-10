import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders, identityChallengeToken, signIn, uniqueMobile } from '../../helpers/liveAuth.js';
import { pickDate } from '../../helpers/datePicker.helper.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAARElEQVR4AeyROw0AIAxEL5WADzSw4AcRaGLBDzqKg7uhS4c2eVOTy33snemMtrYzDMErASBBB/0OMNTKCSIoi+pfEYAPAAD//68o26gAAAAGSURBVAMAR8QwUeUtYucAAAAASUVORK5CYII=', 'base64');
const MANAGER = ACTORS.manager;
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0],
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

async function submitCase(request, { docType = 'pan', claims, liveness = 'passed', accountName = claims.name }) {
  const mobile = uniqueMobile();
  const headers = await authHeaders(mobile);
  const nextClaims = { ...claims, number: claims.number || defaultNumber(docType, mobile) };
  const challenge = await identityChallengeToken(headers.authorization);
  const profile = await request.patch(`${API}/auth/me`, {
    headers,
    data: { name: accountName },
  });
  expect(profile.status()).toBe(200);
  const response = await request.post(`${API}/me/verification/identity`, {
    headers: { authorization: headers.authorization },
    multipart: {
      docType,
      consent: 'true',
      challenge,
      liveness,
      claims: JSON.stringify(nextClaims),
      front: { name: 'front.png', mimeType: 'image/png', buffer: PNG },
      ...(['aadhaar', 'voter_id'].includes(docType) ? { back: { name: 'back.png', mimeType: 'image/png', buffer: PNG } } : {}),
      selfie: { name: 'selfie.png', mimeType: 'image/png', buffer: PNG },
    },
  });
  expect(response.status()).toBe(202);
  return { mobile, headers, accountName, claims: nextClaims, row: new RegExp(mobile) };
}

async function findCase(page, owner, tab) {
  await page.goto('/ops/kyc-review');
  if (tab) await page.getByRole('tab', { name: tab }).click();
  await page.getByPlaceholder('Name or mobile').fill(owner.mobile);
  return page.getByRole('button', { name: owner.row });
}

async function tickChecklist(page) {
  for (const box of await page.getByTestId('ops-identity-checklist').getByRole('checkbox').all()) await box.check();
}

async function approveFromUi(page, owner, holderName = owner.claims.name) {
  await (await findCase(page, owner)).click();
  await expect(page.getByLabel('Document number')).toBeVisible();
  await page.getByLabel('Document number').fill(owner.claims.number);
  await page.getByLabel('Holder name').fill(holderName);
  if (owner.accountName && owner.accountName.trim().toLowerCase() !== holderName.trim().toLowerCase()) {
    await expect(page.getByText(`Account name: ${owner.accountName} → will become ${holderName}`)).toBeVisible();
  }
  await pickDate(page, '[aria-label="Date of birth"]:visible', owner.claims.dob);
  await page.getByTestId('ops-identity-pose-confirmed').check();
  await tickChecklist(page);
  const approved = page.waitForResponse((response) => response.request().method() === 'POST' && /\/moderation\/identity-reviews\/[^/]+\/approve$/.test(new URL(response.url()).pathname));
  await page.getByRole('button', { name: 'Approve review', exact: true }).click();
  expect((await approved).status()).toBe(200);
}

async function openQaCase(page, owner) {
  await (await findCase(page, owner, /^QA sample/)).click();
  await expect(page.getByRole('region', { name: 'QA check' })).toBeVisible();
}

const mockUser = (role = 'admin') => ({
  id: `${role}-reviewer`,
  name: role === 'admin' ? 'Admin Reviewer' : 'Staff Reviewer',
  role,
  permissions: ['identity:read', 'identity:write'],
});

const mockCase = (overrides = {}) => ({
  id: 'mock-review-1',
  userId: 'subject-1',
  userName: 'Mock Subject',
  userMobile: '97XXXXX001',
  userRole: 'owner',
  status: 'pending',
  docType: 'pan',
  claims: { number: '1234', name: 'Mock Subject', dob: '1990-01-01' },
  liveness: 'bypassed',
  submittedAt: Date.now() - 3600000,
  decidedAt: null,
  images: { front: 'data:image/png;base64,iVBORw0KGgo=', back: null, selfie: 'data:image/png;base64,iVBORw0KGgo=' },
  warnings: [],
  ...overrides,
});

async function openMockReview(page, { user = mockUser(), review = mockCase(), claimStatus = 200, afterForceRelease } = {}) {
  let current = { ...review };
  await page.addInitScript((signedInUser) => {
    localStorage.setItem('draazyUser', JSON.stringify(signedInUser));
    localStorage.setItem('draazyTokens', JSON.stringify({ accessToken: 'mock-token' }));
    localStorage.setItem('dz_cookie_consent_v1', JSON.stringify({ necessary: true, functional: true, analytics: false, marketing: false, version: 1, ts: Date.now() }));
  }, user);
  await page.route('**/api/auth/me', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) }));
  await page.route('**/api/moderation/identity-reviews**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const isDetail = /\/identity-reviews\/[^/?]+$/.test(url.pathname);
    const isClaim = /\/identity-reviews\/[^/]+\/claim$/.test(url.pathname);
    const isApprove = /\/identity-reviews\/[^/]+\/approve$/.test(url.pathname);
    const listedStatus = url.searchParams.get('status');
    if (method === 'GET' && url.pathname.endsWith('/identity-reviews/summary')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ pending: 1, overdue: 0, mine: 0, qa: 0, decided: 0 }) });
      return;
    }
    if (method === 'GET' && !isDetail) {
      const matches = listedStatus === current.status
        || (listedStatus === 'qa' && current.awaitingQa)
        || (listedStatus === 'decided' && current.status !== 'pending');
      const content = matches ? [current] : [];
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content, totalElements: content.length, number: 0, size: 50, totalPages: content.length ? 1 : 0 }) });
      return;
    }
    if (method === 'GET' && isDetail) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) });
      return;
    }
    if (method === 'POST' && isClaim) {
      if (claimStatus === 200) {
        current = { ...current, claimedByName: user.name, claimedByMe: true };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ claimedByName: user.name, claimedByMe: true }) });
        return;
      }
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'identity_case_claim_limit', message: 'claim limit' }) });
      return;
    }
    if (method === 'DELETE' && isClaim && url.searchParams.get('force') === 'true') {
      current = afterForceRelease || { ...current, claimedByName: null, claimedByMe: false, claimedAt: null };
      await route.fulfill({ status: 204 });
      return;
    }
    if (method === 'POST' && isApprove) {
      const body = JSON.parse(route.request().postData() || '{}');
      if (String(body.number || '') !== String(current.claims?.number || '') && !body.numberOverride) {
        await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'identity_number_mismatch', message: 'number mismatch' }) });
        return;
      }
      current = {
        ...current,
        status: 'verified',
        numberOverridden: Boolean(body.numberOverride),
        holderName: body.name,
        holderDob: body.dob || `${body.birthYear}-01-01`,
        approvedByName: user.name,
        reviewerName: user.name,
        decidedAt: Date.now(),
        qaSampledAt: null,
        awaitingQa: true,
      };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'not mocked' }) });
  });
  await page.goto('/ops/kyc-review');
}

test('mocked security UI labels client-reported liveness and omits absent QA fields', async ({ page }) => {
  await openMockReview(page, {
    review: mockCase({ status: 'verified', liveness: 'unavailable', reviewerName: 'Approver Name' }),
  });
  await page.getByRole('tab', { name: /^Decided/ }).click();
  await page.getByRole('button', { name: /97XXXXX001/ }).click();
  await expect(page.getByText('Client-reported: liveness unavailable — check selfie closely')).toBeVisible();
  await expect(page.getByText(/^QA:/)).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'QA check' })).toHaveCount(0);
});

test('mocked requested pose must be confirmed before approval', async ({ page }) => {
  await openMockReview(page, {
    review: mockCase({ livenessChallenge: 'left', livenessSource: 'challenge', liveness: 'passed', claimedByName: 'Admin Reviewer', claimedByMe: true }),
  });
  await page.getByRole('button', { name: /97XXXXX001/ }).click();
  await expect(page.getByText("Requested pose: Turned to their left (nose toward the photo's right edge)")).toBeVisible();
  await page.getByLabel('Document number').fill('1234');
  await page.getByLabel('Holder name').fill('Mock Subject');
  await pickDate(page, '[aria-label="Date of birth"]:visible', '1990-01-01');
  await tickChecklist(page);
  await expect(page.getByRole('button', { name: 'Approve review', exact: true })).toBeDisabled();
  await page.getByTestId('ops-identity-pose-confirmed').check();
  await expect(page.getByRole('button', { name: 'Approve review', exact: true })).toBeEnabled();
});

test('mocked number mismatch can be overridden and is shown in QA', async ({ page }) => {
  await openMockReview(page, {
    review: mockCase({ livenessChallenge: 'smile', livenessSource: 'challenge', liveness: 'passed', claimedByName: 'Admin Reviewer', claimedByMe: true }),
  });
  await page.getByRole('button', { name: /97XXXXX001/ }).click();
  await page.getByLabel('Document number').fill('EETAB9999F');
  await page.getByLabel('Holder name').fill('Mock Subject');
  await pickDate(page, '[aria-label="Date of birth"]:visible', '1990-01-01');
  await page.getByTestId('ops-identity-pose-confirmed').check();
  await tickChecklist(page);
  await page.getByRole('button', { name: 'Approve review', exact: true }).click();
  await expect(page.getByText("Your number doesn't match the applicant's entry. Re-check the image.")).toBeVisible();
  await page.getByLabel("I read it from the image — the applicant's entry was wrong").check();
  await page.getByRole('button', { name: 'Approve review', exact: true }).click();
  await expect(page.getByText('Number corrected by reviewer')).toBeVisible();
  await expect(page.getByText('You approved this — another reviewer must check it.')).toBeVisible();
});

test('mocked claim limit error is mapped from the backend code', async ({ page }) => {
  await openMockReview(page, { claimStatus: 409 });
  await page.getByRole('button', { name: /97XXXXX001/ }).click();
  await expect(page.getByText('You already hold 3 cases — release one first.')).toBeVisible();
});

test('mocked admin force release is admin-only and confirms before delete', async ({ browser }) => {
  const claimed = mockCase({ claimedByName: 'Other Reviewer', claimedByMe: false, claimedAt: Date.now() });
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await openMockReview(adminPage, { review: claimed });
  await adminPage.getByRole('button', { name: /97XXXXX001/ }).click();
  await expect(adminPage.getByText('Being reviewed by Other Reviewer')).toBeVisible();
  await expect(adminPage.getByRole('button', { name: 'Force release', exact: true })).toBeVisible();
  await adminPage.getByRole('button', { name: 'Force release', exact: true }).click();
  await expect(adminPage.getByText('Confirm force release.')).toBeVisible();
  await adminPage.getByRole('button', { name: 'Confirm force release', exact: true }).click();
  await expect(adminPage.getByRole('button', { name: 'Force release', exact: true })).toHaveCount(0);
  await adminContext.close();

  const staffContext = await browser.newContext();
  const staffPage = await staffContext.newPage();
  await openMockReview(staffPage, { user: mockUser('staff'), review: claimed });
  await staffPage.getByRole('button', { name: /97XXXXX001/ }).click();
  await expect(staffPage.getByText('Approve and reject are locked while another reviewer holds this case.')).toBeVisible();
  await expect(staffPage.getByRole('button', { name: 'Force release', exact: true })).toHaveCount(0);
  await staffContext.close();
});

test('claims lock a pending case for other reviewers and approval overwrites the account name', async ({ browser, request }) => {
  const owner = await submitCase(request, {
    claims: { name: 'Claimed Holder', dob: '1992-05-10' },
    accountName: 'Original Account Name',
  });

  const adminContext = await browser.newContext();
  const staffContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const staffPage = await staffContext.newPage();
  await signIn(adminPage, ACTORS.admin, { screen: 'staff', role: /Administrator/ });
  await signIn(staffPage, MANAGER, { screen: 'staff', role: /Manager/ });

  const adminClaim = adminPage.waitForResponse((response) => response.request().method() === 'POST' && /\/moderation\/identity-reviews\/[^/]+\/claim$/.test(new URL(response.url()).pathname));
  await (await findCase(adminPage, owner)).click();
  expect((await adminClaim).status()).toBe(200);
  await expect(adminPage.getByLabel('Document number')).toBeVisible();

  const staffClaimStatuses = [];
  staffPage.on('response', (response) => {
    if (response.request().method() === 'POST' && /\/moderation\/identity-reviews\/[^/]+\/claim$/.test(new URL(response.url()).pathname)) {
      staffClaimStatuses.push(response.status());
    }
  });
  const lockedRow = await findCase(staffPage, owner);
  await expect(lockedRow.getByText(/In review ·/)).toBeVisible();
  await lockedRow.click();
  await expect(staffPage.getByText(/Being reviewed by/)).toBeVisible();
  await expect(staffPage.getByText('Approve and reject are locked while another reviewer holds this case.')).toBeVisible();
  await expect(staffPage.getByRole('button', { name: 'Approve review', exact: true })).toHaveCount(0);
  await expect(staffPage.getByTestId('ops-identity-reject')).toHaveCount(0);
  await expect(staffPage.getByAltText('Front identity evidence')).toBeVisible();
  expect(staffClaimStatuses).toEqual([]);

  await adminPage.getByLabel('Document number').fill(owner.claims.number);
  await adminPage.getByLabel('Holder name').fill('Claimed Holder');
  await expect(adminPage.getByText('Account name: Original Account Name → will become Claimed Holder')).toBeVisible();
  await pickDate(adminPage, '[aria-label="Date of birth"]:visible', '1992-05-10');
  await adminPage.getByTestId('ops-identity-pose-confirmed').check();
  await tickChecklist(adminPage);
  const approved = adminPage.waitForResponse((response) => response.request().method() === 'POST' && /\/moderation\/identity-reviews\/[^/]+\/approve$/.test(new URL(response.url()).pathname));
  await adminPage.getByRole('button', { name: 'Approve review', exact: true }).click();
  expect((await approved).status()).toBe(200);

  const me = await request.get(`${API}/auth/me`, { headers: { authorization: owner.headers.authorization } });
  expect(me.status()).toBe(200);
  expect((await me.json()).name).toBe('Claimed Holder');

  await adminContext.close();
  await staffContext.close();
});

test('QA sampled approvals are hidden from the approver and can be confirmed by another reviewer', async ({ page, browser, login, request }) => {
  const owner = await submitCase(request, {
    claims: { name: 'Qa Confirm Holder', dob: '1990-03-11' },
    liveness: 'bypassed',
  });
  await login.asAdmin();
  await approveFromUi(page, owner);

  const qaQueue = page.waitForResponse((response) => response.request().method() === 'GET'
    && /\/moderation\/identity-reviews$/.test(new URL(response.url()).pathname)
    && new URL(response.url()).searchParams.get('status') === 'qa'
    && new URL(response.url()).searchParams.get('q') === owner.mobile);
  await findCase(page, owner, /^QA sample/);
  expect((await qaQueue).status()).toBe(200);
  await expect(page.getByText('No cases match these filters.')).toBeVisible();
  await expect(page.getByRole('button', { name: owner.row })).toHaveCount(0);

  const staffContext = await browser.newContext();
  const staffPage = await staffContext.newPage();
  await signIn(staffPage, MANAGER, { screen: 'staff', role: /Manager/ });
  await openQaCase(staffPage, owner);
  const confirmed = staffPage.waitForResponse((response) => response.request().method() === 'POST' && /\/moderation\/identity-reviews\/[^/]+\/qa$/.test(new URL(response.url()).pathname));
  await staffPage.getByRole('button', { name: 'Confirm', exact: true }).click();
  expect((await confirmed).status()).toBe(200);
  await expect(staffPage.getByRole('button', { name: owner.row })).toHaveCount(0);
  await staffContext.close();
});

test('QA reviewer can revoke a sampled approval with a reason', async ({ page, browser, login, request }) => {
  const owner = await submitCase(request, {
    claims: { name: 'Qa Revoke Holder', dob: '1989-09-09' },
    liveness: 'unavailable',
  });
  await login.asAdmin();
  await approveFromUi(page, owner);

  const staffContext = await browser.newContext();
  const staffPage = await staffContext.newPage();
  await signIn(staffPage, MANAGER, { screen: 'staff', role: /Manager/ });
  await openQaCase(staffPage, owner);
  await staffPage.getByTestId('ops-identity-qa-revoke-reason').fill('QA found that the selfie does not match the approved holder.');
  await staffPage.getByRole('button', { name: 'Revoke', exact: true }).click();
  await expect(staffPage.getByText('Confirm QA revocation.')).toBeVisible();
  const revoked = staffPage.waitForResponse((response) => response.request().method() === 'POST' && /\/moderation\/identity-reviews\/[^/]+\/qa$/.test(new URL(response.url()).pathname));
  await staffPage.getByRole('button', { name: 'Confirm revoke', exact: true }).click();
  expect((await revoked).status()).toBe(200);
  await expect(staffPage.getByRole('button', { name: owner.row })).toHaveCount(0);

  const status = await request.get(`${API}/me/verification/identity`, { headers: { authorization: owner.headers.authorization } });
  expect(status.status()).toBe(200);
  expect(await status.json()).toMatchObject({ status: 'revoked' });
  await staffContext.close();
});
