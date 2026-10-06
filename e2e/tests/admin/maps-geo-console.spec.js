/** Maps & Geo console writes (blacklist, city limit) read back via `GET /bootstrap` `geo` from the Node process, not the writing browser.
 * Needs backend :8081 (`local,e2e`); blacklist terms must be >= 2 chars (`MIN_BLACKLIST_TERM`) or they are stored but never published. */

import { test, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

/** Obviously synthetic, and long enough to survive `MIN_BLACKLIST_TERM`. */
const TERM = 'Zztestville';

/** Published geo policy as an anonymous visitor gets it: a bare Node `fetch` (no cookies or session), so the answer
 * cannot come from anything the page under test holds. */
async function publishedGeo() {
  const res = await fetch(`${API}/bootstrap`);
  if (!res.ok) throw new Error(`reading geo failed (${res.status})`);
  return (await res.json()).geo;
}

const publishedTerms = async () => (await publishedGeo()).blacklist.map((entry) => entry.term);

/** `settings.geo` is one row for the whole live run, so snapshot before and restore after each test (even on throw) from `GET /admin/settings`:
 * the `/bootstrap` `geo` projection omits each entry's operator `note`, so restoring from it would delete those reasons. */
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
        // Arrays replace whole under the server's deep merge, so writing back the original list restores it;
        // objects do not — see `geo-policy.spec.js`.
        blacklist: before.blacklist ?? [],
        // Absent means enforced (`geo.enforceCityLimit !== false`), so restore to `true`, not `false`, which would unfence locality search for later specs.
        enforceCityLimit: before.enforceCityLimit ?? true,
      },
    }),
  });
  if (!res.ok) throw new Error(`restoring geo failed (${res.status})`);
});

/** The panel's save, awaited by its own request rather than by the UI settling. */
const settingsSaved = (page) => page.waitForResponse(
  // The `/api/` prefix matters: `/settings` alone also matches the page's own document request,
  // so the wait would resolve on navigation and race the fetch.
  (res) => res.url().includes('/api/admin/settings') && res.request().method() === 'PUT',
);

test.describe('the maps console writes geo policy to the server', () => {
  /* The blacklist is the operator's only lever to hide a place; a write that never reaches the server still toasts "saved" and shows in their own list,
     which only a read of `GET /bootstrap` (`geo`) outside the writing tab can catch. */
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

    await expect.poll(publishedTerms).toContain(TERM);
  });

  /* A remove that never lands leaves the place hidden while the console shows it restored; the entry is seeded over the API so this
     test does not depend on the Add test above. */
  test('removing a term in the console takes it off the published policy', async ({ page, login }) => {
    const seeded = await fetch(`${API}/admin/settings`, {
      method: 'PUT',
      headers: await authHeaders(ACTORS.admin),
      body: JSON.stringify({
        geo: { blacklist: [{ id: 'bl-console-remove', term: TERM, note: 'seeded by maps-geo-console' }] },
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

  /** One boolean, so assert it on the server: "saved" and "saved locally" look identical. */
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
    // `enforceCityLimit` is published as an explicit `false`, not omitted: the client treats only that
    // as off, and omission means the panel was never opened.
    await expect.poll(async () => (await publishedGeo()).enforceCityLimit).toBe(false);

    const on = settingsSaved(page);
    await cityLimit.click();
    expect((await on).status()).toBe(200);

    await expect(cityLimit).toHaveAttribute('aria-checked', 'true');
    await expect.poll(async () => (await publishedGeo()).enforceCityLimit).toBe(true);
  });

  /** Boundary editor fail-soft hint: `GOOGLE_MAPS_HAS_DDS` derives from a build-time Vite var neither lane sets, so both render the demo-map hint;
   * live also loads real settings/cities, so the clean-console claim covers the editor mounting beside server data. The outline itself needs a vector Map ID. */
  test('the boundary editor mounts fail-soft under the demo Map ID, beside real server settings', async ({ page, login, consoleErrors }) => {
    await login.asAdmin();
    await page.goto('/admin/settings?tab=maps');

    // Positive anchor. Without it the hint assertion below could pass on a half-rendered panel,
    // and the empty-console assertion would be a claim about a page that never drew anything.
    await expect(page.getByRole('heading', { name: /City coverage/i })).toBeVisible();

    // Anchored on the copy that names the variable to set, the actionable half of the hint.
    await expect(page.getByText(/set a data-driven/i)).toBeVisible();
    await expect(page.getByText('VITE_GOOGLE_MAPS_MAP_ID', { exact: true })).toBeVisible();

    // `BoundaryHighlight` never mounts while `GOOGLE_MAPS_HAS_DDS` is false, so errors there cannot reach this.
    expect(consoleErrors).toEqual([]);
  });
});
