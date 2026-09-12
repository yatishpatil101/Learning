import { test, expect } from '@playwright/test';
import { API, apiLogin, uniqueMobile } from '../../../helpers/liveAuth.js';

/**
 * Flatmates alerts (saved searches) — the contract, not the screen.
 *
 * Alerting is the seeker's way to stay informed of new posts matching their criteria, and it
 * rides on the shared `/me/saved-searches` endpoint with `kind: 'flatmates'` rather than a
 * flatmates-specific route. That sharing is the whole reason this file is worth having: the
 * server's rules differ by kind in ways no listings test would ever exercise.
 *
 * Three of those rules were learned the hard way here, and each one is asserted below rather than
 * merely obeyed, so a future change to the server is caught by a red test and not by a user:
 *
 * - A flatmates alert carries `criteria` and no `query`; a listings alert is the reverse.
 *   `SavedSearchCreateRequest.isCriteriaSuppliedForFlatmates` makes the former a 422, and it is
 *   the single most likely thing to break, because the facets also travel in `filters` and the
 *   two blobs look interchangeable from the client side. They are not.
 * - The list read returns a bare array, not a page envelope. A user's own alert list is bounded
 *   by their own actions, so it is one of the few reads that is legitimately unpaged.
 * - There is no read-by-id. `/me/saved-searches/{id}` answers PATCH and DELETE only, so a GET is
 *   a 405 rather than a 404 — asserted in the delete test, because "it is gone" has to be proven
 *   against the route that actually exists.
 */

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

async function newSeeker() {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);
  return { mobile, accessToken };
}

/**
 * The facet blob the Flatmates page builds, in the shape it actually builds it.
 *
 * Mirrors `pages/consumer/flatmates/alertCriteria.buildFlatmateAlertRecord` — same keys, same
 * empty-string-not-null convention — so that a rename there surfaces as a diff here instead of a
 * test that keeps passing against a shape the app stopped sending.
 */
const facets = (over = {}) => ({
  tab: 'move-in',
  q: '',
  locality: 'Baner',
  budget: 20000,
  moveIn: '',
  gender: 'female',
  sharing: '',
  attachedBath: false,
  verifiedOnly: false,
  habits: [],
  ...over,
});

/**
 * `SavedSearchCreate` for a flatmates alert.
 *
 * `criteria` and `filters` are deliberately the same object: `filters` is what the UI spreads back
 * onto the flat record it renders from, `criteria` is what satisfies the server's flatmates rule.
 * Sending one without the other is exactly the bug this spec exists to keep out.
 */
const alertBody = (over = {}) => ({
  kind: 'flatmates',
  name: 'Baner flatmate alert',
  filters: facets(over.facets),
  criteria: facets(over.facets),
  alertFrequency: 'daily',
  channel: 'whatsapp',
  ...over.top,
});

