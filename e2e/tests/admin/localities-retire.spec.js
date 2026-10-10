// LIVE: `/admin/localities` — retiring an area closes it to new listings; restoring reopens it.
import { expect, test, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';
import { appReady } from '../../helpers/app.js';

const bodyRows = (page) => page.getByRole('table').locator('tbody tr');
const list = async () => (await fetch(`${API}/admin/localities`, { headers: await authHeaders(ACTORS.admin) })).json();
const archivedOf = async (slug) => (await list()).find((l) => l.slug === slug)?.archived;
const post = async (path, mobile) => fetch(`${API}${path}`, { method: 'POST', headers: await authHeaders(mobile) });

test.describe('LIVE: retire and restore a locality', () => {
  test('an admin retires an area and restores it from the console', async ({ page, login, consoleErrors }) => {
    const target = (await list()).find((l) => !l.archived && l.liveListings === 0) ?? (await list()).find((l) => !l.archived);
    expect(target, 'the directory needs an active area').toBeTruthy();
    await login.asAdmin();
    await page.goto('/admin/localities');
    await appReady(page);
    await page.getByLabel('Search localities').fill(target.slug);
    const row = bodyRows(page).filter({ has: page.getByText(target.slug, { exact: true }) });

    try {
      await test.step('Retire asks first, says the listings stay, and does nothing on Cancel', async () => {
        await row.getByRole('button', { name: `Retire ${target.name}`, exact: true }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog).toContainText('stop accepting new listings');
        await expect(dialog).toContainText('page stays');
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(dialog).toBeHidden();
        expect(await archivedOf(target.slug)).toBe(false);
      });

      await test.step('confirming retires it and the row flips to Retired', async () => {
        await row.getByRole('button', { name: `Retire ${target.name}`, exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: 'Retire', exact: true }).click();
        await expect(row).toContainText('Retired');
        await expect(row.getByRole('button', { name: `Restore ${target.name}`, exact: true })).toBeVisible();
        expect(await archivedOf(target.slug)).toBe(true);
      });

      await test.step('restoring reopens it', async () => {
        await row.getByRole('button', { name: `Restore ${target.name}`, exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: 'Restore', exact: true }).click();
        await expect(row).toContainText('Active');
        expect(await archivedOf(target.slug)).toBe(false);
      });
    } finally {
      if (await archivedOf(target.slug)) await post(`/admin/localities/${target.slug}/restore`, ACTORS.admin);
    }
    expect(consoleErrors).toEqual([]);
  });

  test('a staffer without the Localities function is refused the write', async ({ login }) => {
    const target = (await list()).find((l) => !l.archived);
    const { mobile } = await login.scopeStaff('rental', ['reviews:read']);

    expect((await post(`/admin/localities/${target.slug}/retire`, mobile)).status).toBe(403);
    expect(await archivedOf(target.slug)).toBe(false);
  });
});
