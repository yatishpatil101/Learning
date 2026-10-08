import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAs, signedInAsNew, uniqueMobile } from '../../../helpers/liveAuth.js';

/* Browser alert cards must prove the alert reaches the seeker's API list; localStorage mocks cannot
   catch field-name drift between the page's `label` and the wire's `name`. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

/** The seeker's own alert list, read over the API — the only place a live alert exists. */
async function myAlerts(token) {
  const res = await fetch(`${API}/me/saved-searches`, { headers: auth(token) });
  expect(res.status).toBe(200);
  // The contract returns a bare array here, not a page envelope.
  return await res.json();
}

/** Sign in through the browser and take a token for the same account to read back with. */
async function seeker(page) {
  const mobile = await signedInAsNew(page);
  const { accessToken } = await apiLogin(mobile);
  return { mobile, accessToken };
}

/* Force an empty result set so the card renders through its empty-state path: a gibberish
   smart-search query matches no post on any tab. */
async function forceEmpty(page) {
  const input = page.locator('input[placeholder*="girl in baner"]');
  await input.fill('zzqqxxnomatch');
  await input.press('Enter');
}

const createBtn = (page) => page.getByRole('button', { name: /Create alert/i });

/* Records every create-alert attempt so "nothing was created" is asserted against the wire, not a storage key. */
function watchCreates(page) {
  const posts = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/me/saved-searches')) posts.push(req.url());
  });
  return posts;
}

test('the empty-state card creates an alert on the seeker\'s account, under the current tab name', async ({ page }) => {
  const { accessToken } = await seeker(page);
  // A new account starts with nothing, so the single row below is one this test put there.
  expect(await myAlerts(accessToken)).toHaveLength(0);

  const posts = watchCreates(page);
  await page.goto(`${BASE}/flatmates?view=rooms`);
  await page.locator('.sf-card').first().waitFor({ timeout: 15000 });
  await forceEmpty(page);

  await expect(createBtn(page)).toBeVisible();
  await createBtn(page).click();
  await expect(page.getByText(/You’re first in line/i)).toBeVisible();

  // The confirmation is shown after the create settles, so the row is on the server by now.
  const alerts = await myAlerts(accessToken);
  expect(alerts).toHaveLength(1);
  expect(alerts[0].kind).toBe('flatmates');
  // Entered through the legacy `?view=rooms`; stored as the value it normalises to.
  expect(alerts[0].filters.tab).toBe('move-in');
  // The click really did go to the wire — the pair to the signed-out test's zero.
  expect(posts).toHaveLength(1);
});

/* Dashboard-managed alerts need accounts; redirect plus zero POSTs proves anonymous creation did
   not silently disappear. */
test('a signed-out seeker is sent to sign in, and no alert is created (D85)', async ({ page }) => {
  const posts = watchCreates(page);

  await page.goto(`${BASE}/flatmates?view=rooms`);
  await page.locator('.sf-card').first().waitFor({ timeout: 15000 });
  await forceEmpty(page);

  await expect(createBtn(page)).toBeVisible();
  await createBtn(page).click();

  await page.waitForURL(/\/signin\?reason=alerts/);
  expect(posts).toHaveLength(0);
});

/* Results are asserted before and after filters so the two-filter card cannot be confused with the
   empty-state card wearing the same label. */
test('two filters reveal the card while results remain, and the facets reach the server', async ({ page }) => {
  const { accessToken } = await seeker(page);
  expect(await myAlerts(accessToken)).toHaveLength(0);

  await page.goto(`${BASE}/flatmates?view=flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 15000 });

  // Baseline: results present, no filters, no card. Without this the final assertion would be
  // satisfied by a board that showed the card unconditionally.
  await expect(createBtn(page)).toHaveCount(0);

  /* Target `aria-controls` because two "Filters" buttons exist and only one owns this grid. */
  await page.locator('button[aria-controls="sf-desktop-filters"]').click();

  await page.getByRole('button', { name: 'Men', exact: true }).click();
  await page.getByRole('button', { name: 'Non-smoker', exact: true }).click();

  /* Both controls must expose pressed state; CSS-only selection left screen readers blind to one
     segment. */
  await expect(page.getByRole('button', { name: 'Men', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Non-smoker', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // Still matching somebody: this is what makes the card the 2-filter card and not the empty one.
  await expect(page.locator('.sf-card').first()).toBeVisible();

  await expect(createBtn(page)).toBeVisible();
  await createBtn(page).click();
  await expect(page.getByText(/You’re first in line/i)).toBeVisible();

  const [alert] = await myAlerts(accessToken);
  expect(alert.kind).toBe('flatmates');
  // Entered through the legacy `?view=flatmates`.
  expect(alert.filters.tab).toBe('team-up');
  // The facets the seeker actually chose, round-tripped through the blob rather than dropped.
  expect(alert.filters.gender).toBe('male');
  expect(alert.filters.habits).toContain('Non-smoker');
  /* Assert the server `label`, not `filters.label`; the provider lifts that field out of the blob,
     so the fallback is unreachable. */
  expect(alert.label).toMatch(/Team up/);
});

/* The dashboard panel, seeded over the API rather than into localStorage — under a live domain the
   panel reads the server, so a storage-seeded row would simply not be there. */
test('the dashboard panel silences an alert and deletes it, on the server both times', async ({ page }) => {
  /* Open the API session first; a later API login invalidates the browser session enough that
     AuthContext stays anonymous while fetches still have a token. */
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);

  const SUMMARY = 'Move in · Baner · ≤ ₹15,000 · Women · Verified';
  const facets = {
    tab: 'move-in', q: '', locality: 'Baner', budget: 15000, moveIn: '',
    gender: 'female', sharing: '', attachedBath: false, verifiedOnly: true,
    habits: ['Non-smoker'],
  };
  const created = await fetch(`${API}/me/saved-searches`, {
    method: 'POST',
    headers: auth(accessToken),
    body: JSON.stringify({
      /* Seed the summary as `name`; `filters.label` never reaches the server label column. */
      kind: 'flatmates', name: SUMMARY,
      // Both blobs, because a flatmates alert without `criteria` is a 422.
      filters: facets, criteria: facets,
      alertFrequency: 'daily', channel: 'whatsapp',
    }),
  });
  expect(created.status).toBe(201);

  await signedInAs(page, mobile);
  await page.goto(`${BASE}/dashboard#alerts`);
  await expect(page.getByText(SUMMARY)).toBeVisible();

  /* The badge and link prove the free-form `filters.tab` blob survived; a row, label and cadence
     picker would still render without it. */
  await expect(page.getByText('Move in now').first()).toBeVisible();
  await expect(page.getByRole('link', { name: /View matches/i })).toHaveAttribute('href', '/flatmates?view=move-in');

  // The cadence picker is the persisted control, not an on/off switch.
  await page.getByTestId('alert-frequency').first().selectOption('off');
  // Poll: the select fires an async PATCH, and a one-shot read races it.
  await expect
    .poll(async () => (await myAlerts(accessToken))[0]?.alertFrequency, { timeout: 10000 })
    .toBe('off');

  await page.getByRole('button', { name: /Delete alert/i }).first().click();
  // The row leaving the panel is the render half of the same write the API read below checks.
  await expect(page.getByRole('button', { name: /Delete alert/i })).toHaveCount(0);
  await expect.poll(async () => (await myAlerts(accessToken)).length, { timeout: 10000 }).toBe(0);
});
