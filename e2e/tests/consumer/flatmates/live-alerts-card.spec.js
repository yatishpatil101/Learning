import { test, expect } from '@playwright/test';
import { API, apiLogin, signedInAs, signedInAsNew, uniqueMobile } from '../../../helpers/liveAuth.js';

/**
 * Flatmates alerts — the screen, not the contract.
 *
 * `live-alerts.spec.js` already owns the server side of a flatmates saved search, and owns it
 * well: the `criteria`-not-`query` rule and its 422, the bare-array list read, the missing
 * read-by-id. It does all of that over `fetch` and never opens a browser. So every claim the
 * mock `alerts.spec.js` made about the *card* — when it appears, what it captures off the filter
 * bar, where a signed-out seeker is sent, what the dashboard panel does to a cadence — was
 * unowned, and this file takes exactly that half.
 *
 * ## Why the mock could not make these claims
 *
 * It read its results out of `localStorage['pnSavedSearches:' + mobile]`. Under a live
 * `savedSearch` domain nothing ever writes that key: `FlatmateAlertCard` goes through
 * `useSavedSearches().create` to `POST /me/saved-searches`. So the mock was asserting against a
 * store the product had stopped using — it would stay green if the create 422'd, if the seam were
 * unwired, or if the server dropped every facet it was sent. Here the assertions are reads of the
 * seeker's own alert list over the API, which is the only place the alert now exists.
 *
 * ## One claim is deliberately dropped, because the product changed under it
 *
 * The mock's first test is titled "keyed to the entered mobile". It is not, any more, and must not
 * be: `createSavedSearch` states that ownership comes from the token and that sending `mobile`
 * "would only invite the API's anonymous-capture guard". Carrying that claim across would have
 * pinned a behaviour the seam removed on purpose. What replaces it is the assertion that actually
 * matters now — the alert lands in *this account's* list, which is what "keyed to" was reaching
 * for before there were accounts.
 *
 * ## The tab-alias round trip
 *
 * `rooms` / `flatmates` / `groups` are legacy `?view=` values kept alive in `TAB_ALIAS` for old
 * deep links (D86); `normalizeTab` resolves them on the way in, so what gets *stored* is always
 * the current vocabulary. Both create tests enter through a legacy alias and assert the normalised
 * value came back from the server — the round trip that breaks if an alias is ever dropped, and
 * one the mock could only ever check against its own `JSON.parse`.
 *
 * ## The bug this file found on its first run
 *
 * `buildFlatmateAlertRecord` produces a `label` — the human summary of the search. The wire calls
 * that field `name`: `SavedSearchCreate` has no `label` at all, and `SavedSearchService.label()`
 * derives the stored label from `name` or leaves it null ("otherwise there is nothing to invent").
 * `toCreateRequest` sent `name: record.name`, which no flatmates caller sets, so every alert
 * created through the card was stored with a null label. Two things the user sees went generic:
 * the dashboard panel renders `{a.label || 'Saved search'}`, and the sweep's notification falls
 * back to "your saved search" rather than naming the search it matched.
 *
 * Proved against the running server rather than read off the source: the same create posted twice,
 * once without `name` (what the card sent) and once with it, came back `label: null` and
 * `label: "Team up · Men · Non-smoker"`. That is why test 3 asserts the top-level `alert.label`
 * and not `alert.filters.label` — `label` is in the provider's `TOP_LEVEL` set, so it is excluded
 * from the filters blob, which in turn makes `toViewModel`'s `row.label || filters.label` fallback
 * unreachable by construction.
 *
 * Two smaller things were put right while this file was being written, both of which it now
 * asserts: the gender segment gained the `aria-pressed` its neighbouring lifestyle tags already
 * had, and the dead `filters.label` read fallback was removed.
 *
 * This is the same shape as the two bugs `live-group-lifecycle.spec.js` found — the page's
 * vocabulary and the wire's vocabulary disagree about one field, and the mock provider stores the
 * page's own object, so under a mock the two can never disagree and no mock test can see it.
 */

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

/* Record every attempt to create an alert, so "nothing was created" can be asserted against the
   wire rather than against a storage key the product no longer writes. */
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

/* D85. The alert is dashboard-managed, so it needs an account; an anonymous one was something the
   user was told they had and could never see again. The absence assertion is the point, so it is
   anchored twice: the redirect proves the submit was handled rather than ignored, and the empty
   POST list is the same counter that reads 1 in the test above. */
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

