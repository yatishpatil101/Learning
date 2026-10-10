// LIVE: `/admin/localities` — the directory the curator reads, not the endpoint behind it.
import { expect, test, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

const table = (page) => page.getByRole('table');
const bodyRows = (page) => table(page).locator('tbody tr');
const chip = (page, name) => page.getByRole('group', { name: 'Status' }).getByRole('button', { name });

async function openDirectory(page) {
  const [res] = await Promise.all([
    page.waitForResponse((r) => /\/api\/admin\/localities(\?|$)/.test(r.url()) && r.request().method() === 'GET'),
    page.goto('/admin/localities'),
  ]);
  expect(res.status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Localities' })).toBeVisible();
  await expect(bodyRows(page).first()).toBeVisible();
}

test.describe('LIVE: the localities directory', () => {
  test('the chips count the server rows and filter them by Active / Retired, and the pending queue is gone', async ({ page, login, consoleErrors }) => {
    const catalogue = await (await fetch(`${API}/admin/localities`, { headers: await authHeaders(ACTORS.admin) })).json();
    expect(catalogue.length).toBeGreaterThan(0);
    const retired = catalogue.filter((l) => l.archived).length;
    await login.asAdmin();
    await openDirectory(page);

    await test.step('every chip carries the server count', async () => {
      await expect(chip(page, `All ${catalogue.length.toLocaleString('en-IN')}`)).toHaveAttribute('aria-pressed', 'true');
      await expect(chip(page, `Active ${(catalogue.length - retired).toLocaleString('en-IN')}`)).toBeVisible();
      await expect(chip(page, `Retired ${retired.toLocaleString('en-IN')}`)).toBeVisible();
    });

    await test.step('Active shows only live areas, each with its live-listing count', async () => {
      await chip(page, /^Active/).click();
      await expect(chip(page, /^Active/)).toHaveAttribute('aria-pressed', 'true');
      await expect(bodyRows(page).first()).toContainText('Active');
      await expect(bodyRows(page).filter({ hasText: 'Retired' })).toHaveCount(0);
      await expect(table(page).getByRole('columnheader', { name: 'Live listings' })).toBeVisible();
    });

    await test.step('Retired shows only retired areas, or says none match', async () => {
      await chip(page, /^Retired/).click();
      if (retired === 0) await expect(page.getByText('No localities match these filters.').filter({ visible: true }).first()).toBeVisible();
      else await expect(bodyRows(page).filter({ hasText: 'Active' })).toHaveCount(0);
    });

    await test.step('search narrows by name or slug, and Clear puts everything back', async () => {
      await chip(page, /^All/).click();
      await page.getByLabel('Search localities').fill('baner');
      await expect(bodyRows(page).first()).toContainText('Baner');
      await page.getByRole('button', { name: /clear/i }).click();
      await expect(page.getByLabel('Search localities')).toHaveValue('');
    });

    await test.step('there is no Pending Localities queue in the console', async () => {
      await expect(page.getByRole('tab', { name: /awaiting|pending/i })).toHaveCount(0);
      await expect(page.getByText('Pending Localities')).toHaveCount(0);
    });
    expect(consoleErrors).toEqual([]);
  });
});
