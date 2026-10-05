import { test, expect } from '@playwright/test';
import { API, apiLogin, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';
/* API-level because almost every group rule is a server rule. The write and read vocabularies
   differ: `FlatmateGroupCreate` takes `seats`/`role`, the response answers `seatsTotal`/`hostRole`. */
const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

async function newHost() {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);
  return { mobile, accessToken };
}

async function newSeeker() {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);
  return { mobile, accessToken };
}

const groupBody = (over = {}) => ({
  title: 'Baner 3BHK Group',
  name: 'Asha K',
  locality: 'Baner',
  rent: 35000,
  seats: 3,
  seatsOpen: 1,
  policy: 'any',
  role: 'tenant',
  ...over,
});

const track = flatmateCleanup(test);

async function createGroup(token, over = {}) {
  const res = await fetch(`${API}/flatmates/groups`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify(groupBody(over)),
  });
  const body = await res.json();
  if (res.status === 201) track('groups', body.id, token);
  return { status: res.status, body };
}
/* Every group is born `pending` and `join` reads through `findVisible`, so a seeker-side test that
   skips this is testing a 404 and would pass with the join route deleted. */

async function approve(groupId) {
  const { accessToken } = await apiLogin(ACTORS.admin);
  const res = await fetch(`${API}/admin/flatmates/${groupId}/moderation`, {
    method: 'PATCH',
    headers: auth(accessToken),
    body: JSON.stringify({ modStatus: 'live', note: 'e2e' }),
  });
  expect(res.status).toBeLessThan(300);
}

