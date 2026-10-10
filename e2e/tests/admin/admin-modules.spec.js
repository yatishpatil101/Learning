import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

// Every Admin Modules switch, flipped off through the API and asserted on screen, then back on.
// The settings document is shared, so each test restores what it touched in a `finally`.

const setAdminFlags = async (adminFlags) => {
  const res = await fetch(`${API}/admin/settings`, {
    method: 'PUT',
    headers: await authHeaders(ACTORS.admin),
    body: JSON.stringify({ adminFlags }),
  });
  expect(res.status, `could not write ${JSON.stringify(adminFlags)}`).toBe(200);
};

const sidebar = (page) => page.locator('aside nav');

const TAB_MODULES = [
  { key: 'analytics', path: '/admin/analytics' },
  { key: 'finance', path: '/admin/finance' },
  { key: 'reports', path: '/admin/reports' },
  { key: 'support', path: '/admin/support' },
];

for (const { key, path } of TAB_MODULES) {
  test(`tab.${key} hides the ${key} module from the sidebar and its route`, async ({ page, login }) => {
    await login.asAdmin();
    try {
      await setAdminFlags({ tab: { [key]: false } });
      await page.goto('/admin');
      await expect(sidebar(page).locator('a[href="/admin/properties"]')).toBeVisible();
      await expect(sidebar(page).locator(`a[href="${path}"]`)).toHaveCount(0);
      await page.goto(path);
      await expect(page).toHaveURL(/\/admin\/?$/);
    } finally {
      await setAdminFlags({ tab: { [key]: true } });
    }
    await page.goto('/admin');
    await expect(sidebar(page).locator(`a[href="${path}"]`)).toBeVisible();
  });
}

test('tab flags also hide a module from a manager sidebar', async ({ page, login }) => {
  await login.asManager();
  await expect(sidebar(page).locator('a[href="/admin/support"]')).toBeVisible();
  try {
    await setAdminFlags({ tab: { support: false } });
    await page.reload();
    await expect(sidebar(page).locator('a[href="/admin/properties"]')).toBeVisible();
    await expect(sidebar(page).locator('a[href="/admin/support"]')).toHaveCount(0);
  } finally {
    await setAdminFlags({ tab: { support: true } });
  }
});

const PAGE_MODULES = [
  { section: 'services', path: '/admin/home-loans', off: 'Services module is disabled.' },
  { section: 'content', path: '/admin/content', off: 'Content module is disabled.' },
];

for (const { section, path, off } of PAGE_MODULES) {
  test(`${section}.enabled swaps the page for a way back to Settings`, async ({ page, login }) => {
    await login.asAdmin();
    try {
      await setAdminFlags({ [section]: { enabled: false } });
      await page.goto(path);
      await expect(page.getByText(off)).toBeVisible();
      await expect(page.getByRole('link', { name: /Enable in Settings/ })).toBeVisible();
    } finally {
      await setAdminFlags({ [section]: { enabled: true } });
    }
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText(off)).toHaveCount(0);
  });
}

const EXPORTS = [
  { section: 'properties', path: '/admin/properties' },
  { section: 'users', path: '/admin/users' },
];

for (const { section, path } of EXPORTS) {
  test(`${section}.csvExport shows and hides the CSV export`, async ({ page, login }) => {
    const exportBtn = page.getByRole('button', { name: 'Export CSV' });
    await login.asAdmin();
    try {
      await setAdminFlags({ [section]: { csvExport: false } });
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByRole('tab').first()).toBeVisible();
      await expect(exportBtn).toHaveCount(0);
    } finally {
      await setAdminFlags({ [section]: { csvExport: true } });
    }
    await page.goto(path);
    await expect(exportBtn).toBeVisible();
  });
}

test('the Admin Modules panel lists only the switches that still do something', async ({ page, login, consoleErrors }) => {
  await login.asAdmin();
  await page.goto('/admin/settings?tab=flags');
  await page.getByRole('button', { name: 'Admin Modules' }).click();

  for (const name of ['Analytics', 'Finance', 'Reports', 'Flatmates', 'Support', 'Home Loans desk', 'Content', 'Team Activity']) {
    await expect(page.getByRole('switch', { name: `Toggle ${name}`, exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: /^Users/ }).click();
  await expect(page.getByRole('switch', { name: 'Toggle CSV export' })).toBeVisible();

  for (const gone of ['Revenue charts', 'Activity timeline', 'Priority levels', 'KPI tiles', 'Funnel time analysis', 'Cost']) {
    await expect(page.getByText(gone, { exact: true })).toHaveCount(0);
  }
  expect(consoleErrors).toHaveLength(0);
});
