/**
 * The **Maps & Geo console's own write path**, against the live API — Settings ▸ Maps.
 *
 * Excluded from the default run (`playwright.config.js` `testIgnore`); needs a backend on :8081
 * under the `dev,e2e` profiles and the `punenest_e2e` database. Run it explicitly:
 *
 *   cd e2e; npx playwright test tests/admin/live-maps-geo-console.spec.js --config=playwright.live.config.js
 *
 * ## What this file owns
 *
 * The blacklist and the city-limit switch are the two controls on this panel that decide what a
 * *logged-out* visitor is shown — which places every locality search box in the product will
 * suggest, and whether those suggestions are fenced to the selected city or merely biased toward
 * it. Both are written by the panel through `saveGeo()` → `persist()` → `updateSettings()`, which
 * is `PUT /admin/settings`, and read back by everyone through the public `GET /geo`.
 *
 * This spec drives those controls with a mouse and then reads the result back over `GET /geo` with
 * a plain `fetch` **in the test process** — a different HTTP client, no session, and crucially not
 * the browser that performed the write. That is the whole point of live mode. A test that re-reads
 * the panel, or that reads through `page.evaluate`, is asserting against the same client-side state
 * the write went to and would pass whether or not anything left the browser.
 *
 * ## What the mock twin could not prove
 *
 * `tests/admin/maps-geo.spec.js` covers the same three controls, and its `readGeo` helper reads
 * `puneNestDB_v5` out of `localStorage` — the very store the mock provider wrote to. It passes on
 * an app whose console never talks to a server at all. That failure mode is not hypothetical: the
 * entire `GET /geo` route exists because the console's writes were reaching Postgres while every
 * consumer read the browser's own copy, so an operator could blacklist a society, be told it saved,
 * and have it hidden for nobody.
 *
 * ## What it leaves alone
 *
 *   - `platform/live-geo-policy.spec.js` owns the **consumer** half: that `/geo` is public, that it
 *     publishes nothing but the geo block, and that an operator's private `note` never reaches an
 *     anonymous caller. It writes the policy with `fetch`, so it says nothing about the console.
 *   - `admin/live-city-roster.spec.js` owns launch state (`PATCH /admin/cities/{slug}`,
 *     `GET /cities`) and the panel's fail-soft behaviour when the roster will not load. It only
 *     *reads* the blacklist, as a bystander.
 *
 * Between the three, the round trip is closed at both ends: the console writes it, the server
 * stores it, an anonymous visitor reads it.
 *
 * ## A blacklist term must be at least two characters
 *
 * `GeoPolicyController.MIN_BLACKLIST_TERM` drops shorter terms on the wire, because
 * `isBlacklisted` will not test a one-character substring — it would match most of Pune. A
 * single-character probe would therefore be stored and never published, and this file would fail
 * for a reason that has nothing to do with the console. `Zztestville` is obviously synthetic and
 * safely long.
 */

import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

/** Obviously synthetic, and long enough to survive `MIN_BLACKLIST_TERM`. */
const TERM = 'Zztestville';

/**
 * The published geo policy, as an anonymous visitor receives it.
 *
 * A bare `fetch` from the Node test process on purpose: no cookie jar, no session, and no
 * relationship to the browser that did the write. `page.evaluate(() => fetch('/api/geo'))` would
 * also reach the server, but it would run inside the tab under test, and a reviewer could not tell
 * at a glance that the answer had not come from something the page was holding.
 */
async function publishedGeo() {
  const res = await fetch(`${API}/geo`);
  if (!res.ok) throw new Error(`reading geo failed (${res.status})`);
  return await res.json();
}

const publishedTerms = async () => (await publishedGeo()).blacklist.map((entry) => entry.term);

/**
 * `settings.geo` is one row shared by the whole live run, so the spec that changes it is the spec
 * that puts it back. The snapshot is taken before each test and written back after, including when
 * the body throws — a lane that leaves the blacklist or the city limit altered would silently
 * change what every locality search in every following spec is allowed to suggest.
 *
 * The snapshot comes from `GET /admin/settings` rather than from `GET /geo`, for the reason
 * `live-geo-policy.spec.js` sets out at length: `/geo` is deliberately the narrower projection and
 * withholds each entry's operator `note`, so restoring from it would quietly delete every reason
 * somebody had written down for hiding a place.
 */
let before;

test.beforeEach(async () => {
  const res = await fetch(`${API}/admin/settings`, { headers: await authHeaders(ACTORS.admin) });
  if (!res.ok) throw new Error(`reading admin settings failed (${res.status})`);
  before = (await res.json())?.geo ?? {};
});

test.afterEach(async () => {
  const res = await fetch(`${API}/admin/settings`, {
    method: 'PUT',
    headers: await authHeaders(ACTORS.admin),
    body: JSON.stringify({
      geo: {
        // Arrays replace whole under the server's deep merge, so writing the old list is a true
        // restore. Objects would not be — see the key-by-key restore in `live-geo-policy.spec.js`.
        blacklist: before.blacklist ?? [],
        // Absent means enforced — the client's test is `geo.enforceCityLimit !== false` — so an
        // install that had never set it restores to `true` rather than to the safer-looking
        // `false`, which would quietly unfence locality search for everything that runs next.
        enforceCityLimit: before.enforceCityLimit ?? true,
      },
    }),
  });
  if (!res.ok) throw new Error(`restoring geo failed (${res.status})`);
});

