import { test, expect } from '../../fixtures/live.js';
import { pickDate } from '../../helpers/datePicker.helper.js';

test.use({ viewport: { width: 1440, height: 900 } });

const TOTAL = 23;
const SUMMARY = { pending: TOTAL, overdue: 4, mine: 1, qa: 2, decided: 40 };
const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const kycCase = (n, overrides = {}) => ({
  id: `case-${n}`,
  userId: `subject-${n}`,
  userName: `Applicant ${n}`,
  userMobile: `97XXXXX${String(n).padStart(3, '0')}`,
  userRole: 'owner',
  status: 'pending',
  docType: 'aadhaar',
  claims: { number: '1234', name: `Applicant ${n}`, dob: '1990-01-01' },
  liveness: 'passed',
  livenessSource: 'challenge',
  livenessChallenge: 'smile',
  submittedAt: new Date(Date.now() - (50 - n) * 3600000).toISOString(),
  images: { front: IMG, back: IMG, selfie: IMG },
  warnings: [],
  ...overrides,
});

async function mockDesk(page, login) {
  const lists = [];
  const released = [];
  await login.asAdmin();
  await page.route('**/api/moderation/identity-reviews**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const id = url.pathname.match(/\/identity-reviews\/(case-\d+)/)?.[1];
    if (url.pathname.endsWith('/summary')) return route.fulfill({ json: SUMMARY });
    if (method === 'GET' && !id) {
      lists.push(Object.fromEntries(url.searchParams));
      const page0 = Number(url.searchParams.get('page'));
      const size = Number(url.searchParams.get('size'));
      const content = Array.from({ length: Math.max(0, Math.min(size, TOTAL - page0 * size)) }, (_, i) => kycCase(page0 * size + i + 1));
      return route.fulfill({ json: { content, totalElements: TOTAL, totalPages: Math.ceil(TOTAL / size), number: page0, size } });
    }
    const n = Number(id.split('-')[1]);
    const row = (overrides) => kycCase(n, { attemptCount: 2, rejectionReason: 'blurry', rejectionNote: 'Earlier attempt was blurry.', ...overrides });
    if (method === 'POST' && url.pathname.endsWith('/claim')) return route.fulfill({ json: row({ claimedByName: 'Admin', claimedByMe: true }) });
    if (method === 'DELETE') {
      released.push(id);
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ json: row() });
  });
  return { lists, released, last: () => lists[lists.length - 1] };
}

