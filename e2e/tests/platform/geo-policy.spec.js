import { test as base, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

/** Operator geo policy against the real server: console writes (`PUT /admin/settings`, `PATCH /admin/cities/{slug}`) must reach what visitors read from `GET /bootstrap`.
 * Restore is per key because `PUT /admin/settings` deep-merges (arrays replace); the snapshot comes from `GET /admin/settings`, since the `geo` projection withholds blacklist `note`s. */

const test = base.extend({
  geo: async ({}, use) => {
    let before;
    const touchedCities = new Set();
    let touchedBlacklist = false;
    let touchedEnforce = false;

    const write = async (value) => {
      const res = await fetch(`${API}/admin/settings`, {
        method: 'PUT',
        headers: await authHeaders(ACTORS.admin),
        body: JSON.stringify({ geo: value }),
      });
      if (!res.ok) throw new Error(`writing geo failed (${res.status})`);
    };

    const set = async (value) => {
      if (before === undefined) {
        const res = await fetch(`${API}/admin/settings`, {
          headers: await authHeaders(ACTORS.admin),
        });
        if (!res.ok) throw new Error(`reading admin settings failed (${res.status})`);
        before = (await res.json())?.geo ?? {};
      }
      Object.keys(value.cities ?? {}).forEach((name) => touchedCities.add(name));
      if (value.blacklist !== undefined) touchedBlacklist = true;
      if (value.enforceCityLimit !== undefined) touchedEnforce = true;
      await write(value);
    };

    await use({ set });

    if (before !== undefined) {
      const restore = {};
      if (touchedCities.size) {
        restore.cities = Object.fromEntries(
          [...touchedCities].map((name) => [
            name,
            before.cities?.[name] ?? { center: null, bounds: null },
          ]),
        );
      }
      if (touchedBlacklist) restore.blacklist = before.blacklist ?? [];
      // Absent means enforced (`geo.enforceCityLimit !== false`), so restore to `true`, not `false`, which would unfence locality search for later specs.
      if (touchedEnforce) restore.enforceCityLimit = before.enforceCityLimit ?? true;
      if (Object.keys(restore).length) await write(restore);
    }
  },
});

/* The `cities` fixture lives in `fixtures/live.js`: two copies would be two writers of one shared row with independent teardowns. */

/** Read the `geo` section of `GET /bootstrap` from the page's own origin, unauthenticated — the request the client makes. */
const fetchGeo = (page) =>
  page.evaluate(async () => {
    const res = await fetch('/api/bootstrap');
    return { status: res.status, json: (await res.json()).geo };
  });

/** Read the `cities` section of `GET /bootstrap` from the page's own origin, unauthenticated — the roster the client makes from. */
const fetchCities = (page) =>
  page.evaluate(async () => {
    const res = await fetch('/api/bootstrap');
    return { status: res.status, json: (await res.json()).cities };
  });

test.describe('geo policy reaches the browser', () => {
  test('the route is public, and publishes nothing but the geo block', async ({ page, geo }) => {
    await geo.set({ enforceCityLimit: true, cities: { Mumbai: { center: { lat: 19.076, lng: 72.8777 } } } });

    // A real navigation first: `page.evaluate` on `about:blank` has no origin to resolve `/api`
    // against, and the failure ("Failed to parse URL") looks nothing like the missing page it is.
    await page.goto('/');
    const { status, json } = await fetchGeo(page);

    expect(status).toBe(200);
    expect(json.enforceCityLimit).toBe(true);
    expect(json.cities.Mumbai.center.lat).toBe(19.076);
    expect(json.cities.Mumbai.live).toBeUndefined();
    // The settings document also holds fees, flags, movePack and the site block. None of them are
    // this route's business, and an anonymous caller must not receive them by accident.
    expect(json.fees).toBeUndefined();
    expect(json.flags).toBeUndefined();
    expect(json.movePack).toBeUndefined();
    expect(json.site).toBeUndefined();
  });

  test("an operator's reason for hiding a place is never published", async ({ page, geo }) => {
    await geo.set({
      blacklist: [{
        id: 'geo-policy-spec',
        placeId: 'ChIJ_test_geo_policy',
        term: 'Test Tower',
        note: 'duplicate of an existing society',
      }],
    });

    await page.goto('/');
    const { json } = await fetchGeo(page);

    // The entry itself is published — the client needs it to filter suggestions.
    const entry = json.blacklist.find((b) => b.id === 'geo-policy-spec');
    expect(entry.term).toBe('Test Tower');
    expect(entry.placeId).toBe('ChIJ_test_geo_policy');
    // The operator's internal `note` must not be published: asserted where it would sit and across the whole document, so a `note` at another depth is caught.
    expect(entry.note).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain('duplicate of an existing society');
  });

  test('a city taken live on the server is a destination, not a waitlist prompt', async ({ page, cities }) => {
    // The "before" is asserted against the same UI, so a pass below cannot be the picker simply
    // never gating anything.
    await page.goto('/');
    const pill = page.getByRole('button', { name: /^City: / }).first();
    await pill.click();
    await page.getByRole('listbox', { name: 'Select city' }).getByRole('button', { name: /Mumbai/ }).click();
    await expect(page.getByRole('heading', { name: /Join the Mumbai waitlist/i })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await cities.set('mumbai', true);
    await page.reload();

    await pill.click();
    await page.getByRole('listbox', { name: 'Select city' }).getByRole('button', { name: /Mumbai/ }).click();

    // No waitlist. The shopper is in Mumbai, and the app agrees.
    await expect(page.getByRole('heading', { name: /Join the Mumbai waitlist/i })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Mumbai');
    await expect(pill).toHaveAttribute('aria-label', 'City: Mumbai');
  });

  test('taking a city live is visible without a reload', async ({ page, cities }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Pune');

    await cities.set('mumbai', true);

    // Fired by the admin console on save: the client must re-read `GET /bootstrap` on that signal and the roster follow,
    // rather than keep the policy fetched at boot.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('draazy-settings-change')));

    const pill = page.getByRole('button', { name: /^City: / }).first();
    await pill.click();
    await page.getByRole('listbox', { name: 'Select city' }).getByRole('button', { name: /Mumbai/ }).click();
    await expect(page.getByRole('heading', { name: /Join the Mumbai waitlist/i })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Mumbai');
  });

  test('the shortest term the server will publish is the shortest the client will match', async ({ page, geo }) => {
    // Two constants in two languages (`GeoPolicyController.MIN_BLACKLIST_TERM`, `term.length >= 2` in
    // `isBlacklisted`); drift in either direction is silent, so assert the boundary from both sides.
    await geo.set({
      blacklist: [
        { id: 'geo-term-one', term: 'D' },
        { id: 'geo-term-two', term: 'DY' },
      ],
    });

    await page.goto('/');
    const { json } = await fetchGeo(page);
    expect(json.blacklist.find((b) => b.id === 'geo-term-one')).toBeUndefined();
    expect(json.blacklist.find((b) => b.id === 'geo-term-two')?.term).toBe('DY');

    // Await `loadGeoPolicy()` directly: `geoPolicySettled()` resolves immediately if nothing asked yet, so the
    // false probe would pass for the wrong reason about half the time.
    const matched = await page.evaluate(async () => {
      const geoConfig = await import('/src/lib/geoConfig.js');
      await geoConfig.loadGeoPolicy();
      return {
        two: geoConfig.isBlacklisted({ mainText: 'DY Patil College', secondaryText: 'Akurdi, Pune' }),
        // The one-character entry never arrived, so nothing suppresses it; the wire assertion catches drift.
        one: geoConfig.isBlacklisted({ mainText: 'Deccan Gymkhana', secondaryText: 'Pune' }),
      };
    });
    expect(matched.two).toBe(true);
    expect(matched.one).toBe(false);
  });

  test('a city the operator has never touched keeps its built-in policy', async ({ page, cities }) => {
    // `settings.geo` has no seeded row (defaults live in the client's `CITY_GEO`), so one city's override must say nothing about another and unconfigured Pune stays live.
    await cities.set('mumbai', true);

    await page.goto('/');
    const { json } = await fetchGeo(page);
    expect(json.cities.Pune).toBeUndefined();

    const { status, json: cityJson } = await fetchCities(page);
    expect(status).toBe(200);
    expect(cityJson.find((city) => city.slug === 'mumbai')?.live).toBe(true);

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Pune');
    await expect(page.getByRole('button', { name: 'Baner', exact: true })).toBeVisible();
  });
});
