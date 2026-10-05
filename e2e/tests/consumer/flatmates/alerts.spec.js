import { test, expect } from '@playwright/test';
import { API, apiLogin, uniqueMobile } from '../../../helpers/liveAuth.js';

/* Flatmates share `/me/saved-searches` with listings but invert the payload rules: `criteria`,
   no `query`, a bare-array list, and no read-by-id. */

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

async function newSeeker() {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);
  return { mobile, accessToken };
}

/* Mirrors the page's facet blob, including empty strings, so page-side renames surface here instead
   of passing against a stale test shape. */
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

/* `filters` feeds the UI and `criteria` satisfies the server rule; sending only one is the bug this
   spec keeps out. */
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
  test('alert CRUD: create keeps the facets, My Alerts reads them back, and the cadence toggles', async () => {
    const seeker = await newSeeker();
    const post = (body) => fetch(`${API}/me/saved-searches`, {
      method: 'POST',
      headers: auth(seeker.accessToken),
      body: JSON.stringify(body),
    });
    let alert;

    await test.step('create an alert with flatmate search criteria', async () => {
      const res = await post(alertBody());

      expect(res.status).toBe(201);
      alert = await res.json();
      expect(alert.id).toBeDefined();
      expect(alert.kind).toBe('flatmates');
      // Facets must survive inside the blobs; dropping uncolumned keys makes a saved alert match
      // everything.
      expect(alert.filters.tab).toBe('move-in');
      expect(alert.filters.locality).toBe('Baner');
      expect(alert.filters.budget).toBe(20000);
      expect(alert.criteria.gender).toBe('female');
      // `alerts` is a client-side derivation of this, not a stored field (see the http provider).
      expect(alert.alertFrequency).toBe('daily');
      expect(alert.channel).toBe('push');
      // A flatmates alert has no query by construction, and the server must not invent one.
      expect(alert.query ?? null).toBeNull();
    });

    await test.step('read back the created alerts from My Alerts', async () => {
      const createRes = await post(alertBody({
        facets: { tab: 'team-up', locality: 'Kothrud', budget: 25000, gender: '', sharing: '2' },
        top: { channel: 'email' },
      }));
      expect(createRes.status).toBe(201);
      const created = await createRes.json();

      const whatsappRes = await post(alertBody({
        facets: { tab: 'move-in', locality: 'Wakad', budget: 22000, gender: 'male' },
        top: { name: 'Wakad flatmate alert', channel: 'whatsapp' },
      }));
      expect(whatsappRes.status).toBe(201);
      const whatsappCreated = await whatsappRes.json();

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
      expect(found.channel).toBe('push');

      const whatsappFound = list.find((a) => a.id === whatsappCreated.id);
      expect(whatsappFound).toBeDefined();
      expect(whatsappFound.filters.locality).toBe('Wakad');
      expect(whatsappFound.channel).toBe('push');
    });

    await test.step('toggle alert on/off', async () => {
      // "Off" is a cadence, not a boolean; read the value back because `{ alerts: false }` would be
      // accepted without changing this field.
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

    await test.step('an alert without criteria is refused and names the broken rule', async () => {
      const res = await post({ kind: 'flatmates', filters: facets(), alertFrequency: 'daily' });

      expect(res.status).toBe(422);
      const problem = await res.json();
      expect(problem.error).toBe('validation_failed');
      expect(problem.fields.map((f) => f.field)).toContain('criteriaSuppliedForFlatmates');
    });

    await test.step('a stranger cannot delete the alert and the owner still has it', async () => {
      const stranger = await newSeeker();
      const res = await fetch(`${API}/me/saved-searches/${alert.id}`, {
        method: 'DELETE',
        headers: auth(stranger.accessToken),
      });
      // Not-yours reads as not-found; a 403 would confirm the id exists.
      expect(res.status).toBe(404);

      const list = await (await fetch(`${API}/me/saved-searches`, {
        headers: auth(seeker.accessToken),
      })).json();
      expect(list.some((a) => a.id === alert.id)).toBe(true);
    });

    await test.step('the list is scoped to the caller, not to a kind', async () => {
      const stranger = await newSeeker();
      const theirs = await (await fetch(`${API}/me/saved-searches`, {
        method: 'POST',
        headers: auth(stranger.accessToken),
        body: JSON.stringify(alertBody()),
      })).json();

      const list = await (await fetch(`${API}/me/saved-searches`, {
        headers: auth(seeker.accessToken),
      })).json();

      expect(list.some((a) => a.id === alert.id)).toBe(true);
      expect(list.some((a) => a.id === theirs.id)).toBe(false);
      expect(list.every((a) => a.kind === 'flatmates')).toBe(true);
    });
  });
});
