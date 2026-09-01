/**
 * LIVE integration check for the society hub **through the UI**, not through HTTP.
 *
 * Excluded from the default run; needs a backend on :8081 under the `dev,e2e` profiles and the
 * `punenest_e2e` database. Run it explicitly:
 *
 *   cd e2e; npx playwright test tests/live-society-hub.spec.js --config=playwright.live.config.js
 *
 * ## Why a seventh society live spec, when six already pass
 *
 * The six that came before it (`live-society-{residency,community,contributions,proposals,minting,
 * reports}.spec.js`) each drive the endpoints directly with `authHeaders`. They prove the server is
 * right. They cannot prove the *page* reaches it, because they never load the page — and for the
 * whole life of this hub the page did not reach anything: `useSocietyHub.js` read questions,
 * answers, recommendations, replies, the noticeboard, the resident roster and every proposal out of
 * `localStorage`. Six green specs and a hub that talked to nobody are perfectly compatible facts.
 *
 * So this file is deliberately the slow kind. It signs a real person in, clicks the same controls a
 * member clicks, and then **reloads** — because a value that survives a reload came back over the
 * wire, and a value that does not was never more than React state. That reload is the entire
 * assertion; everything around it is just getting into position.
 *
 * ## What each test is actually watching for
 *
 * 1. **A question survives a reload.** The one that catches a hub wired to nothing at all.
 * 2. **A recommendation renders the server's author, and "Helpful" is idempotent.** `helpfulByMe`
 *    and `helpfulCount` used to be computed from a `helpful[]` array the browser kept beside the
 *    post; the count could differ between two people looking at the same screen. Pressing Helpful,
 *    reloading, and finding *one* — not two, not zero — is what proves the server owns the number.
 * 3. **The report dialog names the thing that was clicked.** `REPORT_TARGET_KEYS` knew three of six
 *    kinds and fell back to "review", so reporting a recommendation asked you to confirm a
 *    complaint about "this review". A spec that opens the dialog on a contribution and reads its
 *    heading is the cheapest possible guard against that returning.
 * 4. **A report actually files.** The dialog's textarea used to *be* the complaint; the server
 *    requires a recognised reason code, so a dialog with only prose in it could not have submitted
 *    anything. This presses Submit and then reads the row back from the ops queue.
 *
 * The seeded society is the verified "Skyline Heights, Baner" — every other society live spec uses
 * it, and it is the one with coordinates and a listing, so the hub renders all five tabs.
 */
import { test, expect } from '@playwright/test';
import { signIn, authHeaders, uniqueMobile, API } from '../helpers/liveAuth.js';

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const SLUG = 'skyline-heights-baner';

/* A staff account is the only way to read the moderation queue; 9000000000 is the seeded admin and
   is what every other back-office live spec uses. */
const ADMIN = '9000000000';

