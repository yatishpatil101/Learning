/**
 * The **settings console** — `/admin/settings`, General and Fees — against the live API.
 *
 * Excluded from the default run (`playwright.config.js` `testIgnore`); needs a backend on :8081
 * under the `dev,e2e` profiles and the `punenest_e2e` database. Run it explicitly:
 *
 *   cd e2e; npx playwright test tests/admin/live-settings-console.spec.js --config=playwright.config.js
 *
 * ## Why this file exists
 *
 * `tests/admin/settings.spec.js` covered the same desk in mock mode until this file replaced it and
 * it was deleted. Its two save tests asserted
 * exactly one thing each: that a toast appeared. That was a fair test of the screen while the
 * settings document lived in `localStorage`, because there a write could not fail — the toast and
 * the save were the same event. It stopped being fair the moment the document moved behind
 * `PUT /admin/settings`, and `persist()` in `AdminSettings.jsx` says so in its own comment: it was
 * rewritten to stop toasting unconditionally precisely because a 403, a 412 or a dropped connection
 * are now ordinary. "Site details saved" is therefore a *claim*, and the mock spec is structurally
 * incapable of catching it being false — it writes to the same browser store it then reads back, so
 * it passes whether or not anything left the tab.
 *
 * So the toast is the weak half of every test below and the re-read is the point. Each save is
 * followed by a fetch issued from the test process, with its own admin token, from outside the
 * browser that did the writing. Nothing the page holds in memory can make those assertions pass.
 *
 * ## The fee test reads the *public* route on purpose
 *
 * `fees.featuredListing` is not only a row in an admin-only document — `PlatformSettings` reads it
 * and `GET /pricing` publishes it to anonymous visitors. Re-reading `/admin/settings` proves the
 * write was stored; re-reading `/pricing` proves the number an owner is quoted actually moved. The
 * second is the claim the operator thought they were making when they pressed Save, and it is the
 * one that costs money when it regresses: a console that reports a price change it did not make
 * leaves the platform charging yesterday's figure while the finance desk plans on today's.
 *
 * ## What this file deliberately leaves alone
 *
 *   * The Feature-flags tab *shell* — the grouped panel, the four section headings, the Admin
 *     Modules sub-tab — belongs to `tests/platform/live-settings-debug.spec.js`, which loads this
 *     same page. Only the confirmation gate is asserted here, and only its cancel path.
 *   * What a flag does once it is on belongs to `tests/platform/live-feature-flags.spec.js`, which
 *     flips flags through the API and watches the consumer app react.
 *   * The Maps tab and the city roster belong to `tests/admin/live-city-roster.spec.js`.
 *   * The audit tab's cross-link to Staff Activity belongs to `tests/admin/live-consolidation.spec.js`.
 *
 * ## The audit-log test did not come across, and will not — reversed 2026-08-25 (D248)
 *
 * The section below is kept as written, because the reversal is only legible next to the reasoning
 * it overturns. **It no longer holds.** The screen it describes has been replaced: `AdminSettings`
 * now reads `GET /admin/audit-log` through `services/auditService.js`, the "Clear" button it does
 * not mention is deleted, and the three false passes it names ("pass on a server with no audit
 * trail at all, pass with the trail on fire, pass with the endpoint deleted") are now the three
 * failures `tests/admin/live-settings-audit.spec.js` is built to produce. Decision 39's condition
 * — "it closes only as a server-backed history surface" — is met, so the live spec this section
 * ruled out is the thing that met it. What follows is the original text:
 *
 * > The mock file's seventh test — "the Audit log tab shows the empty state for a fresh workspace" —
 * > has no live twin, and adding one would be worse than leaving the gap. It is the one claim that
 * > did not survive the deletion of that file, and this section is where it went. That tab is fed by
 * > `listAudit` / `clearAudit` from `frontend/src/lib/mockApi.js`: a log kept in the browser, written
 * > by whichever tab happened to make the change, and invisible to every other operator and to the
 * > server. Decision 39 in `tasks/DECISIONS-NEEDED.md` settled that on 2026-08-22 — the tab stays,
 * > read-only, and "closes only as a server-backed history surface". Until it is one, a live spec
 * > pointed at it would sign in against the real API, load the real page, and then assert something
 * > about `localStorage` in a fresh context. It would pass on a server with no audit trail at all,
 * > pass with the trail on fire, and pass with the endpoint deleted. A test that cannot fail for the
 * > reason it names is not coverage, it is a green tick bought on credit. The server's own trail is
 * > already asserted where it is real, in `live-city-roster` and the staff-activity specs.
 *
 * That last sentence is worth keeping in view: the trail *was* already asserted where it was real,
 * which is exactly why nobody noticed for three days that the one screen labelled "Audit log" was
 * the one place it was not.
 */

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
 * What the two blocks this file edits held before it touched them.
 *
 * Captured once rather than hard-coded, so the restore below puts back what was actually there
 * instead of what the seed says should be there — which are not the same thing on a database an
 * earlier spec in the run may already have written to.
 */
