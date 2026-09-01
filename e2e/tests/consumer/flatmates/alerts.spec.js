import { test, expect } from '@playwright/test';

/* Flatmates alerts (saved searches) — the flatmates analog of the listings
   alert feature. The "create an alert" card (FlatmateAlertCard) is the single entry
   point: it appears whenever the list is empty OR the seeker has narrowed with 2+
   filters (mirroring how the listings page surfaces its alert card as the search
   tightens). Submitting it creates a per-mobile, dashboard-manageable alert.

   Since D85 the card requires sign-in: a signed-out seeker who submits is routed to
   /signin?reason=alerts instead of getting a local alert they cannot manage.

   The alert's `tab` is one of the two current values, `move-in` or `team-up` — not
   the older `rooms` / `flatmates` / `groups` (tech-debt D86). Those three still work
   as `?view=` values because `flatmates/model.js` keeps them in `TAB_ALIAS` for old
   deep links and saved alerts, but `normalizeTab` resolves them on the way in, so
   what gets *stored* is always the current vocabulary. This spec deliberately enters
   through the legacy alias and asserts the normalised value, which is the round-trip
   that would break if an alias were ever dropped. */

const BASE = process.env.BASE_URL || 'http://localhost:5173';
const MOBILE = '9876500123';

async function seedUser(page, mobile = MOBILE) {
  await page.addInitScript((m) => {
    localStorage.setItem('puneNestUser', JSON.stringify({
      name: 'Test Seeker', mobile: m, role: 'buyer', loginAt: Date.now(),
    }));
  }, mobile);
}

const savedSearches = (page, mobile = MOBILE) =>
  page.evaluate((m) => JSON.parse(localStorage.getItem('pnSavedSearches:' + m) || '[]'), mobile);

/* Force an empty result set so the FlatmateAlertCard renders: a gibberish smart-search
   query matches no post on any tab. */
async function forceEmpty(page) {
  const input = page.locator('input[placeholder*="girl in baner"]');
  await input.fill('zzqqxxnomatch');
  await input.press('Enter');
}

test('empty-state card creates a flatmates alert keyed to the entered mobile', async ({ page }) => {
  await seedUser(page);
  await page.goto(`${BASE}/flatmates?view=rooms`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });

  await forceEmpty(page);

  // The alert card appears in the empty state; mobile is prefilled from the user.
  const createBtn = page.getByRole('button', { name: /Create alert/i });
  await expect(createBtn).toBeVisible();
  await createBtn.click();

  await expect(page.getByText(/You’re first in line/i)).toBeVisible();

  const saved = await savedSearches(page);
  expect(saved.length).toBe(1);
  expect(saved[0].kind).toBe('flatmates');
  // Entered via the legacy `?view=rooms`; stored as the value it normalises to.
  expect(saved[0].tab).toBe('move-in');
});

test('signed-out seeker submitting the alert card is routed to sign-in (D85)', async ({ page }) => {
  await page.goto(`${BASE}/flatmates?view=rooms`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });

  await forceEmpty(page);

  const createBtn = page.getByRole('button', { name: /Create alert/i });
  await expect(createBtn).toBeVisible();
  await createBtn.click();

  await page.waitForURL(/\/signin\?reason=alerts/);
  // No local alert was written for the signed-out seeker.
  const saved = await savedSearches(page);
  expect(saved.length).toBe(0);
});

