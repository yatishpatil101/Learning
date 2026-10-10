/** `/admin/content` against the live API: counts and copy are read from the server, never hardcoded. The write
 * test archives its FAQ in `afterEach` because the e2e database resets per run, not per file. */
import { test, expect } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

/** The seeded admin, as used by the other live admin specs. */
const admin = () => authHeaders('9000000000');

/** Sign in and open the desk. */
async function openContent(page, login) {
  await login.asAdmin();
  await page.goto('/admin/content');
  await expect(page.getByRole('heading', { name: 'Content' })).toBeVisible();
}

/** One content type straight from the API, which is what the tab beside it should be showing. */
async function contentRows(request, type) {
  const res = await request.get(`${API}/admin/content/${type}`, { headers: await admin() });
  expect(res.status(), `GET /admin/content/${type}`).toBe(200);
  return res.json();
}

test('admin loads the Content desk on the FAQs view, with banners and announcements gone', async ({ page, login, consoleErrors }) => {
  await openContent(page, login);

  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByText(/\d+ active\)/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show archived' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add FAQ' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Add banner|New announcement/ })).toHaveCount(0);

  expect(consoleErrors).toEqual([]);
});

test('retired content types are 404 on the API, not an empty list', async ({ request }) => {
  for (const type of ['banners', 'announcements', 'services']) {
    const res = await request.get(`${API}/admin/content/${type}`, { headers: await admin() });
    expect(res.status(), `GET /admin/content/${type}`).toBe(404);
  }
});

test('the FAQ counter agrees with the server, and archived rows load only on request', async ({ page, login, request }) => {
  const faqs = await contentRows(request, 'faqs');
  const archived = faqs.filter((f) => f.archived).length;
  const active = faqs.length - archived;

  await openContent(page, login);
  await expect(page.getByText(`${active} active)`)).toBeVisible();
  await page.getByRole('button', { name: 'Show archived' }).click();
  await expect(page.getByText(`${active} active, ${archived} archived)`)).toBeVisible();
});

test('the desk lists the questions the server holds', async ({ page, login, request }) => {
  const faqs = await contentRows(request, 'faqs');
  expect(faqs.length, 'the e2e seed is expected to carry FAQs for this desk to be worth asserting').toBeGreaterThan(0);

  await openContent(page, login);
  await expect(page.getByText(faqs.find((f) => !f.archived).question)).toBeVisible();
});

/* Reviews-tab assertions live in tests/admin-content.spec.js, which pins this run's author on the row. */

test('adding an FAQ writes it through the API, not into this browser', async ({ page, login, request }) => {
  const question = `E2E live faq ${Date.now()}`;

  await openContent(page, login);
  await page.getByRole('button', { name: 'Add FAQ' }).click();

  const dialog = page.getByRole('dialog', { name: 'Add faq' });
  await expect(dialog).toBeVisible();

  /* Fields have no labels, so they are addressed by position; category is prefilled with `general`. */
  await dialog.getByRole('textbox').nth(0).fill(question);
  await dialog.getByRole('textbox').nth(1).fill('Answer written by the e2e run.');
  await dialog.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('alert')).toContainText('Saved');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText(question)).toBeVisible();

  /* On screen is half the claim. The other half is that a second reader, which never touched this
     browser, can see the row. */
  const faqs = await contentRows(request, 'faqs');
  expect(faqs.map((f) => f.question)).toContain(question);

  const created = faqs.find((f) => f.question === question);
  const archived = await request.post(
    `${API}/admin/content/faqs/${created.id}/archive`,
    { headers: await admin() },
  );
  expect(archived.ok(), 'the FAQ this test created must not outlive it').toBeTruthy();
});

test('an FAQ with no question is refused, and the desk says which field', async ({ page, login }) => {
  await openContent(page, login);
  await page.getByRole('button', { name: 'Add FAQ' }).click();

  const dialog = page.getByRole('dialog', { name: 'Add faq' });
  await dialog.getByRole('textbox').nth(1).fill(`E2E refused answer ${Date.now()}`);
  await dialog.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('alert')).toContainText("needs 'question'");
  // The dialog stays open on a refusal so the operator can fix the one field the message named.
  await expect(dialog).toBeVisible();
});

test('an FAQ added in the CMS leads the Home page FAQ block', async ({ page, request }) => {
  const question = `E2E home faq ${Date.now()}`;
  const res = await request.post(`${API}/admin/content/faqs`, {
    headers: await admin(),
    data: { question, answer: 'Answer shown on Home.', category: '0-e2e-home' },
  });
  expect(res.status()).toBe(201);
  const { id } = await res.json();

  try {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Frequently asked questions' })).toBeVisible();
    await expect(page.locator('section[aria-labelledby="faqHeading"] details').first()).toContainText(question);
  } finally {
    await request.post(`${API}/admin/content/faqs/${id}/archive`, { headers: await admin() });
  }
});