/** Admin city roster (Settings ▸ Maps) against the live API: launch state is a `cities` column read via `GET /bootstrap`, written by `PATCH /admin/cities/{slug}`.
 * Needs backend :8081 (`local,e2e`); a missing roster must not drop the blacklist (fails open) nor be replaced by a guessed city list. */

import { test, expect } from '../../fixtures/live.js';
import { ACTORS } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

/** The roster as the server tells it — never as the browser remembers it. */
async function roster() {
  const res = await fetch(`${API}/bootstrap`);
  if (!res.ok) throw new Error(`reading cities failed (${res.status})`);
  return (await res.json()).cities;
}

const liveness = async (slug) => (await roster()).find((c) => c.slug === slug)?.live;

/** Restores launched cities: the seed sets `live` on INSERT only, so the roster is shared across a live run. */
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

  test('a roster that will not load shows nothing rather than a guess, and does not un-hide blacklisted places', async ({ page, login }) => {
    await login.asAdmin();
    await test.step('a roster that will not load shows nothing rather than a guess', async () => {
      // Fail the public read that carries the roster. The panel's own map policy comes from
      // `/admin/settings`, which stays healthy: map coverage to render and no launch state to render.
      await page.route('**/api/bootstrap', (route) => route.abort());
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
    await test.step('a missing roster does not silently un-hide blacklisted places', async () => {
      // Serve `/bootstrap` with its `cities` section dropped and its `geo` section intact.
      await page.unroute('**/api/bootstrap');
      await page.route('**/api/bootstrap', async (route) => {
        const res = await route.fetch();
        const { cities: _dropped, ...rest } = await res.json();
        await route.fulfill({ response: res, json: rest });
      });
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
        await page.goto('/admin/settings?tab=maps');

        // The blacklist survived a missing roster: the geo section is applied on its own.
        await expect(page.getByText('Kharadi')).toBeVisible();

        // Use `loadGeoPolicy()`, not `geoPolicySettled()`: an `import()` inside `evaluate` has a cold cache that settles instantly
        // from the built-ins, so the test would pass for the wrong reason.
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

