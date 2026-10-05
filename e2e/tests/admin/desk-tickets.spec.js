/* Per-desk ticket consoles: an administrator opens a non-loans desk, switches to Customer tickets, and works
 * the customer tickets filed for that team; a desk staffer without `tickets:read` sees the desk alone. */
import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';
import { appReady } from '../../helpers/app.js';

const subject = () => `E2E desk tickets ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

async function raise(request, title, team = 'packers') {
  const res = await request.post(`${API}/tickets`, {
    headers: await authHeaders(ACTORS.tenant),
    data: { team, subject: title, body: 'Two-bedroom move, ground floor to third floor.' },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).id;
}

const tab = (page, name) => page.getByRole('tab', { name: new RegExp(`^${name}`) });

test('an administrator reaches the desk\'s tickets from the desk, and a deep link opens one', async ({ page, request, login }) => {
  test.slow();
  const title = subject();
  const id = await raise(request, title);

  await login.asAdmin();
  await page.goto('/admin/packers');
  await appReady(page);
  await expect(tab(page, 'To pick up')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, 'Customer tickets')).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByTestId('tab-count-tickets')).toHaveText(/^[\d,]+$/);

  await tab(page, 'Customer tickets').click();
  await expect(page).toHaveURL(/\/admin\/packers\?view=tickets$/);
  await expect(tab(page, 'Customer tickets')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Packers & Movers', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Status' })).toBeVisible();

  await page.getByPlaceholder(/^Search id, customer, detail/).fill(title);
  const row = page.getByTestId('queue-row').filter({ hasText: title });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('dialog').getByText(`Request ${id}`, { exact: true })).toBeVisible();

  await page.goto(`/admin/packers?view=tickets&open=${id}`);
  await expect(page.getByRole('dialog').getByText(`Request ${id}`, { exact: true })).toBeVisible();

  await page.goto('/admin/packers?view=tickets');
  await tab(page, 'To pick up').click();
  await expect(page).toHaveURL(/\/admin\/packers\?tab=pickup$/);
  await expect(tab(page, 'To pick up')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('group', { name: 'Status' })).toHaveCount(0);
});

test('the dashboard links a non-loans ticket to its desk\'s ticket console, opened on that ticket', async ({ page, request, login }) => {
  const id = await raise(request, subject());

  await login.asAdmin();
  await page.goto('/admin');
  await appReady(page);
  const link = page.locator(`a[href="/admin/packers?view=tickets&open=${id}"]`);
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/admin/packers\\?view=tickets&open=${id}$`));
  await expect(page.getByRole('dialog').getByText(`Request ${id}`, { exact: true })).toBeVisible();
});

test('a desk staffer scoped to the desk alone, without ticket access, gets the desk alone, with no Customer tickets tab', async ({ page, login }) => {
  await login.scopeStaff('packers', ['desk:packers']);
  await login.asStaff('packers');
  await page.goto('/staff/packers');
  await appReady(page);
  await expect(page.getByRole('heading', { name: 'Packers & Movers', exact: true })).toBeVisible();
  await expect(tab(page, 'To pick up')).toBeVisible();
  await expect(tab(page, 'Customer tickets')).toHaveCount(0);
});