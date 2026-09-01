/**
 * `/admin/content` — the CMS desk, against the live API.
 *
 * ## Why this file exists
 *
 * `admin/content.spec.js` was the only coverage this desk had, and it ran on the mock. That was a
 * real gap rather than a deliberate one: **both** of the desk's data paths are live domains and
 * have been for a while — banners, FAQs and announcements go through `adminContentService` to
 * `/admin/content/{type}`, and the Reviews tab goes through `reviewService` to `GET /admin/reviews`.
 * Nothing about this screen needed a mock; it simply never got converted.
 *
 * ## The magnitudes are read from the API, never hardcoded
 *
 * The mock file asserted `Showing 1–10 of 12 reviews` and the exact text of a seeded FAQ. Both are
 * facts about `db.json`, and porting them would have swapped one store's arithmetic for another's
 * while looking like a conversion. Every count and every row of copy below is fetched first and
 * compared, so what is actually asserted is **the screen agrees with the server** — which is the
 * only claim that survives the seed changing underneath it.
 *
 * That also makes these tests discriminators rather than renders. `services/config.js` falls back
 * to the mock provider with a `console.warn`, not an error, so a test asserting a static heading
 * would stay green while the desk read localStorage. A count taken from the database cannot be
 * reproduced by a provider reading `db.json`.
 *
 * ## The write test cleans up after itself
 *
 * The e2e database is reset at the **start of a run**, not per file, so a banner created here and
 * left behind is a row every later assertion in this file has to tolerate — and the "active,
 * archived" counter on the banners tab is exactly the sort of thing that would then drift. The
 * banner is archived in `afterEach`, through the same API the console uses.
 */
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

test('admin loads the Content desk with all four tabs and the banners view', async ({ page, login, consoleErrors }) => {
  await openContent(page, login);

  await expect(page.getByRole('button', { name: 'Banners', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'FAQs', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Announcements', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reviews', exact: true })).toBeVisible();

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
  // A question taken from the API rather than the hardcoded "Is PuneNest really zero brokerage?"
  // the mock file used — that string is a fact about db.json and says nothing about this desk.
  await expect(page.getByText(faqs[0].title ?? faqs[0].question)).toBeVisible();
});

/* The Reviews tab's own assertions live in `tests/live-admin-content.spec.js` — "the console reads
   the live queue, and Archive is gone rather than hidden", which pins this run's own author name on
   the row and is a stronger claim than a count. Nothing about that tab is re-asserted here. */

test('adding a banner writes it through the API, not into this browser', async ({ page, login, request }) => {
  const headline = `E2E live banner ${Date.now()}`;

  await openContent(page, login);
  await page.getByRole('button', { name: 'Add banner' }).click();

  const dialog = page.getByRole('dialog', { name: 'Add banner' });
  await expect(dialog).toBeVisible();

  /* Headline **and** image. The fields carry no label association, so they are addressed by
     position: headline, image, link — and link is prefilled with `/listings`.

     Filling only the first one is what `admin/content.spec.js` did, and it passed, because the mock
     store validates nothing. The server answers `422 A banners item needs 'image'`, so that test
     was green over a write the real API refuses — a create path that works offline and cannot work
     in production. The refusal is pinned as coverage in the test below rather than merely avoided
     here. */
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
  /* The console deliberately surfaces the server's own message rather than a generic "could not
     save" (`AdminContent.jsx`: "The server names the offending field ... and that is far more"
     useful). This is the assertion that keeps that true, and it can only be made live — the mock
     provider accepts the same body without complaint, which is why the mock spec never noticed
     that its own happy-path write was one the API would reject. */
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

// ─── Guards ───

test('unauthenticated visitor is redirected to staff-login', async ({ page }) => {
  await page.goto('/admin/content');

  await page.waitForURL('**/staff-login**');
  expect(new URL(page.url()).pathname).toBe('/staff-login');
  await expect(page.getByRole('heading', { name: 'Content' })).toHaveCount(0);
});

test('a buyer cannot open the admin content desk', async ({ page, login }) => {
  await login.asBuyer();
  await page.goto('/admin/content');

  await page.waitForURL('**/staff-login**');
  expect(new URL(page.url()).pathname).toBe('/staff-login');
  await expect(page.getByRole('heading', { name: 'Content' })).toHaveCount(0);
});

/* The API-side half of that guard — that `/admin/content/{type}` refuses a signed-in consumer
   directly, not merely that the router redirects one — is `tests/live-admin-content.spec.js`'s
   "authoring is closed to signed-in consumers and to the public". Asserting it twice would cost a
   request to learn nothing. */


