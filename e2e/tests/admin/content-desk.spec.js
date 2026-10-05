/** `/admin/content` against the live API: counts and copy are read from the server, never hardcoded. The write
 * test archives its banner in `afterEach` because the e2e database resets per run, not per file. */
import { test, expect } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

/** The seeded admin, as used by the other live admin specs. */
const admin = () => authHeaders('9000000000');

/** Sign in and open the desk. */
async function openContent(page, login, tab) {
  await login.asAdmin();
  await page.goto(tab ? `/admin/content?tab=${tab}` : '/admin/content');
  await expect(page.getByRole('heading', { name: 'Content' })).toBeVisible();
}

/** One content type straight from the API, which is what the tab beside it should be showing. */
async function contentRows(request, type) {
  const res = await request.get(`${API}/admin/content/${type}`, { headers: await admin() });
  expect(res.status(), `GET /admin/content/${type}`).toBe(200);
  return res.json();
}

test('admin loads the Content desk with its three tabs and the banners view', async ({ page, login, consoleErrors }) => {
  await openContent(page, login);

  await expect(page.getByRole('tab', { name: /^Banners\b/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /^FAQs\b/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /^Announcements\b/ })).toBeVisible();
  await expect(page.getByRole('tab', { name: /^Reviews\b/ })).toHaveCount(0);

  await expect(page.getByText(/\d+ active, \d+ archived/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add banner' })).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test('the banners counter agrees with the server, not with a bundled fixture', async ({ page, login, request }) => {
  const banners = await contentRows(request, 'banners');
  const archived = banners.filter((b) => b.archived).length;
  const active = banners.length - archived;

  await openContent(page, login);
  // The discriminator for this tab. `db.json` ships its own banner count, so this line reading the
  // database's is what a silent fallback to the mock provider could not survive.
  await expect(page.getByText(`${active} active, ${archived} archived`)).toBeVisible();
});

test('the FAQs tab lists the questions the server holds', async ({ page, login, request }) => {
  const faqs = await contentRows(request, 'faqs');
  expect(faqs.length, 'the e2e seed is expected to carry FAQs for this tab to be worth asserting').toBeGreaterThan(0);

  await openContent(page, login, 'faqs');
  await expect(page.getByRole('button', { name: 'Add FAQ' })).toBeVisible();
  // A question taken from the API rather than the hardcoded "Is Draazy really zero brokerage?"
  // the mock file used — that string is a fact about db.json and says nothing about this desk.
  await expect(page.getByText(faqs[0].title ?? faqs[0].question)).toBeVisible();
});

/* Reviews-tab assertions live in `tests/admin-content.spec.js` (it pins this run's author on the row); not repeated here. */

test('adding a banner writes it through the API, not into this browser', async ({ page, login, request }) => {
  const headline = `E2E live banner ${Date.now()}`;

  await openContent(page, login);
  await page.getByRole('button', { name: 'Add banner' }).click();

  const dialog = page.getByRole('dialog', { name: 'Add banner' });
  await expect(dialog).toBeVisible();

  /* Headline and image are both required (the server answers 422 otherwise); fields have no labels, so they are
     addressed by position, and link is prefilled with `/listings`. */
  await dialog.getByRole('textbox').nth(0).fill(headline);
  await dialog.getByRole('textbox').nth(1).fill('https://example.invalid/e2e-banner.jpg');
  await dialog.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('alert')).toContainText('Saved');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText(headline)).toBeVisible();

  /* On screen is half the claim. The other half — and the only one the mock could not make — is
     that a second reader, which never touched this browser, can see the row. */
  const banners = await contentRows(request, 'banners');
  expect(banners.map((b) => b.headline)).toContain(headline);

  // Archive it again so the counter this file asserts elsewhere is unchanged by having run.
  const created = banners.find((b) => b.headline === headline);
  const archived = await request.post(
    `${API}/admin/content/banners/${created.id}/archive`,
    { headers: await admin() },
  );
  expect(archived.ok(), 'the banner this test created must not outlive it').toBeTruthy();
});

test('a banner with no image is refused, and the desk says which field', async ({ page, login }) => {
  /* The console shows the server's own message; only a live run can assert it, as the mock accepts the body. */
  await openContent(page, login);
  await page.getByRole('button', { name: 'Add banner' }).click();

  const dialog = page.getByRole('dialog', { name: 'Add banner' });
  await dialog.getByRole('textbox').nth(0).fill(`E2E refused banner ${Date.now()}`);
  await dialog.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByRole('alert')).toContainText("needs 'image'");
  // The dialog stays open on a refusal: a form that closes has thrown away what the operator typed
  // along with their chance to fix the one field the message named.
  await expect(dialog).toBeVisible();
});
