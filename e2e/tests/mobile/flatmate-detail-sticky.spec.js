import { test, expect } from '@playwright/test';
import { API, apiLogin, uniqueMobile } from '../../helpers/liveAuth.js';
import { ACTORS } from '../../fixtures/live.js';
import { flatmateCleanup } from '../../helpers/flatmateCleanup.js';
import { trackErrors } from '../../helpers/console.js';

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const track = flatmateCleanup(test);

async function liveGroup() {
  const { accessToken } = await apiLogin(uniqueMobile());
  const res = await fetch(`${API}/flatmates/groups`, {
    method: 'POST',
    headers: auth(accessToken),
    body: JSON.stringify({
      title: `Sticky ${Date.now().toString(36)}`, name: 'Host', locality: 'Baner', rent: 30000,
      seats: 3, seatsOpen: 1, policy: 'any', role: 'tenant',
    }),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  const group = await res.json();
  track('groups', group.id, accessToken);
  const { accessToken: admin } = await apiLogin(ACTORS.admin);
  const mod = await fetch(`${API}/admin/flatmates/${group.id}/moderation`, {
    method: 'PATCH',
    headers: auth(admin),
    body: JSON.stringify({ modStatus: 'live', note: 'e2e' }),
  });
  expect(mod.status, await mod.clone().text()).toBeLessThan(300);
  return group;
}

test.describe('LIVE: flatmate detail on a phone', () => {
  test('the ask sits in a sticky thumb-zone bar, the assistant clears it, and the page never scrolls sideways', async ({ page }) => {
    const group = await liveGroup();
    const errors = trackErrors(page);
    await page.addInitScript(() => localStorage.setItem(
      'dz_cookie_consent_v1',
      JSON.stringify({ necessary: true, functional: true, analytics: true, marketing: true, version: 1, ts: Date.now() }),
    ));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/flatmates/group/${group.id}`);

    const bar = page.locator('.fm-sticky');
    await expect(bar).toBeVisible({ timeout: 20_000 });
    await expect(bar).toContainText('Your share');
    const barBox = await bar.boundingBox();
    expect(barBox.y + barBox.height, 'the bar sits inside the viewport').toBeLessThanOrEqual(844 + 1);
    expect(barBox.y, 'the bar is in the bottom thumb zone').toBeGreaterThan(844 / 2);

    const fab = page.getByRole('button', { name: 'Open Draaz, the Draazy help assistant' });
    await expect(fab).toBeVisible();
    const fabBox = await fab.boundingBox();
    expect(fabBox.y + fabBox.height, 'the assistant button floats above the bar').toBeLessThanOrEqual(barBox.y + 1);

    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width, 'no sideways scroll').toBeLessThanOrEqual(390);
    expect(errors, errors.join('\n')).toHaveLength(0);
  });

  test('on a desktop the ask lives in the side card and the sticky bar is gone', async ({ page }) => {
    const group = await liveGroup();
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.goto(`/flatmates/group/${group.id}`);
    await expect(page.getByText('Your share').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.fm-sticky')).toBeHidden();
  });
});
