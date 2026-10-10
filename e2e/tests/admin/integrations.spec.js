import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders, uniqueMobile } from '../../helpers/liveAuth.js';

const requestOtp = (mobile) => fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ mobile }),
});

test('admin sees a card per provider and finds a masked OTP call by its full mobile', async ({ page, login, consoleErrors }) => {
  const mobile = uniqueMobile();
  expect((await requestOtp(mobile)).ok).toBe(true);

  await login.asAdmin();
  await page.goto('/admin/integrations');
  await expect(page.getByRole('heading', { name: 'Integrations' })).toBeVisible();

  for (const provider of ['zeptomail', 'whatsapp', 'cashfree']) {
    await expect(page.getByTestId(`provider-${provider}`)).toContainText(/Live|Mock/);
  }

  await page.getByRole('textbox', { name: 'Search calls' }).fill(mobile);
  const row = page.getByTestId('provider-call');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Login OTP');
  await expect(row).toContainText('Not sent');
  await expect(row).toContainText(mobile.slice(-3));
  await expect(row).not.toContainText(mobile);

  await page.getByRole('group', { name: 'Outcome' }).getByRole('button', { name: 'Failed' }).click();
  await expect(row).toHaveCount(0);
  await expect(page.getByText('No calls match.')).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test('a manager neither sees the integrations module nor reads its API', async ({ page, login }) => {
  const res = await fetch(`${API}/admin/integrations`, { headers: await authHeaders(ACTORS.manager) });
  expect(res.status).toBe(403);

  await login.asManager();
  await page.goto('/admin/integrations');
  await expect(page).toHaveURL(/\/admin\/?$/);
  await expect(page.getByRole('link', { name: 'Integrations' })).toHaveCount(0);
});
