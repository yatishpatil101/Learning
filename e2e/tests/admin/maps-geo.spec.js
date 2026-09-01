import { test, expect } from '../../fixtures/base.js';

/* Admin control for the Google Places geo policy (Settings ▸ Maps).
 *
 * ## Why only one test is left here
 *
 * This file also asserted that the city-limit toggle and the locality/society blacklist "persist to
 * settings.geo" — by reading `puneNestDB_v5` back out of the same browser the write had gone to.
 * That was a fair test while `lib/geoConfig.js` was the store. Geo policy is server-owned now: the
 * console writes `PUT /admin/settings` and every visitor is served the result from `GET /geo`, so
 * the assertion had quietly become a round trip through the writer. It would have passed whether or
 * not anything left the tab — which is the precise failure this migration exists to remove, and the
 * more dangerous one here than elsewhere, because the blacklist fails *open*: a write that never
 * reached the server looks identical to a working one until someone searches for the hidden place.
 *
 * Its three real claims now live where they can fail for the reason they name, in
 * `admin/live-maps-geo-console.spec.js`: a blacklisted term hidden on the public `GET /geo` a
 * logged-out shopper reads, a removed term taken back off that published policy, and the city-limit
 * switch read back from the server rather than off the control. The per-city launch toggle went to
 * `admin/live-city-roster.spec.js` when the roster moved to `PATCH /admin/cities/{slug}`.
 *
 * The boundary editor below stays on the mock deliberately, and is the reason this file survives at
 * all: there is no server claim in it. It asserts what the panel *renders* when Google hands it the
 * built-in demo Map ID — a fail-soft path that exercises the same component either way, and that a
 * live backend could neither confirm nor deny.
 */

test.describe('Maps & Places admin control', () => {
  test('boundary editor renders with a fail-soft outline hint under the demo Map ID', async ({ page, login, consoleErrors }) => {
    // The visual boundary editor now highlights a searched place's REAL Google boundary
    // polygon (data-driven styling) — but only with a proper vector Map ID. Under the
    // built-in DEMO_MAP_ID it must degrade gracefully: the rectangle editor still works
    // and a hint tells the operator how to enable the outline. This asserts that fail-soft
    // path (the live-boundary render itself needs a configured Map ID + Google boundary
    // data, which isn't available in test).
    await login.asAdmin();
    await page.goto('/admin/settings?tab=maps');

    await expect(page.getByRole('heading', { name: /City coverage/i })).toBeVisible();
    // Fail-soft hint appears because the demo Map ID has no data-driven styling.
    await expect(page.getByText(/set a data-driven/i)).toBeVisible();

    // The panel mounted without throwing (boundary layer setup is best-effort/guarded).
    expect(consoleErrors).toEqual([]);
  });
});
