import { test as base, expect, ACTORS } from '../../fixtures/live.js';
import { API, authHeaders } from '../../helpers/liveAuth.js';

/**
 * The operator's geo policy, end to end, against the real server.
 *
 * ## What this proves that nothing else did
 *
 * Which cities are live, where each one centres, how far it extends, and which places to hide from
 * every suggestion box were admin-owned settings that the browser read out of its own local
 * storage. The admin console wrote them to `PUT /admin/settings`; `lib/geoConfig.js` read
 * `rawDb().settings.geo`. Those are two different documents. An operator taking Mumbai live in
 * production changed a row in Postgres that no visitor's browser had ever read, and the city stayed
 * "coming soon" for everybody. The console reported success.
 *
 * A `focus` listener in `CityContext` had been added to paper over exactly this, calling
 * `syncGeoFromDisk()` to pull the persisted block back in. It could not work: its first line
 * awaited `persistLoad`, which returns `null` whenever `!import.meta.env.DEV || navigator.webdriver`
 * — so it was inert in every production build and under every Playwright run alike. The one
 * environment it functioned in was a second browser profile on a developer's own machine.
 *
 * `GET /geo` closes that. The writes below go through `PUT /admin/settings`, the only writer there
 * is; the reads are whatever the browser makes of `GET /geo` at boot. Nothing here touches what the
 * page reads. That is the point — a city is only live if the person taking it live and the person
 * shopping are looking at the same document.
 *
 * ## Why the restore is a fixture, and why it restores key by key
 *
 * `settings.geo` is one row shared by the whole run. A spec that takes Mumbai live and then fails
 * an assertion leaves it live for everything that follows, and the cascade reads as flakiness
 * rather than as the leak it is. Playwright runs fixture teardown even when the body throws.
 *
 * `PUT /admin/settings` is a **deep merge** (S60), so teardown cannot simply write back the
 * document it snapshotted: writing `{}` changes nothing, and writing `{cities: {}}` changes
 * nothing either, because objects merge key by key. Restoring therefore means naming each city this
 * spec touched and putting it back explicitly. Arrays are the exception — they replace whole, which
 * is why `blacklist` can be restored by writing the old list.
 *
 * A city that had no override before goes back as `{ live: false }` rather than disappearing. That
 * is a merge's closest reachable equivalent of absent, and it is the same answer every reader gives
 * for an unlisted city, since the built-in defaults in the client's `CITY_GEO` have Pune live and
 * nothing else.
 *
 * The snapshot is read from `GET /admin/settings` rather than from `GET /geo`, because `/geo` is
 * deliberately the *narrower* projection: it withholds the operator's private `note` on each
 * blacklist entry. Restoring from it would silently delete every reason an operator had written
 * down for hiding a place. Restore from the document you are about to overwrite, not from the
 * public view of it.
 */

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
          [...touchedCities].map((name) => [name, before.cities?.[name] ?? { live: false }]),
        );
      }
      if (touchedBlacklist) restore.blacklist = before.blacklist ?? [];
      // Absent means enforced — `geo.enforceCityLimit !== false` is how the client reads it — so an
      // untouched install restores to `true` rather than to the safer-looking `false`, which would
      // quietly unfence locality search for every spec that ran afterwards.
      if (touchedEnforce) restore.enforceCityLimit = before.enforceCityLimit ?? true;
      if (Object.keys(restore).length) await write(restore);
    }
  },
});

/** Read `GET /geo` from the page's own origin, unauthenticated — the request the client makes. */
const fetchGeo = (page) =>
  page.evaluate(async () => {
    const res = await fetch('/api/geo');
    return { status: res.status, json: await res.json() };
  });

