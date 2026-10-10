import { test, expect } from '../../../fixtures/live.js';
import { API } from '../../../helpers/liveAuth.js';

const HIDDEN = ['modStatus', 'mobile', 'ownerMobile', 'ownerConsentMobile', 'addressFingerprint', 'flagForReview'];
const decimals = (n) => (String(n).split('.')[1] || '').length;

test('the anonymous feed carries no moderation, contact or member ids, and only coarse coordinates', async () => {
  for (const tab of ['move-in', 'team-up']) {
    const res = await fetch(`${API}/flatmates/feed?tab=${tab}&size=100`);
    expect(res.status).toBe(200);
    const rows = (await res.json()).content;
    expect(rows.length, `${tab} has rows`).toBeGreaterThan(0);
    for (const row of rows) {
      expect(HIDDEN.filter((k) => k in row), `${tab} ${row.id}`).toEqual([]);
      expect((row.members || []).filter((m) => 'id' in m), `${tab} ${row.id} members`).toEqual([]);
      if (row.lat != null) expect(decimals(row.lat), `${tab} ${row.id} lat`).toBeLessThanOrEqual(3);
      if (row.lng != null) expect(decimals(row.lng), `${tab} ${row.id} lng`).toBeLessThanOrEqual(3);
    }
  }
});

test('the map asks for no more rows than the server will page', async ({ page, consoleErrors }) => {
  await page.goto('/flatmates');
  await expect(page.getByRole('button', { name: 'Map' })).toBeVisible({ timeout: 20000 });
  const mapRead = page.waitForRequest((r) => {
    const u = new URL(r.url());
    return u.pathname === '/api/flatmates/feed' && Number(u.searchParams.get('size')) > 24;
  });
  await page.getByRole('button', { name: 'Map' }).click();
  expect(Number(new URL((await mapRead).url()).searchParams.get('size'))).toBe(100);
  expect(consoleErrors).toEqual([]);
});
