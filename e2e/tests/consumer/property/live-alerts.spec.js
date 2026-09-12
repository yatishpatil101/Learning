import { test, expect, ACTORS } from '../../../fixtures/live.js';
import { API, authHeaders, signedInAs, signedInAsNew, uniqueMobile } from '../../../helpers/liveAuth.js';

/**
 * Property alerts, end to end against the live API — the retirement of `alerts.spec.js`.
 *
 * ## What the mock version was actually asserting
 *
 * Three of its four tests wrote the answer before asking the question. The dashboard test seeded
 * `dzSavedSearches:9876500088` into `localStorage`, changed the cadence picker, and then read the
 * cadence back **out of that same `localStorage` key** — so the round trip it proved was one
 * browser tab agreeing with itself. The claim being made is that `instant` and `weekly` survive an
 * off→on cycle *in stored state* (D84), and the store is a Postgres column reached over
 * `PATCH /me/saved-searches/{id}`. That write was not in the picture at all.
 *
 * The same test cannot fail for a second reason, which the live rewrite makes unavoidable to
 * notice: `SavedSearchContext.setFrequency` is **optimistic with rollback**. It moves the select
 * immediately and only then issues the PATCH, restoring the old value if the write is rejected.
 * `toHaveValue(cadence)` therefore passes on a server that returns 500 for every write, and passes
 * on a server that is not running. The only assertion that can distinguish the two is a read of the
 * record from the server, so that is what every cadence assertion below is. `remove` is optimistic
 * in the same way, so the delete is proven the same way.
 *
 * The anonymous-submit test had the mirror-image problem: it drove the admin UI to look for
 * `Top: testville`, and in mock mode both the write and the report were the same in-memory array.
 * Here the signal goes to `POST /demand-signals` and is read back off `GET /admin/supply-gap`,
 * which is the seam the feature exists on.
 *
 * ## Division of labour with the specs already on this seam
 *
 * `tests/live-demand-signals.spec.js` already proves the demand API itself — that the POST is
 * reachable unauthenticated, that the report reads it back, that the weights are 5/2/1, that the
 * report is closed to signed-out callers. None of that is repeated. What is *not* covered there,
 * and is the whole point of test 1 here, is that **the browser fires it**: that tapping "Create
 * alert" while signed out records an `alert`-kind signal against the locality that was searched,
 * before the sign-in redirect takes the page away. That ordering is the fragile part — the redirect
 * is a `navigate()` on the line after the `recordSignal()` calls, and nothing awaits them.
 *
 * `live-alert-match-count.spec.js` owns `matchCount` on both surfaces. Nothing here asserts a count.
 *
 * ## Fixtures
 *
 * A throwaway account per test, never a seeded actor: `docs/system/fixture-registry.md` publishes
 * the seeded actors' saved-search counts as invariants, on a database that lives for the whole run,
 * and both alert surfaces window their list before rendering. A unique locality slug per test for
 * the same reason on the demand side — `demand_signals` is append-only and shared by every spec in
 * the run, so a slug anyone else could touch turns a count into a race.
 */

/* A slug no locality row will ever match and no other spec will ever write, so the count for it is
   this test's alone. Lowercase and hyphenated already: `paramsToFilters` slugifies `?loc=` with
   `toLowerCase().replace(/\s+/g, '-')`, and a slug that changed shape on the way in would be
   recorded under a name this file could not then look up. */
