import { test, expect } from '../../fixtures/live.js';
import { seedConsent, signedInAsNew } from '../../helpers/liveAuth.js';

const nav = (page) => page.getByTestId('dashboard-mobile-nav');
const groupButton = (page, group) => page.locator(`[data-dashboard-group="${group}"]`);

async function openDashboard(page, login, actor, target = '/dashboard') {
  await seedConsent(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await login[actor]();
  await page.goto(target);
  await expect(nav(page)).toBeVisible({ timeout: 20000 });
}

async function expectGroups(page, labels) {
  const tabs = nav(page).getByRole('tab');
  await expect(tabs).toHaveCount(labels.length);
  for (const label of labels) {
    await expect(nav(page).getByRole('tab', { name: new RegExp(label, 'i') })).toBeVisible();
  }
}

async function expectSegmentsFit(page, width) {
  await page.setViewportSize({ width, height: 844 });
  await expect(nav(page)).toBeVisible();
  const boxes = await nav(page).locator('[data-dashboard-group]').evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, height: rect.height, viewport: window.innerWidth };
    }),
  );
  for (const box of boxes) {
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(box.viewport);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
}

test.describe('Live dashboard navigation', () => {
  test('owner groups fit, legacy hashes highlight their group, back steps between groups, and seekers get their own set', async ({ page, login }) => {
    test.slow();
    await openDashboard(page, login, 'asOwner');

    await test.step('owner groups fit at phone widths', async () => {
      await expectGroups(page, ['Home', 'Requests', 'My Properties', 'Account']);
      for (const width of [360, 390, 414]) await expectSegmentsFit(page, width);
    });

    await test.step('legacy owner hashes open the same section and highlight the containing group', async () => {
      for (const [hash, group] of [
        ['owner-hub', 'properties'],
        ['listings', 'properties'],
        ['enquiries', 'requests'],
        ['leads', 'requests'],
        ['saved', 'account'],
        ['recent', 'account'],
        ['alerts', 'account'],
        ['groups', 'account'],
        ['visits', 'requests'],
        ['billing', 'account'],
        ['profile', 'account'],
        ['documents', 'properties'],
        ['finances', 'properties'],
      ]) {
        await page.goto(`/dashboard#${hash}`);
        await expect(groupButton(page, group)).toHaveAttribute('aria-current', 'page');
      }
      await page.goto('/dashboard?tab=profile');
      await expect(groupButton(page, 'account')).toHaveAttribute('aria-current', 'page');
    });

    await test.step('Android back returns to the previous dashboard group', async () => {
      await page.goto('/dashboard');
      await expect(nav(page)).toBeVisible({ timeout: 20000 });
      await nav(page).getByRole('tab', { name: /Home/i }).click();
      await nav(page).getByRole('tab', { name: /Requests/i }).click();
      await expect(groupButton(page, 'requests')).toHaveAttribute('aria-current', 'page');
      await expect(page).toHaveURL(/#leads$/);

      await page.goBack();
      await expect(page).toHaveURL(/#overview$/);
      await expect(groupButton(page, 'home')).toHaveAttribute('aria-current', 'page');
    });

    await test.step('a seeker gets Saved and Visits instead, and they fit too', async () => {
      await page.context().clearCookies();
      await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
      await signedInAsNew(page);
      await page.goto('/dashboard');
      await expect(nav(page)).toBeVisible({ timeout: 20000 });
      await expectGroups(page, ['Home', 'Saved', 'Visits', 'Account']);
      for (const width of [360, 390, 414]) await expectSegmentsFit(page, width);
    });
  });

  test('rental deep links highlight Rental when a tenancy exists', async ({ page, login }) => {
    await openDashboard(page, login, 'asTenant', '/dashboard#rental');
    await expect(groupButton(page, 'rental')).toHaveAttribute('aria-current', 'page');

    await page.goto('/dashboard#my-rental');
    await expect(groupButton(page, 'rental')).toHaveAttribute('aria-current', 'page');

    await page.goto('/dashboard#tenancy');
    await expect(groupButton(page, 'rental')).toHaveAttribute('aria-current', 'page');
  });
});