test.describe('geo policy reaches the browser', () => {
  test('the route is public, and publishes nothing but the geo block', async ({ page, geo }) => {
    await geo.set({ enforceCityLimit: true, cities: { Mumbai: { live: true } } });

    // A real navigation first: `page.evaluate` on `about:blank` has no origin to resolve `/api`
    // against, and the failure ("Failed to parse URL") looks nothing like the missing page it is.
    await page.goto('/');
    const { status, json } = await fetchGeo(page);

    expect(status).toBe(200);
    expect(json.enforceCityLimit).toBe(true);
    expect(json.cities.Mumbai.live).toBe(true);
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
    // The reason is not. It is an internal moderation note about a real place, written for
    // colleagues, and the client has no use for it. Asserted twice: once where it would be, and
    // once across the whole document, so a `note` reappearing at another depth is caught too.
    expect(entry.note).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain('duplicate of an existing society');
  });

  test('a city taken live on the server is a destination, not a waitlist prompt', async ({ page, geo }) => {
    // The "before" is asserted against the same UI, so a pass below cannot be the picker simply
    // never gating anything.
    await page.goto('/');
    const pill = page.getByRole('button', { name: /^City: / }).first();
    await pill.click();
    await page.getByRole('listbox', { name: 'Select city' }).getByRole('button', { name: /Mumbai/ }).click();
    await expect(page.getByRole('heading', { name: /Join the Mumbai waitlist/i })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await geo.set({ cities: { Mumbai: { live: true } } });
    await page.reload();

    await pill.click();
    await page.getByRole('listbox', { name: 'Select city' }).getByRole('button', { name: /Mumbai/ }).click();

    // No waitlist. The shopper is in Mumbai, and the app agrees.
    await expect(page.getByRole('heading', { name: /Join the Mumbai waitlist/i })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Mumbai');
    await expect(pill).toHaveAttribute('aria-label', 'City: Mumbai');
  });

  test('taking a city live is visible without a reload', async ({ page, geo }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Pune');

    await geo.set({ cities: { Mumbai: { live: true } } });

    // The event the admin console fires on save. In production the operator is in the console and
    // the shopper is elsewhere; what this asserts is the half that has to work either way — that
    // the client re-reads `GET /geo` on that signal and the roster follows, rather than holding
    // the policy it fetched at boot until somebody reloads.
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('punenest-settings-change')));

    const pill = page.getByRole('button', { name: /^City: / }).first();
    await pill.click();
    await page.getByRole('listbox', { name: 'Select city' }).getByRole('button', { name: /Mumbai/ }).click();
    await expect(page.getByRole('heading', { name: /Join the Mumbai waitlist/i })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Mumbai');
  });

  test('the shortest term the server will publish is the shortest the client will match', async ({ page, geo }) => {
    // Two constants, in two languages, with nothing but a comment between them:
    // `GeoPolicyController.MIN_BLACKLIST_TERM` and the `term.length >= 2` in `isBlacklisted`. The
    // server drops any term below its threshold, so if the client's ever rose above the server's,
    // entries would arrive and be ignored; if the server's rose above the client's, entries the
    // client was ready to act on would never arrive. Both failures are silent — an operator's
    // blacklist would simply stop suppressing a place, with nothing logged and no test red.
    //
    // So the boundary is asserted from both sides in one pass: one character is refused by the
    // server, two characters is published *and* acted on by the client's own matcher.
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

    // The client half. `loadGeoPolicy` already ran at boot, so the module's cache holds the list
    // above; `geoPolicySettled()` makes that a fact rather than a race.
    const matched = await page.evaluate(async () => {
      const geoConfig = await import('/src/lib/geoConfig.js');
      await geoConfig.geoPolicySettled();
      return {
        two: geoConfig.isBlacklisted({ mainText: 'DY Patil College', secondaryText: 'Akurdi, Pune' }),
        // The one-character entry never arrived, so nothing suppresses this. If the server ever
        // started forwarding it, the client would still refuse to match — and this assertion would
        // keep passing while the two thresholds silently disagreed, which is why the wire is
        // asserted above as well.
        one: geoConfig.isBlacklisted({ mainText: 'Deccan Gymkhana', secondaryText: 'Pune' }),
      };
    });
    expect(matched.two).toBe(true);
    expect(matched.one).toBe(false);
  });

  test('a city the operator has never touched keeps its built-in policy', async ({ page, geo }) => {
    // `settings.geo` has no seeded row: the defaults live in the client's `CITY_GEO`, and the
    // stored document is overrides only. So an override for one city must say nothing about any
    // other, and Pune — which nobody has ever configured — must still be live with its localities.
    await geo.set({ cities: { Mumbai: { live: true } } });

    await page.goto('/');
    const { json } = await fetchGeo(page);
    expect(json.cities.Pune).toBeUndefined();

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Pune');
    await expect(page.getByRole('button', { name: 'Baner', exact: true })).toBeVisible();
  });
});
