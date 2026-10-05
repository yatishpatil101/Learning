import { test, expect } from '@playwright/test';
import { API, apiLogin, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';

/* `/me/flatmate-requests` is the host's inbox (what seekers sent), not to be confused with
   `/me/flatmate-posts`, which is the seeker's own authored posts. */

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const track = flatmateCleanup(test);

async function newHost() {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);
  return { mobile, accessToken };
}

async function approve(id) {
  const { accessToken } = await apiLogin(ACTORS.admin);
  const res = await fetch(`${API}/admin/flatmates/${id}/moderation`, {
    method: 'PATCH',
    headers: auth(accessToken),
    body: JSON.stringify({ modStatus: 'live', note: 'e2e' }),
  });
  expect(res.status, await res.clone().text()).toBeLessThan(300);
}

test.describe('Host flatmate requests inbox (live API)', () => {
  test('404 when trying to access with invalid request ID', async () => {
    const host = await newHost();

    const res = await fetch(`${API}/me/flatmate-requests/00000000-0000-0000-0000-000000000000`, {
      method: 'PATCH',
      headers: auth(host.accessToken),
      body: JSON.stringify({ decision: 'accepted' }),
    });

    expect(res.status).toBe(404);
  });

  test('another host cannot decide a different host\'s request', async () => {
    const host1 = await newHost();
    const host2 = await newHost();
    const seeker = await newHost();

    // A restricted policy queues the join as pending; policy 'any' accepts it outright.
    const created = await fetch(`${API}/flatmates/groups`, {
      method: 'POST',
      headers: auth(host1.accessToken),
      body: JSON.stringify({
        title: `Inbox owner ${Date.now().toString(36)}`, name: 'Host', locality: 'Baner', rent: 30000,
        seats: 2, seatsOpen: 1, policy: 'women', role: 'tenant',
      }),
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const group = await created.json();
    track('groups', group.id, host1.accessToken);
    await approve(group.id);

    const join = await fetch(`${API}/flatmates/groups/${group.id}/join`, {
      method: 'POST',
      headers: auth(seeker.accessToken),
      body: JSON.stringify({}),
    });
    expect(join.status, await join.clone().text()).toBe(201);

    const inbox = await (await fetch(`${API}/me/flatmate-requests?size=100`, {
      headers: auth(host1.accessToken),
    })).json();
    expect(inbox.content.length, 'host1 received the seeker\'s request').toBeGreaterThan(0);
    const requestId = inbox.content[0].id;

    const res = await fetch(`${API}/me/flatmate-requests/${requestId}`, {
      method: 'PATCH',
      headers: auth(host2.accessToken),
      body: JSON.stringify({ decision: 'accepted' }),
    });
    // 404, not 403, so the inbox does not leak which request ids exist.
    expect(res.status).toBe(404);

    const after = await (await fetch(`${API}/me/flatmate-requests?size=100`, {
      headers: auth(host1.accessToken),
    })).json();
    expect(after.content.find((r) => r.id === requestId).status, 'the refused decision changed nothing').toBe('pending');
  });
});
