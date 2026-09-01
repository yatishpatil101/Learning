/**
 * The **city roster** in the admin console — Settings ▸ Maps — against the live API.
 *
 * Excluded from the default run (`playwright.config.js` `testIgnore`); needs a backend on :8081
 * under the `dev,e2e` profiles and the `punenest_e2e` database. Run it explicitly:
 *
 *   cd e2e; npx playwright test tests/admin/live-city-roster.spec.js --config=playwright.live.config.js
 *
 * ## Why this file exists
 *
 * City launch state used to live in `settings.geo.cities[name].live` — an admin-only document read
 * by an anonymous city picker, which is the same hole `/flags` and `/geo` were opened to close. It
 * is now a column on the `cities` table: served by `GET /cities` (public) and written by
 * `PATCH /admin/cities/{slug}` (admin + `settings:write`, audited).
 *
 * `tests/admin/maps-geo.spec.js` used to cover the same panel in mock mode and could not tell that
 * story: the mock provider wrote the roster into the same `localStorage` the assertions read back,
 * so it passed whether or not the write ever left the browser. That file has since been retired
 * outright. Everything below reads the roster from the API with a token of its own.
 *
 * ## The two failure paths, which are the point of the file
 *
 * Both are regressions this slice could have shipped, and neither is reachable in mock mode, because
 * the mock roster cannot fail:
 *
 *   1. **A failing `/cities` must not take the blacklist with it.** `loadGeoPolicy()` fetches the
 *      geo policy and the roster together. Written with `Promise.all`, a 502 on the roster discards
 *      a perfectly healthy `/geo` response — and the blacklist's default is *empty*, so it fails
 *      **open**: every place the operator went out of their way to hide comes back. `allSettled`
 *      is the fix, and the third test is what holds it in place.
 *   2. **A roster that failed to load must not be replaced by a guess.** The panel used to fall back
 *      to a client-side city list with slugs invented by lowercasing display names. Those happen to
 *      match the seed today, so the launch toggle would appear to work while writing against a key
 *      the server may not have. Showing nothing is the honest answer; the second test asserts it.
 */

import { test, expect } from '../../fixtures/live.js';
import { ACTORS } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

/** The roster as the server tells it — never as the browser remembers it. */
async function roster() {
  const res = await fetch(`${API}/cities`);
  if (!res.ok) throw new Error(`reading cities failed (${res.status})`);
  return await res.json();
}

const liveness = async (slug) => (await roster()).find((c) => c.slug === slug)?.live;

/**
 * Restore every city this file launched.
 *
 * The seed cannot do it: `R__seed_reference_data.sql` sets `live` on INSERT only now, precisely so
 * that a re-seed cannot un-launch what ops launched. That makes the roster genuinely shared state
 * across a live run, so the spec that changed it is the spec that puts it back.
 */
test.afterEach(async () => {
  for (const city of await roster()) {
    if (city.live !== (city.slug === 'pune')) {
      await fetch(`${API}/admin/cities/${city.slug}`, {
        method: 'PATCH',
        headers: await authHeaders(ACTORS.admin),
        body: JSON.stringify({ live: city.slug === 'pune' }),
      });
    }
  }
});

