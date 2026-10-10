// In-panel Runbooks: filtered by the desks a staffer can open, and linked from the page they are on.
import { test, expect } from '../../fixtures/live.js';
import { appReady } from '../../helpers/app.js';

const runbookNav = (page) => page.getByRole('navigation', { name: 'Runbooks' });

test('a staffer scoped to one desk sees the shared routine and their desk runbook, not other desks', async ({ page, login }) => {
  await login.scopeStaff('packers', ['desk:packers']);
  await login.asStaff('packers');
  await page.goto('/staff/runbooks');
  await appReady(page);

  await expect(runbookNav(page).locator('a[href="/staff/runbooks/service-queues"]')).toBeVisible();
  await expect(runbookNav(page).locator('a[href="/staff/runbooks/identity-review"]')).toHaveCount(0);

  await runbookNav(page).locator('a[href="/staff/runbooks/service-queues"]').click();
  const article = page.getByTestId('runbook-article');
  await expect(article.getByRole('heading', { name: 'Daily checklist' })).toBeVisible();

  await page.goto('/staff/runbooks/identity-review');
  await expect(page.getByText('This runbook is not available for your desks.')).toBeVisible();
});

test('the top-bar Runbooks link opens the runbook for the page, and runbook links stay in the panel', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/kyc-review');
  await appReady(page);
  await expect(page.getByRole('banner').getByRole('link', { name: 'Runbooks' })).toHaveAttribute('href', '/admin/runbooks/identity-review');

  await page.goto('/admin/runbooks/identity-review');
  const article = page.getByTestId('runbook-article');
  await expect(article.locator('a[href="/admin/runbooks/ticket-escalation"]').first()).toBeVisible();
  await expect(article.locator('a[href^="/help/a/"]')).toHaveCount(0);
});