/* The card has two entry conditions — an empty list, or a search narrowed to 2+ filters — and only
   the second one is interesting, because it is the one that can be confused with the first. The
   test is therefore built so that an empty result set would FAIL it: results are asserted present
   both before the filters are applied and after, so the card being on screen at the end cannot be
   the empty-state card wearing the same label. */
test('two filters reveal the card while results remain, and the facets reach the server', async ({ page }) => {
  const { accessToken } = await seeker(page);
  expect(await myAlerts(accessToken)).toHaveLength(0);

  await page.goto(`${BASE}/flatmates?view=flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 15000 });

  // Baseline: results present, no filters, no card. Without this the final assertion would be
  // satisfied by a board that showed the card unconditionally.
  await expect(createBtn(page)).toHaveCount(0);

  /* The desktop filter grid is collapsed by default so inventory clears the fold. Targeted by
     `aria-controls` rather than by name: there are two "Filters" buttons in the DOM (a mobile
     drawer trigger and this one), and only one of them owns this grid. */
  await page.locator('button[aria-controls="sf-desktop-filters"]').click();

  await page.getByRole('button', { name: 'Men', exact: true }).click();
  await page.getByRole('button', { name: 'Non-smoker', exact: true }).click();

  /* Both controls are asserted the same way. They did not used to be: the lifestyle tags carried
     `aria-pressed` and the gender segment announced itself only through a CSS class, so a screen
     reader was told whether "Non-smoker" was on but not whether "Men" was. That gap was closed
     alongside this spec, which is why the symmetric assertion is the honest one to write. */
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
  /* The summary line, read off the server's own `label` column rather than out of the filters blob.
     This is the assertion that found the third wire-vocabulary bug in this slice (see the header):
     the client calls the summary `label`, `SavedSearchCreate` calls it `name`, and until that was
     mapped the column was null for every alert the UI created — so the dashboard titled them all
     "Saved search" and the match notification said "your saved search" instead of naming the
     search. `filters.label` is deliberately NOT what is asserted: `label` is a top-level field in
     the provider's `TOP_LEVEL` set, so it never rides inside the blob, and the read-side
     `filters.label` fallback is unreachable by construction. */
  expect(alert.label).toMatch(/Team up/);
});

/* The dashboard panel, seeded over the API rather than into localStorage — under a live domain the
   panel reads the server, so a storage-seeded row would simply not be there. */
test('the dashboard panel silences an alert and deletes it, on the server both times', async ({ page }) => {
  /* Order matters here, and it cost a debugging session to find out why. The other tests sign the
     browser in and then open an API session for the same mobile; that is harmless when the browser
     only has to WRITE, because the request layer sends whatever token is in storage. This test has
     to READ through the browser, and the dashboard's alert list comes from a context that loads
     only when `isIn` is true. A second login invalidates the first session, so the browser is left
     holding a token that still works for page-level fetches while `AuthContext` has no user — and
     every caller-scoped provider (alerts, follows, plan, verification, notifications) stays silent.
     The panel then renders its empty state and the failure reads as "the alert was never created".
     Opening the API session FIRST and signing the browser in LAST leaves the browser's session the
     live one. */
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
      /* The summary goes in `name`, which is the only field `SavedSearchCreate` has for it and the
         only one the server's `label` column is derived from. Seeding it as `filters.label`
         instead — the shape the cards build internally — leaves the column null and the panel
         renders "Saved search"; this test failed exactly that way on its first run, which is a
         second, independent demonstration of the bug described in the header. */
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

  /* The intent badge and the "View matches" target both derive from `tab`, which only exists
     inside the free-form filters blob. Asserting them is how this test proves the blob survived
     the round trip into the panel — a server that dropped `filters` would still render the row,
     the label and the cadence picker, and only these two would give it away. `Move in now` rather
     than `Team up` because the seed is a move-in search: the pair is what makes the badge
     meaningful rather than a constant. Scoped to the page rather than to a row wrapper because
     this account has exactly one alert, asserted above. `.first()` because the tab word is drawn
     twice — once as the badge, once as a criteria chip — and both are readings of the same field,
     so either one carries the claim. */
  await expect(page.getByText('Move in now').first()).toBeVisible();
  await expect(page.getByRole('link', { name: /View matches/i })).toHaveAttribute('href', '/flatmates?view=move-in');

  // D84 replaced the on/off Switch with a cadence picker.
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
