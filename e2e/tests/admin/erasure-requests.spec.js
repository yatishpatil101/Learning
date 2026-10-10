import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders, uniqueMobile } from '../../helpers/liveAuth.js';

async function fileRequest(reason) {
  const res = await fetch(`${API}/me/erasure`, {
    method: 'POST',
    headers: { ...(await authHeaders(uniqueMobile())), 'content-type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  expect(res.status).toBeLessThan(300);
}

test('admin finds a pending erasure request, must give a reason to reject it, and sees it under Rejected', async ({ page, login, consoleErrors }) => {
  const reason = `e2e erasure ${Date.now().toString(36)} <i>moving abroad</i>`;
  await fileRequest(reason);

  await login.asAdmin();
  await page.goto('/admin/erasure-requests');
  await expect(page.getByRole('heading', { name: 'Erasure requests' })).toBeVisible();

  const row = page.getByTestId('erasure-request').filter({ hasText: reason });
  await expect(row).toHaveCount(1);
  await expect(row.locator('i')).toHaveCount(0);

  await row.getByRole('button', { name: 'Reject' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Reject', exact: true })).toBeDisabled();
  await dialog.getByRole('textbox').fill('Identity could not be confirmed');
  await dialog.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(row).toHaveCount(0);

  await page.getByRole('group', { name: 'Status' }).getByRole('button', { name: 'Rejected' }).click();
  const decided = page.getByTestId('erasure-request').filter({ hasText: reason });
  await expect(decided).toHaveCount(1);
  await expect(decided).toContainText('Identity could not be confirmed');
  await expect(decided.getByRole('button', { name: 'Erase data' })).toHaveCount(0);

  expect(consoleErrors).toEqual([]);
});

test('erasing asks for confirmation that it cannot be undone before anything is sent', async ({ page, login }) => {
  const reason = `e2e erasure warn ${Date.now().toString(36)}`;
  await fileRequest(reason);

  await login.asAdmin();
  await page.goto('/admin/erasure-requests');
  const row = page.getByTestId('erasure-request').filter({ hasText: reason });
  await row.getByRole('button', { name: 'Erase data' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('cannot be undone');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(row).toHaveCount(1);
});

test('a manager neither sees erasure requests nor reads their API', async ({ page, login }) => {
  const res = await fetch(`${API}/admin/erasure-requests`, { headers: await authHeaders(ACTORS.manager) });
  expect(res.status).toBe(403);

  await login.asManager();
  await page.goto('/admin/erasure-requests');
  await expect(page).toHaveURL(/\/admin\/?$/);
  await expect(page.getByRole('link', { name: 'Erasure requests' })).toHaveCount(0);
});
