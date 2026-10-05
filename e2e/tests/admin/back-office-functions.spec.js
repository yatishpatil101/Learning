import { test, expect, ACTORS, STAFF } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

const masked = (mobile) => {
  const digits = String(mobile).replace(/\D/g, '');
  return `${digits.slice(0, 2)}XXXXX${digits.slice(-3)}`;
};

async function staffId(mobile) {
  const res = await fetch(`${API}/users?role=staff&size=100`, { headers: await authHeaders(ACTORS.admin) });
  expect(res.status).toBe(200);
  const body = await res.json();
  const row = (body.content || body.items || []).find((u) => u.mobile === masked(mobile));
  expect(row, `staff account ${masked(mobile)} exists`).toBeTruthy();
  return row.id;
}

async function setFunctions(id, functions) {
  const res = await fetch(`${API}/users/${id}/permissions`, {
    method: 'PUT',
    headers: await authHeaders(ACTORS.admin),
    body: JSON.stringify({ functions }),
  });
  expect(res.status).toBe(200);
}

async function readFunctions(id) {
  const res = await fetch(`${API}/users/${id}/permissions`, { headers: await authHeaders(ACTORS.admin) });
  expect(res.status).toBe(200);
  return await res.json();
}

test.describe('back-office functions', () => {
  test('staff with KYC and rental functions sees both shared-console modules', async ({ page, login, consoleErrors }) => {
    const id = await staffId(STAFF.rental);
    const before = await readFunctions(id);
    await setFunctions(id, ['kyc', 'desk:rental']);
    try {
      await login.asStaff('rental');
      await page.goto('/admin');

      await expect(page.getByRole('link', { name: 'KYC Review', exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Rent Agreement', exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Services overview', exact: true })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Property Valuation', exact: true })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0);

      await page.getByRole('link', { name: 'KYC Review', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'KYC Review', exact: true })).toBeVisible();

      await page.goto('/admin/services');
      await expect(page).not.toHaveURL(/\/admin\/services/);
      await expect(page.getByRole('heading', { name: 'Service Requests', exact: true })).toHaveCount(0);
    } finally {
      await setFunctions(id, before.functions || before.permissions || []);
    }
    expect(consoleErrors).toHaveLength(0);
  });

  test('a scoped manager only sees held functions in the staff checklist', async ({ page, login, consoleErrors }) => {
    const manager = await fetch(`${API}/auth/me`, { headers: await authHeaders(ACTORS.manager) }).then((r) => r.json());
    const before = await readFunctions(manager.id);
    await setFunctions(manager.id, ['kyc']);
    try {
      await login.asManager();
      await page.goto('/admin/team');
      await page.getByRole('button', { name: /Add member/i }).click();

      await expect(page.getByRole('checkbox', { name: /KYC review/i })).toBeVisible();
      await expect(page.getByRole('checkbox', { name: /Rent Agreement/i })).toHaveCount(0);
    } finally {
      await setFunctions(manager.id, before.scoped ? (before.functions || before.permissions || []) : [
        'kyc', 'propertyVerification', 'listingModeration', 'postOnBehalf',
        'desk:rental', 'desk:legal', 'desk:loans', 'desk:interior', 'desk:packers', 'desk:valuation',
        'support', 'content', 'reports', 'analytics',
      ]);
    }
    expect(consoleErrors).toHaveLength(0);
  });

  test('a manager reads team performance', async ({ page, login, consoleErrors }) => {
    await login.asManager();
    await page.goto('/admin/team-performance');
    await expect(page.getByRole('heading', { name: 'Team Performance', exact: true })).toBeVisible();
    await expect(page.getByTestId('queues')).toBeVisible();
    await page.getByRole('button', { name: '30 days' }).click();
    await expect(page.getByText('Staff · last 30 days')).toBeVisible();
    expect(consoleErrors).toHaveLength(0);
  });

  test('staff get no team performance link', async ({ page, login, consoleErrors }) => {
    await login.asStaff('rental');
    await page.goto('/admin');
    await expect(page.getByRole('link', { name: 'Team Performance', exact: true })).toHaveCount(0);
    expect(consoleErrors).toHaveLength(0);
  });

  test('staff see only their own work and no analytics until granted', async ({ page, login, consoleErrors }) => {
    const id = await staffId(STAFF.rental);
    const before = await readFunctions(id);
    await setFunctions(id, ['kyc', 'desk:rental']);
    try {
      await login.asStaff('rental');
      await page.goto('/admin');

      await expect(page.getByTestId('my-functions')).toContainText('KYC review');
      await expect(page.getByTestId('my-functions')).toContainText('Rent Agreement');
      await expect(page.getByText(/happening across Draazy/)).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Analytics', exact: true })).toHaveCount(0);

      await page.goto('/admin/analytics');
      await expect(page).not.toHaveURL(/\/admin\/analytics/);

      await setFunctions(id, ['kyc', 'desk:rental', 'analytics']);
      await page.goto('/admin');
      await expect(page.getByRole('link', { name: 'Analytics', exact: true })).toBeVisible();
    } finally {
      await setFunctions(id, before.functions || before.permissions || []);
    }
    expect(consoleErrors).toHaveLength(0);
  });
});