test.describe('Flatmate groups', () => {
  test('host creates a group and sees it in their own list whether or not the public feed does', async () => {
    const host = await newHost();
    let created;

    await test.step('host creates a new group', async () => {
      const { status, body: group } = await createGroup(host.accessToken, {
        title: 'Kothrud 3BHK Group', locality: 'Kothrud', rent: 35000, seats: 2, seatsOpen: 1,
      });

      expect(status).toBe(201);
      expect(group.id).toBeDefined();
      expect(group.title).toBe('Kothrud 3BHK Group');
      expect(group.locality).toBe('Kothrud');
      expect(group.rent).toBe(35000);
      expect(group.seatsTotal).toBe(2);
      expect(group.seatsOpen).toBe(1);
      // A tenant host who declared no agreement gets the floor tier, not a blank one. The card
      // renders a badge off this, so an absent value would silently show as unverified.
      expect(group.verificationTier).toBe('identity');
      expect(group.hostRole).toBe('tenant');
      created = group;
    });

    await test.step('host can read their own groups', async () => {
      const readRes = await fetch(`${API}/me/flatmate-groups`, {
        headers: auth(host.accessToken),
      });
      expect(readRes.status).toBe(200);
      const mine = await readRes.json();
      expect(mine.content.some((g) => g.id === created.id)).toBe(true);
    });

    await test.step('the public feed shows the group only once it is published', async () => {
      // `findMine` is deliberately unfiltered by moderation status and the public feed is not, so
      // this pair is what stops moderation looking like a failed submit to the author.
      const feed = await (await fetch(`${API}/flatmates/feed?tab=team-up&locality=Kothrud&size=100`)).json();
      const isPublic = ['live', 'approved'].includes(created.modStatus);
      expect(feed.content.some((g) => g.id === created.id)).toBe(isPublic);
    });
  });

  test('a group is refused when it opens more seats than it has, or has no title', async () => {
    const host = await newHost();

    await test.step('a group cannot open more seats than it has', async () => {
      const { status } = await createGroup(host.accessToken, { seats: 2, seatsOpen: 3 });
      // Caught in the service, so a 400 rather than the 422 a bean-validation rule would give. Pinned
      // so moving this into an annotation later reads as a deliberate contract change.
      expect(status).toBe(400);
    });

    await test.step('a group with no title is refused, and says so by field', async () => {
      const res = await fetch(`${API}/flatmates/groups`, {
        method: 'POST',
        headers: auth(host.accessToken),
        body: JSON.stringify({ ...groupBody(), title: '' }),
      });

      expect(res.status).toBe(422);
      const problem = await res.json();
      expect(problem.error).toBe('validation_failed');
      expect(problem.fields.map((f) => f.field)).toContain('title');
    });
  });
  test('a brand-new group with a flat is pending, and therefore not yet joinable', async ({ page }) => {
    const host = await newHost();
    const seeker = await newSeeker();
    const { body: group } = await createGroup(host.accessToken, { seats: 3, seatsOpen: 2 });
    // Nothing in the create path publishes a group, which is why every seeker-side test here must
    // approve first — and an identity-tier group is not even enqueued, so today it stays pending.
    expect(group.modStatus).toBe('pending');

    const joinRes = await fetch(`${API}/flatmates/groups/${group.id}/join`, {
      method: 'POST',
      headers: auth(seeker.accessToken),
      body: JSON.stringify({ share: 'solo' }),
    });
    expect(joinRes.status).toBe(404);

    await approve(group.id);
    const afterRes = await fetch(`${API}/flatmates/groups/${group.id}/join`, {
      method: 'POST',
      headers: auth(seeker.accessToken),
      body: JSON.stringify({ share: 'solo' }),
    });
    expect(afterRes.status).toBe(201);
  });

  test('the public team-up feed is open, carries no host mobile, and filters and pages', async () => {
    await test.step('the feed answers without a token and carries no host mobile', async () => {
      const host = await newHost();
      const { status } = await createGroup(host.accessToken, {
        locality: 'Baner', rent: 25000, seats: 2, seatsOpen: 1,
      });
      expect(status).toBe(201);

      const feedRes = await fetch(`${API}/flatmates/feed?tab=team-up&locality=Baner`);
      expect(feedRes.status).toBe(200);
      const feed = await feedRes.json();
      expect(Array.isArray(feed.content)).toBe(true);

      for (const g of feed.content) expect(g.ownerMobile).toBeUndefined();
    });

    await test.step('filter by locality', async () => {
      const host = await newHost();
      await createGroup(host.accessToken, { locality: 'Kothrud' });

      const res = await fetch(`${API}/flatmates/feed?tab=team-up&locality=Kothrud&size=100`);
      expect(res.status).toBe(200);
      const data = await res.json();
      // Matched case-insensitively by the query, so compare the same way.
      const groups = data.content.filter((row) => row.seatsTotal !== undefined);
      expect(groups.every((g) => g.locality.toLowerCase() === 'kothrud')).toBe(true);
    });

    await test.step('a gender filter keeps the open groups too', async () => {
      const women = await newHost();
      await createGroup(women.accessToken, { policy: 'women', locality: 'Aundh' });
      const open = await newHost();
      await createGroup(open.accessToken, { policy: 'any', locality: 'Aundh' });

      const res = await fetch(`${API}/flatmates/feed?tab=team-up&gender=female&locality=Aundh&size=100`);
      expect(res.status).toBe(200);
      const data = await res.json();
      const groups = data.content.filter((row) => row.seatsTotal !== undefined);

      expect(groups.every((g) => g.policy === 'women' || g.policy === 'any')).toBe(true);
      expect(groups.some((g) => g.policy === 'any')).toBe(true);
    });

    await test.step('pagination of the team-up feed', async () => {
      const firstPageRes = await fetch(`${API}/flatmates/feed?tab=team-up&size=5&page=0`);
      expect(firstPageRes.status).toBe(200);
      const firstPage = await firstPageRes.json();

      expect(firstPage.content).toBeDefined();
      expect(firstPage.totalElements).toBeDefined();
      expect(firstPage.size).toBe(5);
      expect(firstPage.content.length).toBeLessThanOrEqual(5);
    });
  });
  test('a stranger cannot change seats on or edit another host\'s group, and PUT is still the unsupported verb', async () => {
    test.slow();
    const host = await newHost();
    const seeker = await newSeeker();
    const { body: group } = await createGroup(host.accessToken, {
      title: 'Host Only Group', seats: 2, seatsOpen: 1,
    });

    await test.step('a seeker cannot change seats on another host\'s group', async () => {
      const updateRes = await fetch(`${API}/flatmates/groups/${group.id}/seats`, {
        method: 'PATCH',
        headers: auth(seeker.accessToken),
        body: JSON.stringify({ seatsOpen: 0 }),
      });
      expect(updateRes.status).toBe(403);
      // Positive control: the host can. Without it, a route broken for everybody would pass the
      // assertion above and read as an access-control test that works.
      const hostRes = await fetch(`${API}/flatmates/groups/${group.id}/seats`, {
        method: 'PATCH',
        headers: auth(host.accessToken),
        body: JSON.stringify({ seatsOpen: 0 }),
      });
      expect(hostRes.status).toBe(200);
      expect((await hostRes.json()).seatsOpen).toBe(0);
    });

    await test.step('a stranger cannot edit a group, and PUT is still the unsupported verb', async () => {
      const hijack = await fetch(`${API}/flatmates/groups/${group.id}`, {
        method: 'PATCH',
        headers: auth(seeker.accessToken),
        body: JSON.stringify(groupBody({ title: 'Hijacked' })),
      });
      expect(hijack.status).toBe(403);
      // 405, not 404: the path is registered, this verb is not. Worth pinning because a client that
      // aims here is told something that reads like "no such group" when the group is fine.
      const put = await fetch(`${API}/flatmates/groups/${group.id}`, {
        method: 'PUT',
        headers: auth(host.accessToken),
        body: JSON.stringify(groupBody()),
      });
      expect(put.status).toBe(405);
    });
  });

  test('the group takes a whole-representation PATCH, which is why seats keep their own door', async () => {
    const host = await newHost();
    const { body: group } = await createGroup(host.accessToken);
    expect(group.seatsOpen).toBe(1);
    // The partial body is the point: the 422 is what earns the `/seats` sub-resource. Named fields
    // are asserted so an unrelated refusal cannot keep this green.
    const partial = await fetch(`${API}/flatmates/groups/${group.id}`, {
      method: 'PATCH',
      headers: auth(host.accessToken),
      body: JSON.stringify({ seatsOpen: 0 }),
    });
    expect(partial.status).toBe(422);
    const refused = await partial.json();
    expect(refused.fields.map((f) => f.field).sort()).toEqual(['locality', 'name', 'rent', 'title']);
    // Also checks the derived per-head rent is recomputed off the new rent — a stale `perHead`
    // would not show up in the status code.
    const full = await fetch(`${API}/flatmates/groups/${group.id}`, {
      method: 'PATCH',
      headers: auth(host.accessToken),
      body: JSON.stringify(groupBody({ title: 'Renamed by PATCH', rent: 21000, seatsOpen: 2 })),
    });
    expect(full.status).toBe(200);
    expect(await full.json()).toMatchObject({
      id: group.id,
      title: 'Renamed by PATCH',
      rent: 21000,
      seatsOpen: 2,
      perHead: 7000,
    });
  });
  test('a host cannot ask to join their own group', async ({ page }) => {
    const host = await newHost();
    const { body: group } = await createGroup(host.accessToken, { seats: 3, seatsOpen: 2 });
    await approve(group.id);

    const res = await fetch(`${API}/flatmates/groups/${group.id}/join`, {
      method: 'POST',
      headers: auth(host.accessToken),
      body: JSON.stringify({ share: 'solo' }),
    });

    expect(res.status).toBe(403);
  });

  test('host removes their group and it leaves both the feed and their own list', async ({ page }) => {
    const host = await newHost();
    const { body: group } = await createGroup(host.accessToken, { locality: 'Wakad' });

    const del = await fetch(`${API}/flatmates/groups/${group.id}`, {
      method: 'DELETE',
      headers: auth(host.accessToken),
    });
    expect(del.status).toBe(204);

    const feed = await (await fetch(`${API}/flatmates/feed?tab=team-up&locality=Wakad&size=100`)).json();
    expect(feed.content.some((g) => g.id === group.id)).toBe(false);
    // Archived rather than unpublished, so it is gone from the host's list as well. Asserting
    // only the feed would pass equally for a group that had merely been held for moderation.
    const mine = await (await fetch(`${API}/me/flatmate-groups`, {
      headers: auth(host.accessToken),
    })).json();
    expect(mine.content.some((g) => g.id === group.id)).toBe(false);
  });
});
