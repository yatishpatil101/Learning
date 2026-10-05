// The **settings console** — `/admin/settings`, General and Fees.
import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

// The configuration document as the server holds it — never as the browser remembers it.
async function settingsDoc() {
  const res = await fetch(`${API}/admin/settings`, { headers: await authHeaders(ACTORS.admin) });
  if (!res.ok) throw new Error(`reading settings failed (${res.status})`);
  return await res.json();
}

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

// Snapshot shared settings because earlier specs may already have edited the row.
let baseline = null;

test.beforeAll(async () => {
  const doc = await settingsDoc();
  baseline = { site: doc.site ?? {}, fees: doc.fees ?? {} };
});

// `settings` is one shared row; restore touched fees or later specs look flaky.
test.afterEach(async () => {
  if (!baseline) return;
  const now = await settingsDoc();
  const patch = {};
  if (JSON.stringify(now.site ?? {}) !== JSON.stringify(baseline.site)) patch.site = baseline.site;
  if (JSON.stringify(now.fees ?? {}) !== JSON.stringify(baseline.fees)) patch.fees = baseline.fees;
  if (Object.keys(patch).length) await writeSettings(patch);
});

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

  // The tab strip is drawn from a constant and would look identical on a page that never reached the API.
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

  // Match API path and method; `/admin/settings` navigation would race the fetch.
  const saved = page.waitForResponse(
    (res) => res.url().includes('/api/admin/settings') && res.request().method() === 'PUT',
  );
  await page.getByRole('button', { name: 'Save details' }).click();
  expect((await saved).status()).toBe(200);

  // The weak half. Kept because the toast is what the operator actually reads, and `persist()` now
  // has an error branch that must not fire on a healthy write — but it proves nothing on its own.
  await expect(page.getByRole('alert')).toContainText('Site details saved');

  // The point: a second reader, its own token, outside the browser that did the write.
  expect((await settingsDoc()).site.supportEmail).toBe(next);
});

test('saving the fee schedule changes the price the public route quotes', async ({ page, login }) => {
  await login.asAdmin();
  // Deep-linked rather than clicked: `AdminSettings` drives its tabs with `useTabParam`, so this is
  // the supported entry point and it removes a click that can land before the strip has mounted.
  await page.goto('/admin/settings?tab=fees');

  // `featuredListing` is safe to nudge and republishes through anonymous `/pricing`.
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

  expect(Number((await settingsDoc()).fees.featuredListing)).toBe(next);

  // Anonymous `/pricing` catches wrong keys and stale public settings caches.
  expect(Number((await publicPricing()).featuredListing)).toBe(next);
});

test('saving the photo limit writes the listings block the public policy route answers from', async ({ page, login }) => {
  await login.asAdmin();
  await page.goto('/admin/settings');

  const field = page.getByRole('spinbutton', { name: 'Max photos per listing' });
  await expect(field).toBeVisible();
  const current = Number(await field.inputValue());
  expect((await (await fetch(`${API}/listing-policy`)).json()).maxPhotos).toBe(current);

  // Every save is a PUT to this route, so zero PUTs proves cancel wrote nothing.
  const writes = [];
  page.on('request', (req) => {
    if (req.method() === 'PUT' && req.url().includes('/api/admin/settings')) writes.push(req.postDataJSON());
  });

  await field.fill('25');
  await page.getByRole('button', { name: 'Save photo limit' }).click();
  await expect(page.getByRole('alert')).toContainText('Choose a whole number from 3 to 20.');
  // Browser state can be reverted after a write; the server must see no write at all.
  expect(writes).toEqual([]);

  await field.fill(String(current));
  const saved = page.waitForResponse(
    (res) => res.url().includes('/api/admin/settings') && res.request().method() === 'PUT',
  );
  await page.getByRole('button', { name: 'Save photo limit' }).click();
  expect((await saved).status()).toBe(200);
  expect(writes).toEqual([{ listings: { maxPhotos: current } }]);
  await expect(page.getByRole('alert').filter({ hasText: 'Photo limit saved' })).toBeVisible();
  expect((await settingsDoc()).listings.maxPhotos).toBe(current);
});

test('cancelling a feature-flag confirmation leaves the flag alone on the server', async ({ page, login }) => {
  const before = (await settingsDoc()).flags ?? {};

  await login.asAdmin();

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

  // ConfirmDialog has no unique dialog role here, so its heading is the handle.
  const confirmHeading = page.getByRole('heading', { name: /(Enable|Disable) Map Search\?/ });
  await expect(confirmHeading).toBeVisible();

  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirmHeading).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-checked', checked);
  await expect(page.getByRole('alert')).toHaveCount(0);

  expect(writes).toEqual([]);
  const after = (await settingsDoc()).flags ?? {};
  expect(after.mapSearch).toEqual(before.mapSearch);
});

test('the settings API refuses an anonymous caller and a signed-in buyer', async () => {
  const anonymous = await fetch(`${API}/admin/settings`);
  expect(anonymous.status).toBe(401);

  // A buyer holds a valid token: 401 says "who are you", 403 says "not you".
  const asBuyer = await fetch(`${API}/admin/settings`, { headers: await authHeaders(ACTORS.buyer) });
  expect(asBuyer.status).toBe(403);
});