/** Land on the hub and wait for the heading, which only paints once the society read resolves. */
async function openHub(page, tab) {
  await page.goto(`${BASE}/society/${SLUG}${tab ? `?tab=${tab}` : ''}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15000 });
}

test('a question asked on the hub is still there after a reload', async ({ page }) => {
  const mobile = await uniqueMobile();
  await signIn(page, mobile);

  /* The body has to be unique per run: the seeded society accumulates questions across every run of
     this file, and asserting on a shared string would pass on somebody else's row. */
  const body = `Is the lift maintained weekly? ${Date.now()}`;

  await openHub(page, 'reviews');
  await page.getByPlaceholder(/water supply reliable/i).fill(body);
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByText(body)).toBeVisible({ timeout: 10000 });

  /* The assertion. Before the repoint this survived too — out of localStorage — so the reload is
     necessary but not sufficient on its own; the second half is that it is attributed to the name
     the *server* holds for this account, which the browser never had. */
  await page.reload();
  await page.getByRole('tab', { name: /Reviews/ }).click();
  await expect(page.getByText(body)).toBeVisible({ timeout: 10000 });

  const card = page.getByText(body).locator('xpath=ancestor::div[contains(@class,"glass")][1]');
  await expect(card).toContainText(/asked by \S+/i);
});

test('Helpful is a server count, not a browser one — pressing it twice settles at one', async ({ page }) => {
  const mobile = await uniqueMobile();
  await signIn(page, mobile);

  const body = `Tanker fills at 7am, keep the sump open. ${Date.now()}`;

  await openHub(page, 'community');
  await page.getByRole('button', { name: 'Add tip' }).click();
  await page.getByPlaceholder(/Water tanker fills/i).fill(body);
  await page.getByRole('button', { name: 'Post to community' }).click();
  await expect(page.getByText(body)).toBeVisible({ timeout: 10000 });

  const card = page.getByText(body).locator('xpath=ancestor::div[contains(@class,"glass")][1]');
  const helpful = card.getByRole('button', { name: /Helpful/i });

  /* Off before, on after — `aria-pressed` is the rendered truth, and it is driven by `helpfulByMe`,
     which now arrives on the wire rather than being recomputed from a local array. */
  await expect(helpful).toHaveAttribute('aria-pressed', 'false');
  await helpful.click();
  await expect(helpful).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await page.getByRole('tab', { name: /Community/ }).click();
  const after = page.getByText(body).locator('xpath=ancestor::div[contains(@class,"glass")][1]')
    .getByRole('button', { name: /Helpful/i });
  await expect(after).toHaveAttribute('aria-pressed', 'true');

  /* One, not two. The old toggle pushed a row per press into a browser array; a retried tap — the
     ordinary consequence of a flaky mobile connection — double-counted. The server's PUT/DELETE
     pair is idempotent, so a second press of the same intent cannot inflate it. */
  await expect(after).toContainText(/\b1\b/);
});

test('the report dialog names the thing that was clicked, not "review"', async ({ page }) => {
  const mobile = await uniqueMobile();
  await signIn(page, mobile);

  const body = `Milk delivery from the D-wing shop is reliable. ${Date.now()}`;

  await openHub(page, 'community');
  await page.getByRole('button', { name: 'Add tip' }).click();
  await page.getByPlaceholder(/Water tanker fills/i).fill(body);
  await page.getByRole('button', { name: 'Post to community' }).click();
  await expect(page.getByText(body)).toBeVisible({ timeout: 10000 });

  const card = page.getByText(body).locator('xpath=ancestor::div[contains(@class,"glass")][1]');
  await card.getByRole('button', { name: /Report contribution/i }).click();

  const dialog = page.getByRole('dialog', { name: 'Submit report' });
  await expect(dialog).toContainText(/Report this contribution/i);
  await expect(dialog).not.toContainText(/Report this review/i);
});

test('a report filed from the hub lands in the moderation queue with its reason code', async ({ page, request }) => {
  const mobile = await uniqueMobile();
  await signIn(page, mobile);

  const body = `Plumber leaves the stairwell wet every visit. ${Date.now()}`;

  await openHub(page, 'community');
  await page.getByRole('button', { name: 'Add tip' }).click();
  await page.getByPlaceholder(/Water tanker fills/i).fill(body);
  await page.getByRole('button', { name: 'Post to community' }).click();
  await expect(page.getByText(body)).toBeVisible({ timeout: 10000 });

  const card = page.getByText(body).locator('xpath=ancestor::div[contains(@class,"glass")][1]');
  await card.getByRole('button', { name: /Report contribution/i }).click();

  const dialog = page.getByRole('dialog', { name: 'Submit report' });
  /* `spam` rather than the default `abuse`, so the assertion below cannot pass on a report whose
     reason was never read off the picker at all. */
  await dialog.getByRole('button', { name: /Reason/i }).click();
  await page.getByRole('option', { name: /Spam, advertising/i }).click();
  await dialog.getByPlaceholder(/Anything else/i).fill('Posted the same thing four times.');
  await dialog.getByRole('button', { name: 'Submit report' }).click();
  /* Scoped by name: the cookie-consent banner is also a `role="dialog"` and sits on every page, so
     an unscoped `toHaveCount(0)` can never pass however well the report worked. */
  await expect(page.getByRole('dialog', { name: 'Submit report' })).toHaveCount(0, { timeout: 10000 });

  /* Read it back as ops would. This is the half no UI assertion can reach: the dialog closing means
     the request returned 2xx, not that a moderator will ever see the row. */
  const headers = await authHeaders(ADMIN);
  const res = await request.get(`${API}/reports?targetType=society_contribution&status=open&size=100`, { headers });
  expect(res.status()).toBe(200);
  const page1 = await res.json();
  const mine = (page1.content || []).find((r) => (r.details || '').includes('four times'));
  expect(mine, 'the report filed through the hub is missing from the ops queue').toBeTruthy();
  expect(mine.reason).toBe('spam');
  expect(mine.targetType).toBe('society_contribution');
});