let baseline = null;

test.beforeAll(async () => {
  const doc = await settingsDoc();
  baseline = { site: doc.site ?? {}, fees: doc.fees ?? {} };
});

/**
 * Put the settings document back.
 *
 * `settings` is one row per block shared by the whole run, and a lane that leaves `fees` altered
 * does not fail here — it fails somewhere else, later, in a spec that priced something, and reads
 * as flakiness rather than as the leak it is. `live-city-roster.spec.js` restores the city roster
 * for the same reason and in the same shape: the spec that changed shared state is the spec that
 * puts it back, and Playwright runs `afterEach` even when the test body threw.
 *
 * Unconditional rather than guarded on a "did I write?" flag, because the flag is a claim about
 * what the *page* did and this teardown exists precisely for the cases where the page did something
 * unexpected. Comparing against the snapshot keeps it to one round trip when nothing moved.
 *
 * Restoring by merge is exact here, and only here: `PUT` merges rather than replaces (S60), so it
 * can put a key's value back but cannot delete a key that was added. Every test below edits a field
 * the seed already stores — `site.supportEmail`, `fees.featuredListing` — so there is no new key to
 * remove. A future test that types into `Legal name`, which the live seed leaves absent, would
 * silently leave `legalName: ""` behind and this restore would not notice.
 */
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

  /* The tab strip above is drawn from a constant and would look identical on a page that never
     reached the API, which matters more in live mode than anywhere else: `services/config.js` falls
     back to the mock provider with a `console.warn` rather than an error, so a console reading
     `settings.json` renders a perfectly plausible settings desk. The two documents disagree about
     this exact field — the mock ships `hello@punenest.com`, the seed
     `support@punenest.example.com` — so pinning the input to what `GET /admin/settings` just
     answered is what makes the rest of this file mean anything. Compared against the fetched value
     rather than a literal, so re-pricing the seed does not break the test that is not about it. */
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
  const next = `ops+${Date.now()}@punenest.example.com`;
  expect(next).not.toBe(before);

  await email.fill(next);

  /* Registered before the click, and matched on `/api/admin/settings` rather than on `settings`.
     The page's own document request is `/admin/settings` too, so a looser pattern resolves on the
     navigation that already happened and the test then races the fetch it meant to wait for —
     passing or failing on timing rather than on behaviour. Filtering on the method as well keeps it
     off the GET this screen issues on mount. */
  const saved = page.waitForResponse(
    (res) => res.url().includes('/api/admin/settings') && res.request().method() === 'PUT',
  );
  await page.getByRole('button', { name: 'Save details' }).click();
  expect((await saved).status()).toBe(200);

  // The weak half. Kept because the toast is what the operator actually reads, and `persist()` now
  // has an error branch that must not fire on a healthy write — but it proves nothing on its own.
  await expect(page.getByRole('alert')).toContainText('Site details saved');

  /* The point. A second reader, its own token, outside the browser that did the write. Read
     directly rather than polled: the 200 above was sent after `AdminSettingsService.update`'s
     transaction committed, so there is no window for this to be early. */
  expect((await settingsDoc()).site.supportEmail).toBe(next);
});

