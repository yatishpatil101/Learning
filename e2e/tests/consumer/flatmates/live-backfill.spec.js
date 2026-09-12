import { test, expect } from '@playwright/test';
import { API, apiLogin, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';

/**
 * Backfill a seat — seat management on a flatmate group.
 *
 * A host lists a group with some seats open; people join and leave; the count has to follow. The
 * whole feature is one sub-resource, `PATCH /flatmates/groups/{id}/seats`, and the interesting
 * part is what it refuses:
 *
 * - Below zero is a bean-validation refusal (`@Min(0)` on the request record) — 422.
 * - Above `seatsTotal` is a service refusal, because the ceiling is a property of the stored
 *   group rather than of the payload — 400.
 *
 * The two are asserted separately and exactly. An `expect([200, 400, 422]).toContain(status)`
 * would pass whether the seat moved or not, which is the one thing this file exists to check.
 *
 * `seatsTotal` itself is immutable: no route changes it after create. A host who takes on a
 * fourth flatmate has to delete the group and post it again.
 */

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

async function newHost() {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);
  return { mobile, accessToken };
}

/**
 * `FlatmateGroupCreate` — note `seats`, not `seatsTotal`. The response renames it, the request
 * does not accept the renamed form, and `name` (the host's, not the group's) is mandatory.
 */
const track = flatmateCleanup(test);

async function createGroup(accessToken, overrides = {}) {
  const res = await fetch(`${API}/flatmates/groups`, {
    method: 'POST',
    headers: auth(accessToken),
    body: JSON.stringify({
      title: `Test Group ${uniqueMobile()}`,
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

/** Let a group out of moderation — a new group is `pending` and no seeker can see it. */
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
  test('a group displays the correct number of open seats', async ({ page }) => {
    const host = await newHost();
    const group = await createGroup(host.accessToken, { seats: 3, seatsOpen: 1 });

    expect(group.seatsTotal).toBe(3);
    expect(group.seatsOpen).toBe(1);
  });

  test('host reopens a seat when a flatmate leaves', async ({ page }) => {
    const host = await newHost();
    const group = await createGroup(host.accessToken, { seats: 3, seatsOpen: 1 });

    const updateRes = await setSeats(host.accessToken, group.id, 2);

    expect(updateRes.status).toBe(200);
    const updated = await updateRes.json();
    expect(updated.seatsOpen).toBe(2);
    // The ceiling is untouched — this route moves the open count and nothing else.
    expect(updated.seatsTotal).toBe(3);
  });

  test('host marks the last open seat as filled, and the group is full', async ({ page }) => {
    const host = await newHost();
    const group = await createGroup(host.accessToken, { seats: 2, seatsOpen: 1 });

    const updateRes = await setSeats(host.accessToken, group.id, 0);
    expect(updateRes.status).toBe(200);
    expect((await updateRes.json()).seatsOpen).toBe(0);

    // "Full" is not a flag the API carries; it is `seatsOpen === 0`, and the only place that
    // reading is enforced is the join door. So the closed seat is proved by a seeker being
    // turned away, not by re-reading the number we just wrote.
    await approve(group.id);
    const seeker = await newHost();
    const joinRes = await fetch(`${API}/flatmates/groups/${group.id}/join`, {
      method: 'POST',
      headers: auth(seeker.accessToken),
      body: JSON.stringify({ share: 'solo' }),
    });
    expect(joinRes.status).toBe(409);
  });

  test('group verification tier persists across seat reopen and close', async ({ page }) => {
    const host = await newHost();
    const group = await createGroup(host.accessToken, { seats: 3, seatsOpen: 2 });

    // Derived at create from role, property ownership and the agreement declaration — never
    // accepted from the payload, so a client cannot ask for a tier it has not earned.
    const originalTier = group.verificationTier;
    expect(originalTier).toBe('identity');

    const closeRes = await setSeats(host.accessToken, group.id, 1);
    expect(closeRes.status).toBe(200);
    expect((await closeRes.json()).verificationTier).toBe(originalTier);

    const reopenRes = await setSeats(host.accessToken, group.id, 2);
    expect(reopenRes.status).toBe(200);
    expect((await reopenRes.json()).verificationTier).toBe(originalTier);
  });

  test('a client cannot ask for a verification tier it has not earned', async ({ page }) => {
    const host = await newHost();
    // `verificationTier` is not a field on the create request, so Jackson drops it. Asserted
    // because the value drives a trust badge, and a payload that silently set it would let any
    // host mint an owner badge for themselves.
    const group = await createGroup(host.accessToken, { verificationTier: 'owner' });

    expect(group.verificationTier).toBe('identity');
  });

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
  });

  test('seats open cannot go beyond the seats the group has', async ({ page }) => {
    const host = await newHost();
    const group = await createGroup(host.accessToken, { seats: 2, seatsOpen: 1 });

    const updateRes = await setSeats(host.accessToken, group.id, 3);

    // 400, not 422: the ceiling is `seatsTotal` on the stored group, which no annotation on the
    // payload can see. The message names the real bound rather than saying "invalid".
    expect(updateRes.status).toBe(400);
    expect((await updateRes.json()).message).toContain('2');

    const after = await (await fetch(`${API}/me/flatmate-groups`, {
      headers: auth(host.accessToken),
    })).json();
    expect(after.content.find((g) => g.id === group.id).seatsOpen).toBe(1);
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

    // The seat the joiner took is really gone, not just recorded as a request.
    const mine = async () => (await (await fetch(`${API}/me/flatmate-groups`, {
      headers: auth(host.accessToken),
    })).json()).content.find((g) => g.id === group.id);
    expect((await mine()).seatsOpen).toBe(1);

    // Backfill it — the whole point of the feature. The ceiling still holds afterwards, which is
    // the bug this loop would hide if `seatsTotal` drifted with the member count.
    expect((await setSeats(host.accessToken, group.id, 2)).status).toBe(200);
    const after = await mine();
    expect(after.seatsOpen).toBe(2);
    expect(after.seatsTotal).toBe(3);
    expect((await setSeats(host.accessToken, group.id, 4)).status).toBe(400);
  });

  test('only the group host can modify the seat count', async ({ page }) => {
    const host = await newHost();
    const other = await newHost();
    const group = await createGroup(host.accessToken, { seats: 3, seatsOpen: 1 });

    const updateRes = await setSeats(other.accessToken, group.id, 2);
    expect(updateRes.status).toBe(403);

    // Positive control, so the 403 is about who asked rather than the route being broken.
    expect((await setSeats(host.accessToken, group.id, 2)).status).toBe(200);
  });
});