test('the queue shows 10 cases a page with the total, and pages on the server', async ({ page, login, consoleErrors }) => {
  const desk = await mockDesk(page, login);
  await page.goto('/admin/kyc-review');

  await expect(page.getByTestId('kyc-row')).toHaveCount(10);
  await expect(page.getByTestId('queue-range').first()).toHaveText('1–10 of 23');
  await expect(page.getByTestId('kyc-count-needs')).toHaveText('23');
  await expect(page.getByTestId('kyc-count-qa')).toHaveText('2');
  await expect(page.getByTestId('kyc-count-decided')).toHaveText('40');
  expect(desk.last()).toMatchObject({ status: 'pending', page: '0', size: '10', sort: 'oldest' });

  await page.getByRole('button', { name: 'Next page' }).first().click();
  await expect(page.getByTestId('queue-range').first()).toHaveText('11–20 of 23');
  expect(desk.last()).toMatchObject({ page: '1', size: '10' });
  await expect(page.getByRole('button', { name: /Applicant 11\b/ })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test('every filter is a server query, and each tab only sends its own', async ({ page, login, consoleErrors }) => {
  const desk = await mockDesk(page, login);
  await page.goto('/ops/kyc-review');
  await expect(page.getByTestId('kyc-row')).toHaveCount(10);

  await page.getByPlaceholder('Name or mobile').fill('Asha');
  await expect.poll(() => desk.last().q).toBe('Asha');

  const docType = page.getByRole('button', { name: 'Document type' });
  await docType.click();
  await page.locator('.dz-dropdown__option', { hasText: 'PAN' }).first().click();
  await expect.poll(() => desk.last().docType).toBe('pan');

  await page.getByRole('group', { name: 'Claim' }).getByRole('button', { name: 'Unclaimed' }).click();
  await expect.poll(() => desk.last().claim).toBe('unclaimed');
  await expect(page.getByRole('group', { name: 'Claim' }).getByRole('button', { name: 'Mine 1/3' })).toBeVisible();

  await page.getByRole('button', { name: /Overdue 4/ }).click();
  await expect.poll(() => desk.last().overdue).toBe('true');

  await page.getByRole('group', { name: 'Sort' }).getByRole('button', { name: 'Newest' }).click();
  await expect.poll(() => desk.last()).toMatchObject({ status: 'pending', q: 'Asha', docType: 'pan', claim: 'unclaimed', overdue: 'true', sort: 'newest', page: '0' });

  await page.getByRole('tab', { name: /^Decided/ }).click();
  await expect.poll(() => desk.last().status).toBe('decided');
  expect(desk.last()).toMatchObject({ sort: 'newest' });
  expect(desk.last()).not.toHaveProperty('claim');
  expect(desk.last()).not.toHaveProperty('q');
  await page.getByRole('group', { name: 'Outcome' }).getByRole('button', { name: 'Revoked' }).click();
  await expect.poll(() => desk.last().outcome).toBe('revoked');

  await page.getByRole('tab', { name: /^QA sample/ }).click();
  await expect.poll(() => desk.last()).toMatchObject({ status: 'qa', sort: 'oldest' });
  expect(desk.last()).not.toHaveProperty('outcome');
  expect(consoleErrors).toEqual([]);
});

test('a case opens with evidence beside the fields, a checklist gating approve, and history collapsed', async ({ page, login, consoleErrors }) => {
  const desk = await mockDesk(page, login);
  await page.goto('/ops/kyc-review');
  await page.getByRole('button', { name: /97XXXXX001/ }).click();

  const dialog = page.getByRole('dialog', { name: 'Applicant 1' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByAltText('Front identity evidence')).toBeVisible();
  await expect(dialog.getByAltText('Back identity evidence')).toBeVisible();
  await expect(dialog.getByRole('region', { name: 'Liveness' }).getByAltText('Selfie identity evidence')).toBeVisible();
  await expect(dialog.getByText('Waiting 2d · overdue')).toBeVisible();

  const history = dialog.getByTestId('ops-identity-history');
  await expect(history).not.toHaveAttribute('open');
  await expect(history.getByText('Earlier attempt was blurry.', { exact: false })).toBeHidden();
  await history.locator('summary').click();
  await expect(history.getByText(/Blurry image — Earlier attempt was blurry\./)).toBeVisible();

  await dialog.getByLabel('Document number').fill('1234');
  await dialog.getByLabel('Holder name').fill('Applicant 1');
  await pickDate(dialog.page(), '[aria-label="Date of birth"]:visible', '1990-01-01');
  await dialog.getByTestId('ops-identity-pose-confirmed').check();
  const approve = dialog.getByTestId('ops-identity-approve');
  await expect(approve).toBeDisabled();
  await expect(dialog.getByTestId('ops-identity-approve-hint')).toHaveText('Tick 4 more checks to approve.');
  for (const box of await dialog.getByTestId('ops-identity-checklist').getByRole('checkbox').all()) await box.check();
  await expect(approve).toBeEnabled();

  await dialog.getByRole('button', { name: 'Next case' }).click();
  await expect(page.getByRole('dialog', { name: 'Applicant 2' })).toBeVisible();
  await expect.poll(() => desk.released).toEqual(['case-1']);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => desk.released).toEqual(['case-1', 'case-2']);
  expect(consoleErrors).toEqual([]);
});
