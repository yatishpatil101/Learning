import { test, expect, ACTORS, STAFF } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

async function staffId(mobile) {
  const res = await fetch(`${API}/users?role=staff&q=${mobile}&size=5`, { headers: await authHeaders(ACTORS.admin) });
  expect(res.status).toBe(200);
  const body = await res.json();
  const row = (body.content || body.items || []).find((u) => u.mobile === `${mobile.slice(0, 2)}XXXXX${mobile.slice(-3)}`);
  expect(row, `staff account ${mobile} exists`).toBeTruthy();
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
      await expect(page.getByRole('link', { name: 'Property Valuation', exact: true })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Home Loans', exact: true })).toHaveCount(0);
      await expect(page.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0);

      await page.getByRole('link', { name: 'KYC Review', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'KYC Review', exact: true })).toBeVisible();

      await page.goto('/admin/home-loans');
      await expect(page).not.toHaveURL(/\/admin\/home-loans/);
      await expect(page.getByRole('heading', { name: 'Home Loans', exact: true })).toHaveCount(0);
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
        'kyc', 'propertyVerification', 'listingModeration', 'postOnBehalf', 'flatmates', 'localities', 'reviews',
        'desk:rental', 'desk:legal', 'desk:loans', 'desk:interior', 'desk:packers', 'desk:valuation',
        'support', 'enquiries', 'users', 'reports', 'referrals', 'content', 'societies', 'analytics',
      ]);
    }
    expect(consoleErrors).toHaveLength(0);
  });

  test('the add-member checklist offers every catalogue function', async ({ page, login, consoleErrors }) => {
    const res = await fetch(`${API}/admin/function-catalogue`, { headers: await authHeaders(ACTORS.admin) });
    expect(res.status).toBe(200);
    const catalogue = await res.json();
    expect(catalogue.map((f) => f.name)).toEqual(expect.arrayContaining(['flatmates', 'referrals', 'analytics']));

    await login.asAdmin();
    await page.goto('/admin/team');
    await page.getByRole('button', { name: /Add member/i }).click();
    for (const fn of catalogue) {
      await expect(page.getByRole('checkbox', { name: fn.label, exact: true })).toBeVisible();
    }
    expect(consoleErrors).toHaveLength(0);
  });

  test('a manager reads team performance on Team Activity', async ({ page, login, consoleErrors }) => {
    await login.asManager();
    await page.goto('/admin/staff-activity');
    await expect(page.getByRole('heading', { name: 'Team Activity', exact: true })).toBeVisible();
    await expect(page.getByTestId('queues')).toBeVisible();
    await page.getByRole('button', { name: '30 days' }).click();
    await expect(page.getByText('Staff · last 30 days')).toBeVisible();
    expect(consoleErrors).toHaveLength(0);
  });

  test('staff get no Team Activity link', async ({ page, login, consoleErrors }) => {
    await login.asStaff('rental');
    await page.goto('/admin');
    await expect(page.getByRole('link', { name: 'Team Activity', exact: true })).toHaveCount(0);
    expect(consoleErrors).toHaveLength(0);
  });

  test('flatmate moderation is its own function, separate from reports', async ({ page, login, consoleErrors }) => {
    const id = await staffId(STAFF.rental);
    const before = await readFunctions(id);
    await setFunctions(id, ['reports']);
    try {
      await login.asStaff('rental');
      await page.goto('/admin');
      await expect(page.getByRole('link', { name: 'Reports', exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Flatmates', exact: true })).toHaveCount(0);

      await setFunctions(id, ['flatmates']);
      await page.goto('/admin');
      await expect(page.getByRole('link', { name: 'Flatmates', exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Reports', exact: true })).toHaveCount(0);
    } finally {
      await setFunctions(id, before.functions || before.permissions || []);
    }
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
