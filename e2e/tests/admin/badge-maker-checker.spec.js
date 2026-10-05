import { test, expect } from '../../fixtures/live.js';
import { API, authHeaders, signIn, uniqueMobile } from '../../helpers/liveAuth.js';

const SECOND_ADMIN_MOBILE = process.env.E2E_SECOND_ADMIN_MOBILE;

test.skip(!SECOND_ADMIN_MOBILE, 'Badge maker-checker needs an explicit second-admin fixture; seeded 9000000001 is now a manager.');

async function createConsumer(request, name) {
  const mobile = uniqueMobile();
  const headers = await authHeaders(mobile);
  const response = await request.patch(`${API}/auth/me`, {
    headers,
    data: { name },
  });
  expect(response.status()).toBe(200);
  return { mobile, name };
}

async function openUsers(page) {
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
  await expect(page.locator('table tbody tr').first()).toBeVisible();
}

async function findUser(page, name) {
  await page.getByPlaceholder('Search name, mobile, email…').fill(name);
  const row = page.locator('table').getByRole('row', { name: new RegExp(name) }).first();
  await expect(row).toBeVisible();
  return row;
}

async function requestBadge(page, name, reason) {
  const row = await findUser(page, name);
  await row.getByRole('button', { name: 'Grant Verified badge' }).click();
  await page.getByRole('textbox', { name: /Reason/ }).fill(reason);
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('Sent for approval by another admin')).toBeVisible();
  await expect(row.getByTestId('admin-user-pending-badge-pill')).toBeVisible();
}

async function signInSecondAdmin(page) {
  await page.context().clearCookies();
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await signIn(page, SECOND_ADMIN_MOBILE, { screen: 'staff', role: /Administrator/ });
}

test('admin A requests a badge and admin B approves it', async ({ page, login, request }) => {
  const target = await createConsumer(request, `Badge Maker ${Date.now()}`);
  await login.asAdmin();
  await openUsers(page);

  await requestBadge(page, target.name, 'Lease desk verified this profile manually.');
  const ownRequest = page.getByTestId('admin-badge-grant-row').filter({ hasText: target.name });
  await expect(ownRequest.getByText('Waiting for another admin')).toBeVisible();
  await expect(ownRequest.getByRole('button', { name: 'Approve' })).toHaveCount(0);

  await signInSecondAdmin(page);
  await openUsers(page);
  const approval = page.getByTestId('admin-badge-grant-row').filter({ hasText: target.name });
  await approval.getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('dialog', { name: 'Approve badge request' }).getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('Badge request approved')).toBeVisible();

  const row = await findUser(page, target.name);
  await expect(row.getByRole('button', { name: 'Remove Verified badge' })).toBeVisible();
});

test('badge rejection requires a reason', async ({ page, login, request }) => {
  const target = await createConsumer(request, `Badge Reject ${Date.now()}`);
  await login.asAdmin();
  await openUsers(page);
  await requestBadge(page, target.name, 'Profile checked during support escalation.');

  await signInSecondAdmin(page);
  await openUsers(page);
  const approval = page.getByTestId('admin-badge-grant-row').filter({ hasText: target.name });
  await approval.getByRole('button', { name: 'Reject' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reject badge request' });
  const reject = dialog.getByRole('button', { name: 'Reject', exact: true });
  await expect(reject).toBeDisabled();
  await expect(page.getByText('Reason must be 10–300 characters.')).toBeVisible();
  await dialog.getByRole('textbox', { name: /Reject reason/ }).fill('Manual check was not sufficient for this badge.');
  await expect(reject).toBeEnabled();
  await reject.click();
  await expect(page.getByText('Badge request rejected')).toBeVisible();
});
