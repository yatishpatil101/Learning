/* The **settings console** — `/admin/settings`, General and Fees. The toast is the weak half of
   every test and the re-read is the point: each save is re-fetched outside the writing browser. */

import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

/** The configuration document as the server holds it — never as the browser remembers it. */
async function settingsDoc() {
  const res = await fetch(`${API}/admin/settings`, { headers: await authHeaders(ACTORS.admin) });
  if (!res.ok) throw new Error(`reading settings failed (${res.status})`);
  return await res.json();
}

/** The public price list, which is where `fees` ends up in front of a visitor. */
async function publicPricing() {
  const res = await fetch(`${API}/pricing`);
  if (!res.ok) throw new Error(`reading pricing failed (${res.status})`);
  return await res.json();
}

async function writeSettings(patch) {
  const res = await fetch(`${API}/admin/settings`, {
    method: 'PUT',
    headers: await authHeaders(ACTORS.admin),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`restoring settings failed (${res.status})`);
}

/**
 * What the two blocks this file edits held before it touched them — captured rather than hard-coded,
 * because an earlier spec in the run may already have written to this shared row.
 */
let baseline = null;

test.beforeAll(async () => {
  const doc = await settingsDoc();
  baseline = { site: doc.site ?? {}, fees: doc.fees ?? {} };
});

/* `settings` is one row shared by the whole run, so an altered `fees` fails somewhere else later
   and reads as flakiness. Merge-restore is exact only while every test edits a key the seed has. */
test.afterEach(async () => {
  if (!baseline) return;
  const now = await settingsDoc();
  const patch = {};
  if (JSON.stringify(now.site ?? {}) !== JSON.stringify(baseline.site)) patch.site = baseline.site;
  if (JSON.stringify(now.fees ?? {}) !== JSON.stringify(baseline.fees)) patch.fees = baseline.fees;
  if (Object.keys(patch).length) await writeSettings(patch);
});

// ─── The desk itself ───

test('admin opens the settings desk and the general form is filled from the server', async ({ page, login, consoleErrors }) => {
  const stored = await settingsDoc();

  await login.asAdmin();
  await page.goto('/admin/settings');

  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  await expect(page.getByRole('button', { name: 'General', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fees', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Maps', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Feature flags', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Audit log', exact: true })).toBeVisible();

  await expect(page.getByRole('button', { name: 'Save details' })).toBeVisible();

  /* The tab strip is drawn from a constant and would look identical on a page that never reached
     the API. Pinning the input to what `GET /admin/settings` just answered is what makes the rest of
     this file mean anything; compared against the fetched value so re-pricing the seed is harmless. */
  await expect(page.getByRole('textbox', { name: 'Support email', exact: true }))
    .toHaveValue(stored.site.supportEmail);

  expect(consoleErrors).toEqual([]);
});

// ─── Saving, and the half the mock could not see ───

test('saving site details puts the new value in the document, not just in a toast', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/settings');

  const email = page.getByRole('textbox', { name: 'Support email', exact: true });
  await expect(email).toBeVisible();
  const before = await email.inputValue();
  const next = `ops+${Date.now()}@draazy.example.com`;
  expect(next).not.toBe(before);

  await email.fill(next);

  /* Matched on `/api/admin/settings` and on the method: the page's own document request is
     `/admin/settings` too, so a looser pattern resolves on the navigation and races the fetch. */
  const saved = page.waitForResponse(
    (res) => res.url().includes('/api/admin/settings') && res.request().method() === 'PUT',
  );
  await page.getByRole('button', { name: 'Save details' }).click();
  expect((await saved).status()).toBe(200);

  // The weak half. Kept because the toast is what the operator actually reads, and `persist()` now
  // has an error branch that must not fire on a healthy write — but it proves nothing on its own.
  await expect(page.getByRole('alert')).toContainText('Site details saved');

  /* The point: a second reader, its own token, outside the browser that did the write. The 200 was
     sent after the update transaction committed, so there is no window for this to be early. */
  expect((await settingsDoc()).site.supportEmail).toBe(next);
});

