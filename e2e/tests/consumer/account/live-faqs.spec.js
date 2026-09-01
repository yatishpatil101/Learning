/* Help FAQs against the live API.
 *
 * The endpoint this covers has existed since slice 8 and answered `[]` on every environment,
 * because `faqs` is created by V8 and was populated by nothing. The copy it was built to serve was
 * never missing — it sat in the browser's own `db.json`, nine objects that Support and the
 * assistant widget read directly. So this is not a feature being added; it is a table finally
 * holding the strings the endpoint was already promising, and a seam that lets the page read them
 * from the server instead of from the bundle it shipped in.
 *
 * What that makes hard, and how this spec answers it: the copy is identical on both sides, on
 * purpose (a migration that changes what the visitor reads is a rewrite). So no assertion about the
 * *text* can prove which side produced it. Provenance is established by waiting on the request
 * itself — the page must ask `GET /api/faqs` and must render what came back — and the API half is
 * asserted directly, without a browser, so a UI regression and a contract regression cannot be
 * mistaken for each other.
 *
 * Order is deliberately not asserted. `ContentService.listFaqs` is `findByArchivedFalse()` with no
 * `Sort`, so the sequence is whatever the heap returns; the mock returned db.json order. That
 * difference is real and is written up in `tasks/todo.md` rather than pinned here, because pinning
 * an accident makes it look like a decision.
 *
 * Fixtures: the nine rows seeded by `R__zz_dev_demo_data.sql` (dev/e2e only — production still
 * answers `[]`, deliberately, until FAQs have an admin write path).
 */
import { test, expect } from '../../../fixtures/live.js';
import { API } from '../../../helpers/liveAuth.js';

/** One seeded question, quoted exactly. Chosen because its answer is the platform's core claim. */
const ANCHOR_Q = 'Is PuneNest really zero brokerage?';

/** A second, from a different category, so the assertion is not about one lucky row. */
const OTHER_Q = 'How do I report a suspicious listing or user?';

/** The categories the nine rows carry. Asserted as a subset, so adding a tenth is not a failure. */
const CATEGORIES = ['General', 'Trust', 'Seekers', 'Owners', 'Payments', 'Services', 'Coverage'];

test('the FAQ list is a public read that needs no session', async () => {
  /* `security: []` in the contract, and it has to be: the help page is the first thing a visitor
     reaches when something has gone wrong, which is exactly the moment they cannot sign in. Sent
     with no Authorization header at all rather than with a signed-out session, because those are
     different things and only the first one proves the route is genuinely public. */
  const res = await fetch(`${API}/faqs`);
  expect(res.status).toBe(200);

  const faqs = await res.json();
  expect(Array.isArray(faqs)).toBe(true);
  expect(faqs.length).toBeGreaterThanOrEqual(9);

  const anchor = faqs.find((f) => f.question === ANCHOR_Q);
  expect(anchor).toBeTruthy();
  expect(anchor.id).toBeTruthy();
  expect(anchor.category).toBe('General');
  // The answer is the thing being served. An empty one is the endpoint answering with a shape.
  expect(anchor.answer).toContain('zero brokerage');

  // Every row is renderable. A question with no answer would open an accordion onto nothing.
  expect(faqs.every((f) => f.id && f.question && f.answer)).toBe(true);

  // The categories are real values, not a single default repeated.
  const seen = new Set(faqs.map((f) => f.category));
  for (const category of CATEGORIES) expect(seen.has(category)).toBe(true);
});

test('the help page renders the server list, and is seen to ask for it', async ({ page, login }) => {
  /* The provenance assertion. Both sides carry the same nine questions, so seeing one on screen
     proves nothing on its own -- the wait on the response is what makes this a live test rather
     than a screenshot of the mock. Armed before the navigation, because the fetch fires from an
     effect during first paint and a wait set up afterwards would miss it. */
  await login.asBuyer();

  const faqsRequest = page.waitForResponse(
    (r) => new URL(r.url()).pathname.endsWith('/api/faqs') && r.status() === 200,
  );
  await page.goto('/support');
  await faqsRequest;

  await expect(page.getByRole('heading', { name: 'Frequently asked questions' })).toBeVisible();

  /* Rendered as collapsed accordion buttons: the question is the button's label and the answer is
     revealed by clicking it. Asserting the button rather than the text means a section that
     rendered its questions as inert paragraphs would fail, which is the regression worth catching
     -- the whole point of the list is that it opens. */
  const anchor = page.getByRole('button', { name: ANCHOR_Q });
  await expect(anchor).toBeVisible();
  await expect(page.getByRole('button', { name: OTHER_Q })).toBeVisible();

  await anchor.click();
  await expect(page.getByText('zero brokerage', { exact: false }).first()).toBeVisible();
});
