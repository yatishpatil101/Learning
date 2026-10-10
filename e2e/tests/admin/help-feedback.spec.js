import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

const send = (body) => fetch(`${API}/help/feedback`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ lang: 'en', voter: crypto.randomUUID(), ...body }),
});

test('admin reads per-article verdict counts and the comments, which render as text', async ({ page, login, consoleErrors }) => {
  const slug = `e2e-feedback-${Date.now().toString(36)}`;
  const nasty = '=HYPERLINK("http://evil.test","x") <b>bold</b>';
  expect((await send({ slug, helpful: false, comment: nasty })).ok).toBe(true);
  expect((await send({ slug, helpful: false })).ok).toBe(true);
  expect((await send({ slug, helpful: true })).ok).toBe(true);

  await login.asAdmin();
  await page.goto('/admin/help-feedback');
  await expect(page.getByRole('heading', { name: 'Help feedback' })).toBeVisible();

  const row = page.getByTestId('help-feedback-article').filter({ hasText: slug });
  await expect(row).toContainText('1 helpful');
  await expect(row).toContainText('2 not helpful');
  await expect(row).toContainText('1 comment');

  await row.getByRole('button', { name: 'Read comments' }).click();
  await expect(page.getByText(`Comments on ${slug}`)).toBeVisible();
  const comment = page.getByTestId('help-feedback-comment');
  await expect(comment).toHaveCount(1);
  await expect(comment).toContainText(nasty);
  await expect(comment.locator('b')).toHaveCount(0);

  expect(consoleErrors).toEqual([]);
});

test('a reader who votes again replaces their verdict instead of adding one', async ({ page, login }) => {
  const slug = `e2e-feedback-${Date.now().toString(36)}-once`;
  const voter = crypto.randomUUID();
  expect((await send({ slug, voter, helpful: false })).ok).toBe(true);
  expect((await send({ slug, voter, helpful: false, comment: 'Missing the fee table' })).ok).toBe(true);

  await login.asAdmin();
  await page.goto('/admin/help-feedback');
  const row = page.getByTestId('help-feedback-article').filter({ hasText: slug });
  await expect(row).toContainText('0 helpful');
  await expect(row).toContainText('1 not helpful');
  await expect(row).toContainText('100% not helpful');
  await expect(row).toContainText('1 comment');
});

test('a manager neither sees help feedback nor reads its API', async ({ page, login }) => {
  const res = await fetch(`${API}/admin/help-feedback`, { headers: await authHeaders(ACTORS.manager) });
  expect(res.status).toBe(403);

  await login.asManager();
  await page.goto('/admin/help-feedback');
  await expect(page).toHaveURL(/\/admin\/?$/);
  await expect(page.getByRole('link', { name: 'Help feedback' })).toHaveCount(0);
});