test('saving the fee schedule changes the price the public route quotes', async ({ page, login }) => {
  await login.asAdmin();
  // Deep-linked rather than clicked through the strip: `AdminSettings` drives its tabs with
  // `useTabParam`, so this is the supported entry point and it removes a click that can land before
  // the strip has mounted.
  await page.goto('/admin/settings?tab=fees');

  /* `featuredListing` of the ten fees, for two reasons. It is a plain price, so nudging it cannot
     change what any concurrent spec is *allowed* to do — unlike `freeContactLimit`, which meters
     the contact gate, or `gstPercent`, which every quoted total depends on. And it is one of the
     seven the public `/pricing` route republishes, which is what lets the last assertion here reach
     past the admin document into what a visitor is shown. */
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

  /* And served where it is charged. This is the assertion with teeth: `/pricing` is anonymous, is
     answered by `PricingController` out of `PlatformSettings` rather than out of the admin
     document, and is what the plans page quotes. A regression that stored the fee but left the
     public list on the old figure — a cache, a stale defaulting branch, a write to the wrong key —
     passes every assertion above this line and fails here. */
  expect(Number((await publicPricing()).featuredListing)).toBe(next);
});

// ─── The confirmation gate ───

test('cancelling a feature-flag confirmation leaves the flag alone on the server', async ({ page, login }) => {
  const before = (await settingsDoc()).flags ?? {};

  await login.asAdmin();

  /* Every write this screen makes goes out as a PUT to the same route, so counting them is the
     cleanest way to say "nothing was saved" — stronger than the mock's `alert` count, which is
     satisfied by a write whose toast simply had not rendered yet. Attached before the navigation so
     the mount is covered too. */
  const writes = [];
  page.on('request', (req) => {
    if (req.method() === 'PUT' && req.url().includes('/api/admin/settings')) writes.push(req.url());
  });

  await page.goto('/admin/settings?tab=flags');

  // Discovery is the default section of the Application sub-tab, so Map search is on screen without
  // any further navigation. Which flags render there is `live-settings-debug`'s claim, not this
  // one's; all that is needed here is a switch to point the gate at.
  const toggle = page.getByRole('switch', { name: 'Toggle Map search', exact: true });
  await expect(toggle).toBeVisible();
  const checked = await toggle.getAttribute('aria-checked');

  await toggle.click();

  /* The gate exists because these flags are platform-wide and several of them are destructive —
     `maintenanceMode` blanks the consumer app. `ConfirmDialog` is a plain `div`, not a `role=dialog`
     (and `getByRole('dialog')` is never unique on this app anyway, the consent bar is one too), so
     the heading is the handle. `requestAppFlagToggle` humanises the key, hence "Map Search". */
  const confirmHeading = page.getByRole('heading', { name: /(Enable|Disable) Map Search\?/ });
  await expect(confirmHeading).toBeVisible();

  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirmHeading).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-checked', checked);
  await expect(page.getByRole('alert')).toHaveCount(0);

  /* What the mock version could not say. Cancel has to be a no-op on the *server*, not merely on
     the rendered switch: an implementation that wrote first and reverted the control afterwards
     would look identical in a browser and would have left the flag flipped for every visitor. Note
     this compares the key against itself rather than against a literal — `mapSearch` is absent from
     the seeded `flags` block, and absent is a legitimate value here, so the honest test is "it is
     whatever it was". */
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

  /* The redirect is a courtesy, not a control — it is client-side routing and anyone who wants the
     document is not going to ask for it through React Router. The document carries the fee table
     and the permission map, which is why `AdminSettingsController` restricts the *read* as tightly
     as the write, and that restriction is the thing worth asserting. Only the live spec can: in
     mock mode there is no route to refuse. */
  const anonymous = await fetch(`${API}/admin/settings`);
  expect(anonymous.status).toBe(401);
});

test('a buyer is turned away by the router and by the API', async ({ page, login }) => {
  await login.asBuyer();
  await page.goto('/admin/settings');

  await page.waitForURL('**/staff-login**');
  expect(new URL(page.url()).pathname).toBe('/staff-login');
  await expect(page.getByRole('heading', { name: 'Settings' })).toHaveCount(0);

  // A signed-in consumer holds a perfectly valid token, so this is a different refusal from the one
  // above and a different bug if it breaks: 401 says "who are you", 403 says "not you". A buyer who
  // can read this document knows what every team is permitted to do and what the platform charges.
  const asBuyer = await fetch(`${API}/admin/settings`, { headers: await authHeaders(ACTORS.buyer) });
  expect(asBuyer.status).toBe(403);
});