test('saving the fee schedule changes the price the public route quotes', async ({ page, login }) => {
  await login.asAdmin();
  // Deep-linked rather than clicked: `AdminSettings` drives its tabs with `useTabParam`, so this is
  // the supported entry point and it removes a click that can land before the strip has mounted.
  await page.goto('/admin/settings?tab=fees');

  /* `featuredListing` is a plain price, so nudging it cannot change what a concurrent spec is
     allowed to do (unlike `freeContactLimit` or `gstPercent`), and it is republished by the public
     `/pricing` route — which is what lets the last assertion reach into what a visitor is shown. */
  const fee = page.getByRole('spinbutton', { name: 'Featured Listing' });
  await expect(fee).toBeVisible();
  const before = Number(await fee.inputValue());
  // Relative to whatever is stored, so the test carries no opinion about the seeded price, and well
  // inside `PlatformSettings.MAX_PRICE` (100,000) so nothing is clamped on the way back out.
  const next = before + 7;

  await fee.fill(String(next));

  const saved = page.waitForResponse(
    (res) => res.url().includes('/api/admin/settings') && res.request().method() === 'PUT',
  );
  await page.getByRole('button', { name: 'Save fees' }).click();
  expect((await saved).status()).toBe(200);

  await expect(page.getByRole('alert')).toContainText('Fee schedule saved');

  // Stored where the console will read it back.
  expect(Number((await settingsDoc()).fees.featuredListing)).toBe(next);

  /* The assertion with teeth: `/pricing` is anonymous and answered out of `PlatformSettings` rather
     than the admin document, so a write to the wrong key or a stale cache fails only here. */
  expect(Number((await publicPricing()).featuredListing)).toBe(next);
});

// ─── The confirmation gate ───

test('cancelling a feature-flag confirmation leaves the flag alone on the server', async ({ page, login }) => {
  const before = (await settingsDoc()).flags ?? {};

  await login.asAdmin();

  /* Every write this screen makes is a PUT to the same route, so counting them is the cleanest way
     to say "nothing was saved". Attached before the navigation so the mount is covered too. */
  const writes = [];
  page.on('request', (req) => {
    if (req.method() === 'PUT' && req.url().includes('/api/admin/settings')) writes.push(req.url());
  });

  await page.goto('/admin/settings?tab=flags');

  // Discovery is the default section of the Application sub-tab, so Map search is on screen without
  // further navigation. Which flags render there is another spec's claim, not this one's.
  const toggle = page.getByRole('switch', { name: 'Toggle Map search', exact: true });
  await expect(toggle).toBeVisible();
  const checked = await toggle.getAttribute('aria-checked');

  await toggle.click();

  /* `ConfirmDialog` is a plain `div`, not a `role=dialog` (and `getByRole('dialog')` is never unique
     here — the consent bar is one too), so the heading is the handle. */
  const confirmHeading = page.getByRole('heading', { name: /(Enable|Disable) Map Search\?/ });
  await expect(confirmHeading).toBeVisible();

  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirmHeading).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-checked', checked);
  await expect(page.getByRole('alert')).toHaveCount(0);

  /* Cancel has to be a no-op on the *server*: an implementation that wrote first and reverted the
     control afterwards looks identical in the browser. Compared key-against-key rather than against
     a literal, because `mapSearch` is absent from the seed and absent is a legitimate value. */
  expect(writes).toEqual([]);
  const after = (await settingsDoc()).flags ?? {};
  expect(after.mapSearch).toEqual(before.mapSearch);
});

// ─── Who may open it ───

test('an unauthenticated visitor is turned away by the router and by the API', async ({ page }) => {
  await page.goto('/admin/settings');

  await page.waitForURL('**/staff-login**');
  expect(new URL(page.url()).pathname).toBe('/staff-login');
  await expect(page.getByRole('heading', { name: 'Settings' })).toHaveCount(0);

  /* The redirect is a courtesy, not a control. The document carries the fee table and the permission
     map, so the API must refuse the *read* as tightly as the write — that is the claim here. */
  const anonymous = await fetch(`${API}/admin/settings`);
  expect(anonymous.status).toBe(401);
});

test('a buyer is turned away by the router and by the API', async ({ page, login }) => {
  await login.asBuyer();
  await page.goto('/admin/settings');

  await page.waitForURL('**/staff-login**');
  expect(new URL(page.url()).pathname).toBe('/staff-login');
  await expect(page.getByRole('heading', { name: 'Settings' })).toHaveCount(0);

  // A signed-in consumer holds a valid token, so this is a different refusal and a different bug:
  // 401 says "who are you", 403 says "not you".
  const asBuyer = await fetch(`${API}/admin/settings`, { headers: await authHeaders(ACTORS.buyer) });
  expect(asBuyer.status).toBe(403);
});