test.describe('the admin city roster is server-owned', () => {
  test('the launch toggle writes through to the catalogue, not to the browser', async ({ page, login }) => {
    await login.asAdmin();
    await page.goto('/admin/settings?tab=maps');

    await page.getByRole('button', { name: /Mumbai/ }).first().click();
    const mumbai = page.getByRole('switch', { name: /Set Mumbai live/i });
    await expect(mumbai).toHaveAttribute('aria-checked', 'false');

    await mumbai.click();

    // Read back over the API, from outside the browser that did the write. This is the assertion the
    // mock-mode version of this test structurally cannot make.
    await expect.poll(() => liveness('mumbai')).toBe(true);
    await expect(mumbai).toHaveAttribute('aria-checked', 'true');

    // And the public roster is what a logged-out shopper reads, so the change is visible to them
    // too — the whole reason launch state stopped living in the admin-only settings document.
    await page.goto('/');
    await page.getByRole('button', { name: /^City:/ }).click();
    await page.getByRole('button', { name: 'Mumbai', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Mumbai');
  });

  test('a roster that will not load shows nothing rather than a guess', async ({ page, login }) => {
    await login.asAdmin();
    // Fail only the roster. `/geo` stays healthy, which is the situation that matters: the panel has
    // map coverage to render and no launch state to render.
    await page.route('**/api/cities', (route) => route.abort());
    await page.goto('/admin/settings?tab=maps');

    await expect(page.getByText(/city roster could not be loaded/i)).toBeVisible();
    // No switch at all. A disabled one would be defensible; a working-looking one built on a guessed
    // slug is what this asserts against.
    await expect(page.getByRole('switch', { name: /Set .* live/i })).toHaveCount(0);

    // The rest of the panel is unaffected — the roster and the map policy are two different reads,
    // and one being down must not take the other with it.
    await expect(page.getByRole('switch', { name: /Restrict Places to selected city/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Blacklisted localities/i })).toBeVisible();
  });

  test('a failing roster does not silently un-hide blacklisted places', async ({ page, login }) => {
    // Hide a place through the real settings document first.
    const res = await fetch(`${API}/admin/settings`, {
      method: 'PUT',
      headers: await authHeaders(ACTORS.admin),
      body: JSON.stringify({
        geo: { blacklist: [{ id: 'bl-roster-probe', term: 'Kharadi' }] },
      }),
    });
    expect(res.ok).toBe(true);

    try {
      await login.asAdmin();
      await page.route('**/api/cities', (route) => route.abort());
      await page.goto('/admin/settings?tab=maps');

      // The blacklist survived a failed roster fetch. Under `Promise.all` this list would be empty:
      // the roster's rejection would have thrown away the `/geo` response that carries it, and the
      // client would be suppressing nothing while believing it had no policy to apply.
      await expect(page.getByText('Kharadi')).toBeVisible();

      // `loadGeoPolicy()` rather than `geoPolicySettled()`: an `import()` from inside `evaluate`
      // hands back a module whose cache is cold, so waiting on it settles instantly and answers
      // from the built-ins — which would pass this test for the wrong reason once and fail it
      // forever after. Driving the load here is also the stronger probe: `/api/cities` is aborted
      // for the duration, so the blacklist can only be non-empty if the two reads were settled
      // independently. Swap the `Promise.allSettled` in `loadGeoPolicy` for `Promise.all` and this
      // goes red.
      const blacklisted = await page.evaluate(async () => {
        const geoConfig = await import('/src/lib/geoConfig.js');
        await geoConfig.loadGeoPolicy();
        return geoConfig.isBlacklisted({ mainText: 'Kharadi', secondaryText: 'Pune' });
      });
      expect(blacklisted).toBe(true);
    } finally {
      await fetch(`${API}/admin/settings`, {
        method: 'PUT',
        headers: await authHeaders(ACTORS.admin),
        body: JSON.stringify({ geo: { blacklist: [] } }),
      });
    }
  });

  test('the retired settings key is refused, so a stale console cannot write a dead launch flag', async () => {
    const res = await fetch(`${API}/admin/settings`, {
      method: 'PUT',
      headers: await authHeaders(ACTORS.admin),
      body: JSON.stringify({ geo: { cities: { Mumbai: { live: true } } } }),
    });

    expect(res.status).toBe(422);
    // The message has to name the replacement, or the operator is told "no" and nothing else.
    expect(JSON.stringify(await res.json())).toContain('/admin/cities/{slug}');

    // And the refusal was total: Mumbai is still where the roster left it.
    expect(await liveness('mumbai')).toBe(false);
  });
});

