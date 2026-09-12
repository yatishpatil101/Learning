/**
 * LIVE: how many listings match this alert — counted by the database, not by one page of it.
 *
 * ## The bug this suite exists to keep closed
 *
 * The notifications screen and the dashboard retention strip both rendered "N properties match your
 * search". Both got N by asking the catalogue for a page of listings and filtering that page in the
 * browser. The page was `PAGE_SIZE = 100`. So the number was right only for as long as the whole
 * catalogue fitted in one page — 38 fixtures at the time — and would quietly become a *maximum* the
 * day it did not. Not an error, not a blank: a smaller number, rendered with full confidence.
 *
 * The guard that was supposed to catch this, `warnIfTruncated`, could not fire below the same
 * ceiling, and was a `console.warn`, which the e2e runner discards. Register item 33.
 *
 * The fix is `matchCount` on the saved-search resource: a `count(*)` over the same three facets the
 * alert sweep already uses, computed on every read. This file asserts the property the browser
 * could never have: **the count is of the catalogue, not of a page of the catalogue.**
 *
 * ## Why the assertions are shaped the way they are
 *
 * The strongest available check is cross-endpoint parity — `matchCount` for a `deal`-only alert must
 * equal `totalElements` from the public search for the same deal. Those are two independent code
 * paths (a JPQL count vs. a Criteria specification) reaching the same rows, so agreement is
 * meaningful and drift in either one breaks this test.
 *
 * Parity is deliberately *not* asserted for the locality facet. The public search matches
 * `localitySlug` exactly; the alert count matches `coalesce(localitySlug, locality)`, because an
 * alert saved before the locality was curated still has to count. For a single-word locality those
 * two agree, and for a row with no slug they do not — a real and intended difference, not a bug, and
 * not something to pin a fixture-dependent equality on.
 *
 *   cd e2e; npx playwright test tests/platform/live-saved-search-match-count.spec.js --config=playwright.config.js
 */
import { expect, test } from '../../fixtures/live.js';
import { API, authHeaders, uniqueMobile } from '../../helpers/liveAuth.js';

const SAVED_SEARCHES = '/me/saved-searches';

async function api(method, path, headers, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

/** A fresh signed-in user, so no case in this file can see another's alerts. */
async function user() {
  const mobile = uniqueMobile();
  return { mobile, headers: await authHeaders(mobile) };
}

/**
 * The catalogue's own answer to the same question, asked of the public search.
 *
 * `size=1` on purpose: we want `totalElements`, and asking for one row proves the number does not
 * come from counting what was returned.
 */
async function publicTotal(query) {
  const res = await api('GET', `/properties?${query}&size=1`, { Accept: 'application/json' });
  expect(res.status).toBe(200);
  return res.body.totalElements;
}

function saveAlert(headers, { name, kind = 'listings', query, filters }) {
  return api('POST', SAVED_SEARCHES, headers, {
    name,
    kind,
    query,
    filters,
    criteria: null,
    alertFrequency: null,
    channel: null,
  });
}

test.describe('LIVE — saved-search match count', () => {
  test('a deal-only alert counts the whole catalogue, not one page of it', async () => {
    const u = await user();
    const rentTotal = await publicTotal('deal=rent');

    const created = await saveAlert(u.headers, {
      name: 'Everything for rent',
      query: 'rent',
      filters: { deal: 'rent' },
    });

    expect(created.status).toBe(201);
    expect(created.body.matchCount).toBe(rentTotal);
    // The point of the fix: whatever the catalogue's size, the count is not silently a page of it.
    expect(rentTotal).toBeGreaterThan(0);
  });

  test('the count is on the list read too, not only on the create response', async () => {
    const u = await user();
    const created = await saveAlert(u.headers, {
      name: 'Rentals again',
      query: 'rent',
      filters: { deal: 'rent' },
    });
    expect(created.status).toBe(201);

    const list = await api('GET', SAVED_SEARCHES, u.headers);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].matchCount).toBe(created.body.matchCount);
  });

  test('the two counts are different questions — nothing is new on a search saved just now', async () => {
    const u = await user();
    const created = await saveAlert(u.headers, {
      name: 'New vs total',
      query: 'rent',
      filters: { deal: 'rent' },
    });

    expect(created.status).toBe(201);
    // `newCount` is "what arrived since the last sweep baseline"; a brand-new alert has no baseline
    // and therefore nothing new. `matchCount` answers "what is there at all" and is not zero.
    expect(created.body.newCount).toBe(0);
    expect(created.body.matchCount).toBeGreaterThan(0);
  });

  test('every facet narrows, and narrowing never grows the count', async () => {
    const u = await user();
    const broad = await saveAlert(u.headers, {
      name: 'Broad',
      query: 'rent',
      filters: { deal: 'rent' },
    });
    const narrow = await saveAlert(u.headers, {
      name: 'Narrow',
      query: 'rent 2bhk',
      filters: { deal: 'rent', bhk: [2] },
    });

    expect(broad.status).toBe(201);
    expect(narrow.status).toBe(201);
    expect(narrow.body.matchCount).toBeLessThanOrEqual(broad.body.matchCount);
    expect(narrow.body.matchCount).toBe(await publicTotal('deal=rent&bhk=2'));
  });

  test('a locality nobody has listed in counts zero rather than falling back to everything', async () => {
    const u = await user();
    const res = await saveAlert(u.headers, {
      name: 'Nowhere',
      query: 'rent nowhere',
      filters: { deal: 'rent', localities: ['d227-no-such-locality'] },
    });

    expect(res.status).toBe(201);
    expect(res.body.matchCount).toBe(0);
  });

  test('an alert with no deal counts nothing, because it has not said what to count', async () => {
    const u = await user();
    const res = await saveAlert(u.headers, {
      name: 'No deal',
      query: 'anything',
      filters: { localities: ['baner'] },
    });

    expect(res.status).toBe(201);
    expect(res.body.matchCount).toBe(0);
  });

  test('a flatmates alert reports zero — this count does not cover rooms', async () => {
    const u = await user();
    const res = await api('POST', SAVED_SEARCHES, u.headers, {
      name: 'Flatmates',
      kind: 'flatmates',
      query: 'flatmate baner',
      filters: {},
      criteria: { gender: 'any', budgetMax: 20000 },
      alertFrequency: null,
      channel: null,
    });

    expect(res.status).toBe(201);
    expect(res.body.kind).toBe('flatmates');
    expect(res.body.matchCount).toBe(0);
  });

  test('editing the cadence does not blank the count', async () => {
    const u = await user();
    const created = await saveAlert(u.headers, {
      name: 'Cadence',
      query: 'rent',
      filters: { deal: 'rent' },
    });
    expect(created.status).toBe(201);

    const patched = await api('PATCH', `${SAVED_SEARCHES}/${created.body.id}`, u.headers, {
      alertFrequency: 'daily',
      channel: null,
    });

    expect(patched.status).toBe(200);
    expect(patched.body.alertFrequency).toBe('daily');
    expect(patched.body.matchCount).toBe(created.body.matchCount);
  });

  test('the count is per caller: one user cannot read another user s alerts at all', async () => {
    const mine = await user();
    const theirs = await user();
    const created = await saveAlert(mine.headers, {
      name: 'Private',
      query: 'rent',
      filters: { deal: 'rent' },
    });
    expect(created.status).toBe(201);

    const list = await api('GET', SAVED_SEARCHES, theirs.headers);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(0);
  });

  test('anonymous callers get no count because they get no alerts', async () => {
    const res = await api('GET', SAVED_SEARCHES, { Accept: 'application/json' });
    expect(res.status).toBe(401);
  });
});