const uniqueLocality = () => `zzalert-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** The supply-gap row for `slug`, or null when nothing has been recorded against it yet. */
async function demandRow(slug) {
  const res = await api('GET', '/admin/supply-gap', await authHeaders(ACTORS.admin));
  expect(res.status, 'reading the supply-gap report').toBe(200);
  return res.body.find((r) => r.localitySlug === slug) || null;
}

/** This account's saved searches, straight off the server — never off the screen. */
const savedSearchesOf = async (headers) => {
  const res = await api('GET', '/me/saved-searches', headers);
  expect(res.status, 'reading /me/saved-searches').toBe(200);
  return res.body;
};

/**
 * Open a listings search that is guaranteed to return nothing, and wait for the alert card.
 *
 * The empty state is the only place `NotifyMeCard` renders, and an unknown locality is the only
 * deterministic way to reach it — every other "no results" combination is one seeded listing away
 * from becoming a "some results" page. `?ptype=flat` is carried over from the mock spec for the
 * same reason it was there: it narrows the search further at no cost. It is deliberately *not*
 * asserted on the demand row, because the demand table stores a locality, a deal and a BHK and has
 * no column for a property type.
 */
async function openEmptySearch(page, slug) {
  await page.goto(`/listings?deal=rent&ptype=flat&loc=${slug}`);
  const card = page.getByText('Nothing here yet? Get there first.');
  await expect(card, 'the empty-state alert card never rendered').toBeVisible();
  return page.getByRole('button', { name: /Create alert/i });
}

test.describe('Property alerts (live)', () => {
  test('an anonymous alert submit records the demand signal before routing to sign-in (D85)', async ({ page }) => {
    const slug = uniqueLocality();

    /* The before-half matters as much as the after-half. Asserting only "there is now a row with
       alerts >= 1" would also pass against a server that had shipped this slug pre-populated, and
       — more plausibly — against a report that answers with every locality it knows regardless of
       whether anything was recorded. Null here is the proof that the row below was created by the
       click. */
    expect(await demandRow(slug), 'the slug was already known to the report').toBeNull();

    const createBtn = await openEmptySearch(page, slug);
    await page.getByRole('button', { name: 'SMS', exact: true }).click();
    await page.getByLabel('Mobile number for alerts').fill('9876500077');
    await createBtn.click();

    // D85: an anonymous visitor cannot self-serve a managed alert — the alert lives in the
    // login-only dashboard, so they are sent to sign in. `reason=alerts` is what the sign-in screen
    // reads to explain why they were interrupted.
    await page.waitForURL(/\/signin\?reason=alerts/);

    /* Polled, because nothing awaits `recordSignal` — the component fires it and calls `navigate()`
       on the next line. That is the ordering this test exists to protect: a `return` moved above
       those calls, or an `await` added to the redirect, loses the signal for exactly the cold-start
       visitor the feature was built to measure, and every visible symptom stays identical. */
    await expect.poll(
      async () => (await demandRow(slug))?.alerts ?? 0,
      { message: 'the anonymous submit never reached POST /demand-signals' },
    ).toBe(1);

    /* Named columns, not "the row changed". `alert` is a separate weighted column from `search` and
       `view`, and the submit handler picks the kind by hand; a copy-paste to `'search'` there would
       still produce a row, still move `demand`, and still leave this page behaving identically —
       which is why the assertion above is on `alerts` specifically and not on the row existing.

       `views` is the counter-anchor: a non-zero `alerts` next to a zero `views` is what makes the
       first number a measurement of this click rather than of the page.

       `searches` is deliberately NOT asserted. Listings.jsx logs a passive `search` signal for the
       same slug when the filters settle, so this row carries one from the navigation two lines up.
       That is a different feature's counter, `live-demand-signals.spec.js` owns it, and pinning a
       number on it here would make this test fail the day the page starts deferring that effect. */
    const row = await demandRow(slug);
    expect(row.views, 'a submit is not a view').toBe(0);
    // A demand row against zero supply is the shape of row the Supply Gap report exists to surface.
    expect(row.supply, 'nowhere Draazy covers should have listings').toBe(0);
  });

  test('a signed-in alert submit writes a real saved search and confirms with a link to manage it', async ({ page }) => {
    const slug = uniqueLocality();
    const mobile = await signedInAsNew(page);
    const headers = await authHeaders(mobile);

    // Positive anchor for the absence below: a brand-new account genuinely starts with none, so the
    // count after the submit is unambiguous.
    expect(await savedSearchesOf(headers), 'a new account should hold no alerts').toEqual([]);

    const createBtn = await openEmptySearch(page, slug);
    await page.getByRole('button', { name: 'SMS', exact: true }).click();
    await createBtn.click();

    // The confirmation is rendered only after the create resolves — it used to be fire-and-forget,
    // which told the user they had an alert that the server had rejected.
    await expect(page.getByText(/first in line/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /Manage my alerts/i })).toBeVisible();

    /* The claim under the confirmation: a record the dashboard can later load. The mock wrote this
       to `dzSavedSearches:<mobile>`, which no live read has ever looked at, so a build in which the
       create never left the browser would have shown the same green screen and the same green test.
       Read back through a second token for this account, so the assertion cannot be satisfied by
       anything the page is holding in memory. */
    const saved = await savedSearchesOf(headers);
    expect(saved, 'the confirmation was shown but nothing was stored').toHaveLength(1);
    const [alert] = saved;
    expect(alert.kind).toBe('listings');
    // The channel the user picked, not the default: `whatsapp` is what this field is when nobody
    // touches it, so asserting it would pass on a submit that dropped the choice entirely.
    expect(alert.channel).toBe('sms');
    expect(alert.alertFrequency).toBe('daily');
    // The searched criteria travel with the alert, or it matches the wrong homes forever. These
    // live inside the free-form `filters` blob — `savedSearchProvider` assembles it by exclusion,
    // so a facet that is dropped is dropped silently.
    expect(alert.filters?.deal).toBe('rent');
    expect(alert.filters?.localities).toContain(slug);
    expect(alert.filters?.types).toContain('flat');
  });

  test('the cadence picker round-trips through the server, including off and back on (D84)', async ({ page }) => {
    const mobile = uniqueMobile();
    const headers = await authHeaders(mobile);
    const label = `Zztest cadence ${Date.now()}`;

    const created = await api('POST', '/me/saved-searches', headers, {
      kind: 'listings',
      name: label,
      query: 'Pune',
      // The label goes *inside* `filters` because that is where the http provider looks
      // (`row.label || filters.label`); a listings alert has no top-level label column.
      filters: { label, deal: 'rent', localities: ['baner'], bhk: ['2'] },
      alertFrequency: 'daily',
      channel: 'whatsapp',
    });
    expect(created.status, 'creating the alert under test').toBe(201);
    const { id } = created.body;

    // Read the cadence off the record, not off the control. Everything below is a claim about
    // stored state; the control is optimistic and will happily show a value the server refused.
    const stored = async () => (await savedSearchesOf(headers)).find((s) => s.id === id)?.alertFrequency;

    await signedInAs(page, mobile);
    await page.goto('/dashboard#alerts');

    await expect(page.getByText(label), 'the alert never appeared in the dashboard list').toBeVisible();
    const freq = page.getByTestId('alert-frequency').first();
    // A row created with `daily` reads as `daily` rather than as an empty select: the picker
    // replaced an on/off Switch, and a row that predates the column has no stored cadence at all.
    await expect(freq).toHaveValue('daily');

    /* The two cadences the old boolean Switch could not express, each through a full off→on cycle.
       The cycle is the test: a `frequency !== 'off'` boolean written to the server and read back as
       a cadence collapses `instant` and `weekly` into `daily`, and does so only after switching
       off — which is why holding the value steady would not catch it. */
    for (const cadence of ['instant', 'weekly']) {
      await freq.selectOption(cadence);
      await expect.poll(stored, { message: `the server never stored ${cadence}` }).toBe(cadence);

      await freq.selectOption('off');
      await expect.poll(stored, { message: 'the server never stored off' }).toBe('off');
    }

    // Back to a real cadence so the delete below is removing a live alert rather than a muted one.
    await freq.selectOption('daily');
    await expect.poll(stored).toBe('daily');

    await page.getByRole('button', { name: /Delete alert/i }).click();
    await expect(page.getByText('No alerts yet')).toBeVisible();
    // `remove` is optimistic too: the empty state above appears before the DELETE is issued and
    // stays if it fails, so the row is only gone once the server says so.
    await expect.poll(
      async () => (await savedSearchesOf(headers)).length,
      { message: 'the row vanished from the screen but not from the server' },
    ).toBe(0);
  });

  test('the dashboard exposes the Saved & Activity surface that holds alerts', async ({ page }) => {
    await signedInAsNew(page);
    await page.goto('/dashboard');
    // Alerts have no tab of their own — they live inside the consolidated "Saved & Activity" tab,
    // which is the only navigable route to the panel the test above drives via `#alerts`.
    await expect(page.getByRole('button', { name: 'Saved & Activity', exact: true }).first()).toBeVisible();
  });
});