test('selecting 2 filters reveals the alert card while results remain, and captures the filters', async ({ page }) => {
  await seedUser(page);
  await page.goto(`${BASE}/flatmates?view=flatmates`);
  await page.locator('.sf-card').first().waitFor({ timeout: 10000 });

  // Baseline: with no filters active and results present, the alert card is hidden.
  await expect(page.getByRole('button', { name: /Create alert/i })).toHaveCount(0);

  // The desktop filter grid is collapsed by default so inventory clears the fold,
  // so the controls have to be revealed before they can be clicked. Targeted by
  // `aria-controls` rather than by name: there are two "Filters" buttons in the DOM
  // (a mobile drawer trigger and this one), and only one of them owns this grid.
  await page.locator('button[aria-controls="sf-desktop-filters"]').click();

  // Narrow with two filters that still leave at least one match, so we exercise
  // the "2+ filters, results present" path.
  await page.getByRole('button', { name: 'Men', exact: true }).click();
  await page.getByRole('button', { name: 'Non-smoker', exact: true }).click();
  /* Both filters have to be applied before the card count means anything, and `count()` below does
     not retry -- so the sleep here was load-bearing rather than decorative.

     The two controls are asserted differently because they ARE different, and the first draft of
     this replacement got it wrong by assuming otherwise. The lifestyle tags carry
     `aria-pressed` (FilterBar.jsx:145); the gender segment does not (FilterBar.jsx:130) and
     announces itself only through the `active` class that `seg()` appends
     (useFlatmateDiscovery.jsx:213). That asymmetry is a real accessibility gap -- a screen reader
     is told whether "Non-smoker" is on but not whether "Men" is -- and it is recorded in
     tasks/todo.md. Until it is closed, asserting `aria-pressed` on the gender button would be
     asserting something the product does not do. */
  await expect(page.getByRole('button', { name: 'Men', exact: true })).toHaveClass(/\bactive\b/);
  await expect(page.getByRole('button', { name: 'Non-smoker', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.sf-card').first()).toBeVisible();

  expect(await page.locator('.sf-card').count()).toBeGreaterThan(0);
  const createBtn = page.getByRole('button', { name: /Create alert/i });
  await expect(createBtn).toBeVisible();

  await createBtn.click();
  await expect(page.getByText(/You’re first in line/i)).toBeVisible();

  const saved = await savedSearches(page);
  expect(saved.length).toBe(1);
  expect(saved[0].kind).toBe('flatmates');
  // Entered via the legacy `?view=flatmates`; stored as the value it normalises to.
  expect(saved[0].tab).toBe('team-up');
  expect(saved[0].gender).toBe('male');
  expect(saved[0].habits).toContain('Non-smoker');
  // The label is built from `alertCriteria.js`'s word for the tab, which is the
  // user-facing name of the intent — "Team up", not the legacy alias it arrived as.
  expect(saved[0].label).toMatch(/Team up/);
});

test('dashboard Alerts panel shows the share alert with an intent badge, then toggles and deletes it', async ({ page }) => {
  await seedUser(page);
  // Pre-seed one flatmates alert under the user's mobile.
  await page.addInitScript((m) => {
    localStorage.setItem('pnSavedSearches:' + m, JSON.stringify([{
      id: 'ss-test-1', kind: 'flatmates', tab: 'rooms', locality: 'Baner', budget: 15000,
      gender: 'female', verifiedOnly: true, habits: ['Non-smoker'], alerts: true,
      channel: 'whatsapp', at: Date.now(), newCount: 0, mobile: m,
      label: 'Rooms · Baner · ≤ ₹15,000 · Women · Verified',
    }]));
  }, MOBILE);

  await page.goto(`${BASE}/dashboard#alerts`);

  // Intent badge + label render.
  await expect(page.getByText('Rooms · Baner · ≤ ₹15,000 · Women · Verified')).toBeVisible();

  // Turn alerts off through the cadence picker (D84 replaced the on/off Switch).
  const freq = page.getByTestId('alert-frequency').first();
  await freq.selectOption('off');
  /* `savedSearches()` reads the store through `page.evaluate`, which does not retry -- the sleep was
     load-bearing. Polling the same read is the honest version: it waits for the write rather than
     for a duration somebody guessed. */
  await expect.poll(async () => (await savedSearches(page))[0].alerts).toBe(false);
  let saved = await savedSearches(page);
  expect(saved[0].alerts).toBe(false);
  expect(saved[0].alertFrequency).toBe('off');

  // Delete it.
  await page.getByRole('button', { name: /Delete alert/i }).first().click();
  // The row leaving the panel is the render half of the same write the store read below checks.
  await expect(page.getByRole('button', { name: /Delete alert/i })).toHaveCount(0);
  saved = await savedSearches(page);
  expect(saved.length).toBe(0);
});
