import { test, expect } from '@playwright/test';
import { API, apiLogin, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

async function newHost() {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);
  return { mobile, accessToken };
}

const track = flatmateCleanup(test);

async function createGroup(accessToken, overrides = {}) {
  const res = await fetch(`${API}/flatmates/groups`, {
    method: 'POST',
    headers: auth(accessToken),
    body: JSON.stringify({
      title: `Test Group ${Number(uniqueMobile()).toString(36)}`,
      name: 'Asha K',
      locality: 'Baner',
      rent: 40000,
      seats: 3,
      seatsOpen: 1,
      policy: 'any',
      role: 'tenant',
      ...overrides,
    }),
  });
  expect(res.status).toBe(201);
  const group = await res.json();
  track('groups', group.id, accessToken);
  return group;
}
/** Move a seat. The only route that can. */
const setSeats = (token, groupId, seatsOpen) =>
  fetch(`${API}/flatmates/groups/${groupId}/seats`, {
    method: 'PATCH',
    headers: auth(token),
    body: JSON.stringify({ seatsOpen }),
  });

async function approve(groupId) {
  const { accessToken } = await apiLogin(ACTORS.admin);
  const res = await fetch(`${API}/admin/flatmates/${groupId}/moderation`, {
    method: 'PATCH',
    headers: auth(accessToken),
    body: JSON.stringify({ modStatus: 'live', note: 'e2e' }),
  });
  expect(res.status).toBeLessThan(300);
}

test.describe('Backfill a seat', () => {
  test('seats open cannot go below zero', async ({ page }) => {
    const host = await newHost();
    const group = await createGroup(host.accessToken, { seats: 2, seatsOpen: 1 });

    const updateRes = await setSeats(host.accessToken, group.id, -1);
    // 422 — `@Min(0)` on the request record, so it never reaches the service.
    expect(updateRes.status).toBe(422);
    // And nothing moved. Without this the test would pass equally if the refusal were returned
    // after the write.
    const after = await (await fetch(`${API}/me/flatmate-groups`, {
      headers: auth(host.accessToken),
    })).json();
    expect(after.content.find((g) => g.id === group.id).seatsOpen).toBe(1);

    const over = await setSeats(host.accessToken, group.id, 12);
    expect(over.status).toBe(400);
    expect((await over.json()).message).toContain('11');
    const afterOver = await (await fetch(`${API}/me/flatmate-groups`, {
      headers: auth(host.accessToken),
    })).json();
    expect(afterOver.content.find((g) => g.id === group.id).seatsOpen).toBe(1);
  });

  test('a join takes a seat, and the host can backfill it', async ({ page }) => {
    const host = await newHost();
    const joiner = await newHost();
    const group = await createGroup(host.accessToken, { seats: 3, seatsOpen: 2, policy: 'any' });
    await approve(group.id);

    const joinRes = await fetch(`${API}/flatmates/groups/${group.id}/join`, {
      method: 'POST',
      headers: auth(joiner.accessToken),
      body: JSON.stringify({ share: 'solo' }),
    });
    expect(joinRes.status).toBe(201);

    const mine = async () => (await (await fetch(`${API}/me/flatmate-groups`, {
      headers: auth(host.accessToken),
    })).json()).content.find((g) => g.id === group.id);
    expect((await mine()).seatsOpen).toBe(1);
    expect((await setSeats(host.accessToken, group.id, 2)).status).toBe(200);
    const after = await mine();
    expect(after.seatsOpen).toBe(2);
    expect(after.seatsTotal).toBe(4);
    expect((await setSeats(host.accessToken, group.id, 11)).status).toBe(400);
  });
});