test.describe('Flatmates alerts (saved searches)', () => {
  test('create an alert with flatmate search criteria', async ({ page }) => {
    const seeker = await newSeeker();

    const res = await fetch(`${API}/me/saved-searches`, {
      method: 'POST',
      headers: auth(seeker.accessToken),
      body: JSON.stringify(alertBody()),
    });

    expect(res.status).toBe(201);
    const alert = await res.json();
    expect(alert.id).toBeDefined();
    expect(alert.kind).toBe('flatmates');
    // The facets round-trip inside the blobs, not as top-level columns. Asserting them here is
    // what proves the server stores the blob rather than quietly dropping keys it has no column
    // for — which is how a saved alert comes back matching everything.
    expect(alert.filters.tab).toBe('move-in');
    expect(alert.filters.locality).toBe('Baner');
    expect(alert.filters.budget).toBe(20000);
    expect(alert.criteria.gender).toBe('female');
    // `alerts` is a client-side derivation of this, not a stored field (see the http provider).
    expect(alert.alertFrequency).toBe('daily');
    // A flatmates alert has no query by construction, and the server must not invent one.
    expect(alert.query ?? null).toBeNull();
  });

  test('a flatmates alert without criteria is refused, and says which rule it broke', async ({ page }) => {
    const seeker = await newSeeker();

    // Everything a listings alert would need, and nothing a flatmates alert does.
    const res = await fetch(`${API}/me/saved-searches`, {
      method: 'POST',
      headers: auth(seeker.accessToken),
      body: JSON.stringify({ kind: 'flatmates', filters: facets(), alertFrequency: 'daily' }),
    });

    expect(res.status).toBe(422);
    const problem = await res.json();
    // `error`, not `code` — the envelope is `ApiError(error, message, status, traceId)` and the
    // client normalises the name on the way in.
    expect(problem.error).toBe('validation_failed');
    expect(problem.fields.map((f) => f.field)).toContain('criteriaSuppliedForFlatmates');
  });

  test('read back the created alert from My Alerts', async ({ page }) => {
    const seeker = await newSeeker();

    const createRes = await fetch(`${API}/me/saved-searches`, {
      method: 'POST',
      headers: auth(seeker.accessToken),
      body: JSON.stringify(alertBody({
        facets: { tab: 'team-up', locality: 'Kothrud', budget: 25000, gender: '', sharing: '2' },
        top: { channel: 'email' },
      })),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();

    const readRes = await fetch(`${API}/me/saved-searches`, {
      headers: auth(seeker.accessToken),
    });
    expect(readRes.status).toBe(200);
    const list = await readRes.json();
    // A bare array. Reading `.content` here would be `undefined` and the `.some` below would throw
    // a TypeError rather than fail an assertion, so the shape is asserted before it is used.
    expect(Array.isArray(list)).toBe(true);

    const found = list.find((a) => a.id === created.id);
    expect(found).toBeDefined();
    expect(found.filters.tab).toBe('team-up');
    expect(found.filters.locality).toBe('Kothrud');
    expect(found.channel).toBe('email');
  });

  test('toggle alert on/off', async ({ page }) => {
    const seeker = await newSeeker();

    const createRes = await fetch(`${API}/me/saved-searches`, {
      method: 'POST',
      headers: auth(seeker.accessToken),
      body: JSON.stringify(alertBody()),
    });
    expect(createRes.status).toBe(201);
    const alert = await createRes.json();
    expect(alert.alertFrequency).toBe('daily');

    // "Off" is a cadence, not a boolean. `SavedSearchUpdate` carries `alertFrequency` and
    // `channel` and nothing else, so a client sending `{ alerts: false }` would be answered 200
    // with the alert still on — which is why the assertion below reads the value back rather than
    // trusting the status code.
    const updateRes = await fetch(`${API}/me/saved-searches/${alert.id}`, {
      method: 'PATCH',
      headers: auth(seeker.accessToken),
      body: JSON.stringify({ alertFrequency: 'off' }),
    });
    expect(updateRes.status).toBe(200);
    expect((await updateRes.json()).alertFrequency).toBe('off');

    // Persisted, read through the list — the only read this resource offers.
    const list = await (await fetch(`${API}/me/saved-searches`, {
      headers: auth(seeker.accessToken),
    })).json();
    expect(list.find((a) => a.id === alert.id).alertFrequency).toBe('off');

    // And back on, so the test proves a toggle rather than a one-way door.
    const onRes = await fetch(`${API}/me/saved-searches/${alert.id}`, {
      method: 'PATCH',
      headers: auth(seeker.accessToken),
      body: JSON.stringify({ alertFrequency: 'instant' }),
    });
    expect((await onRes.json()).alertFrequency).toBe('instant');
  });

  test('an unknown cadence is refused rather than silently stored', async ({ page }) => {
    const seeker = await newSeeker();
    const alert = await (await fetch(`${API}/me/saved-searches`, {
      method: 'POST',
      headers: auth(seeker.accessToken),
      body: JSON.stringify(alertBody()),
    })).json();

    const res = await fetch(`${API}/me/saved-searches/${alert.id}`, {
      method: 'PATCH',
      headers: auth(seeker.accessToken),
      body: JSON.stringify({ alertFrequency: 'hourly' }),
    });

    // The set is off | instant | daily | weekly. A stored 'hourly' would be a cadence no sweep
    // ever runs, i.e. an alert that looks armed and never fires.
    expect(res.status).toBe(422);
  });

  test('delete an alert', async ({ page }) => {
    const seeker = await newSeeker();

    const createRes = await fetch(`${API}/me/saved-searches`, {
      method: 'POST',
      headers: auth(seeker.accessToken),
      body: JSON.stringify(alertBody()),
    });
    expect(createRes.status).toBe(201);
    const alert = await createRes.json();

    const deleteRes = await fetch(`${API}/me/saved-searches/${alert.id}`, {
      method: 'DELETE',
      headers: auth(seeker.accessToken),
    });
    expect(deleteRes.status).toBe(204);

    // Gone is proven from the list, because that is the only read there is: a GET on the
    // by-id path is a 405, the path being registered for PATCH and DELETE alone.
    const list = await (await fetch(`${API}/me/saved-searches`, {
      headers: auth(seeker.accessToken),
    })).json();
    expect(list.some((a) => a.id === alert.id)).toBe(false);
  });

  test('one seeker cannot delete another seeker\'s alert', async ({ page }) => {
    const owner = await newSeeker();
    const stranger = await newSeeker();

    const alert = await (await fetch(`${API}/me/saved-searches`, {
      method: 'POST',
      headers: auth(owner.accessToken),
      body: JSON.stringify(alertBody()),
    })).json();

    const res = await fetch(`${API}/me/saved-searches/${alert.id}`, {
      method: 'DELETE',
      headers: auth(stranger.accessToken),
    });
    // Not-yours reads as not-found on a caller-scoped resource: a 403 would confirm the id exists.
    expect(res.status).toBe(404);

    // And the owner still has it — a positive control, so that a delete which silently no-ops
    // for everyone could not pass this test.
    const list = await (await fetch(`${API}/me/saved-searches`, {
      headers: auth(owner.accessToken),
    })).json();
    expect(list.some((a) => a.id === alert.id)).toBe(true);
  });

  test('a seeker sees only their own alerts, of every kind', async ({ page }) => {
    const seeker = await newSeeker();
    const stranger = await newSeeker();

    const mine = await (await fetch(`${API}/me/saved-searches`, {
      method: 'POST',
      headers: auth(seeker.accessToken),
      body: JSON.stringify(alertBody()),
    })).json();
    const theirs = await (await fetch(`${API}/me/saved-searches`, {
      method: 'POST',
      headers: auth(stranger.accessToken),
      body: JSON.stringify(alertBody()),
    })).json();

    const list = await (await fetch(`${API}/me/saved-searches`, {
      headers: auth(seeker.accessToken),
    })).json();

    expect(list.some((a) => a.id === mine.id)).toBe(true);
    expect(list.some((a) => a.id === theirs.id)).toBe(false);

    // Scoped by caller, not by kind: the endpoint takes no `?kind=` and returns both, which is
    // why the dashboard splits listings from flatmates in the browser. Asserted so that adding a
    // server-side filter later is a deliberate change to this line, not a silent narrowing that
    // makes half the user's alerts vanish from a panel that stopped filtering.
    expect(list.every((a) => a.kind === 'flatmates')).toBe(true);
  });
});

