/** LIVE: `matchCount` must count the whole catalogue, not a browser-filtered page. Checked by parity with the
 * public search totalElements; locality is excluded as alerts match coalesce(localitySlug, locality). */
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

/** `size=1` on purpose: one row proves `totalElements` is not derived from counting what was returned. */
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