/** The panel's save, awaited by its own request rather than by the UI settling. */
const settingsSaved = (page) => page.waitForResponse(
  // The `/api/` prefix is load-bearing. A matcher of `/settings` alone also matches this page's own
  // document request at `/admin/settings`, so the wait would resolve on the navigation and the test
  // would race the fetch it meant to await — passing before the write had happened at all.
  (res) => res.url().includes('/api/admin/settings') && res.request().method() === 'PUT',
);

test.describe('the maps console writes geo policy to the server', () => {
  /**
   * The blacklist is the operator's only lever for taking a place out of the product's suggestions
   * — a duplicate society, a building that keeps attracting fraudulent listings, an address ops has
   * been asked to stop surfacing. If the console's write does not reach the server, the operator is
   * told it saved (the panel toasts on a resolved `persist()`), the term appears in their own list,
   * and every shopper in the country goes on being offered the place. That is the precise failure
   * `GET /geo` was opened to end, and it is invisible to any assertion made inside the tab that did
   * the writing.
   */
  test("a term blacklisted in the console is hidden for every visitor, not just in the operator's tab", async ({ page, login }) => {
    await login.asAdmin();
    await page.goto('/admin/settings?tab=maps');
    await expect(page.getByRole('heading', { name: /Blacklisted localities/i })).toBeVisible();

    expect(await publishedTerms()).not.toContain(TERM);

    await page.getByPlaceholder(/name\/term to hide/i).fill(TERM);
    await page.getByPlaceholder('Reason (optional)').fill('live console write-path probe');

    const saved = settingsSaved(page);
    await page.getByRole('button', { name: /^Add$/ }).click();
    expect((await saved).status()).toBe(200);

    // The panel agrees with itself, which is all the mock twin ever checked.
    await expect(page.getByText(TERM, { exact: true })).toBeVisible();

    // And now the assertion that matters: read the published policy back from outside the browser
    // that wrote it. This is what the mock-mode version structurally cannot do, because there the
    // store being read is the store that was written.
    await expect.poll(publishedTerms).toContain(TERM);
  });

  /**
   * Removal is the half that fails quietly. An add that never lands is at least visible the next
   * time the operator reloads the panel; a remove that never lands leaves the place hidden while
   * the console shows it as restored, so nobody goes looking. Owners whose building is blacklisted
   * by mistake cannot list it, and the screen that would explain why says the block was lifted.
   *
   * The entry is seeded over the API rather than by re-driving the Add control, so this test does
   * not depend on the one above and does not silently become a second copy of it.
   */
  test('removing a term in the console takes it off the published policy', async ({ page, login }) => {
    const seeded = await fetch(`${API}/admin/settings`, {
      method: 'PUT',
      headers: await authHeaders(ACTORS.admin),
      body: JSON.stringify({
        geo: { blacklist: [{ id: 'bl-console-remove', term: TERM, note: 'seeded by live-maps-geo-console' }] },
      }),
    });
    expect(seeded.ok).toBe(true);
    expect(await publishedTerms()).toContain(TERM);

    await login.asAdmin();
    await page.goto('/admin/settings?tab=maps');

    const remove = page.getByRole('button', { name: `Remove ${TERM}` });
    await expect(remove).toBeVisible();

    const saved = settingsSaved(page);
    await remove.click();
    expect((await saved).status()).toBe(200);

    await expect(remove).toHaveCount(0);

    // Read back from outside the browser again. A panel that has dropped the row from its own React
    // state proves nothing about what the next visitor's suggestion box will filter.
    await expect.poll(publishedTerms).not.toContain(TERM);
  });

  /**
   * The city limit decides whether a locality search is hard-fenced to the selected city's bounds
   * or merely biased toward them. Left on when the operator turned it off, a shopper searching in
   * Pune sees only Pune and the operator cannot work out why the places they deliberately opened up
   * never appear. Turned off when the operator wanted it on, every suggestion box in the product
   * starts offering addresses in other districts, which then flow into listings, filters and
   * society pickers as coverage the platform does not have.
   *
   * It is a single boolean, which is exactly why it is worth an assertion against the server:
   * nothing about the switch's appearance distinguishes "saved" from "saved locally".
   */
  test('the city-limit switch is readable back from the server', async ({ page, login }) => {
    await login.asAdmin();
    await page.goto('/admin/settings?tab=maps');

    const cityLimit = page.getByRole('switch', { name: /Restrict Places to selected city/i });
    await expect(cityLimit).toBeVisible();
    // The shipped policy fences searches; absent in the document reads as `true` on the client.
    await expect(cityLimit).toHaveAttribute('aria-checked', 'true');

    const off = settingsSaved(page);
    await cityLimit.click();
    expect((await off).status()).toBe(200);

    await expect(cityLimit).toHaveAttribute('aria-checked', 'false');
    // Read back from outside the browser. `enforceCityLimit` is published as an explicit `false`
    // rather than omitted, which is the difference between "the operator unfenced search" and "the
    // operator has never opened this panel" — the client treats only the first as off.
    await expect.poll(async () => (await publishedGeo()).enforceCityLimit).toBe(false);

    const on = settingsSaved(page);
    await cityLimit.click();
    expect((await on).status()).toBe(200);

    await expect(cityLimit).toHaveAttribute('aria-checked', 'true');
    await expect.poll(async () => (await publishedGeo()).enforceCityLimit).toBe(true);
  });
});
