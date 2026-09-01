import { test, expect } from '@playwright/test';
import { API, apiLogin, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';

/**
 * Flatmate groups — creation, discovery, and filtering, at the contract.
 *
 * Groups are the supply side of Team up: a host lists seats in a flat they already live in (or
 * own) and seekers ask to join. Almost everything interesting about them is a server rule, which
 * is why this file is API-level rather than screen-level.
 *
 * Two shape facts are worth stating once, because getting either wrong produces a refusal that
 * reads like a server fault rather than a client one:
 *
 * - The write and the read do not share a vocabulary. `FlatmateGroupCreate` takes `seats`, `role`
 *   and a mandatory `name`; the response answers with `seatsTotal` and `hostRole`. The rename is
 *   deliberate — `seats` is what you are asking for, `seatsTotal` is what you were given — so the
 *   helpers below keep the two apart instead of pretending they are one shape.
 * - Seats have their own sub-resource, and the group itself takes a full-representation `PATCH`.
 *   This file used to assert the opposite — that the parent took no `PATCH` at all and aiming at
 *   it was a 405 — which was true when it was written and stopped being true one day later, when
 *   `de91a4e` added `updateGroup`. The fact that survives the reversal, and the reason the two
 *   endpoints are not redundant, is that the parent refuses a *partial* body: `PATCH` on the group
 *   with `{seatsOpen}` alone is a 422 naming `title` and `rent`, so moving one integer through the
 *   parent would mean resending the whole group. `PATCH .../seats` is the one-tap. Both halves are
 *   asserted below, along with the 405 that is still real — it belongs to `PUT` now.
 */

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

/**
 * `FlatmateGroupCreate`, with the fields the server insists on already filled in.
 *
 * `name` is `@NotBlank` and is the *host's* display name, not the group's — the group's is
 * `title`. The two sit next to each other in the payload and mean different things, so it is
 * defaulted here rather than left to each test to remember.
 */
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

/**
 * Let a group out of moderation, the way a real moderator would.
 *
 * Every flatmate group is born `pending` (see the test below that pins that), and `join` reads
 * through `findVisible`, which only sees `live`/`approved`. So a seeker-side test that skips this
 * step is not testing a full group or a self-join guard — it is testing a 404, and would keep
 * passing if the join route were deleted outright.
 */
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
  test('host creates a new group', async ({ page }) => {
    const host = await newHost();

    const { status, body: group } = await createGroup(host.accessToken, {
      title: 'Baner 3BHK Group', locality: 'Baner', rent: 35000, seats: 2, seatsOpen: 1,
    });

    expect(status).toBe(201);
    expect(group.id).toBeDefined();
    expect(group.title).toBe('Baner 3BHK Group');
    expect(group.locality).toBe('Baner');
    expect(group.rent).toBe(35000);
    // Answered in the read vocabulary, from a request that used the write one.
    expect(group.seatsTotal).toBe(2);
    expect(group.seatsOpen).toBe(1);
    // A tenant host who declared no agreement gets the floor tier, not a blank one. The card
    // renders a badge off this, so an absent value would silently show as unverified.
    expect(group.verificationTier).toBe('identity');
    expect(group.hostRole).toBe('tenant');
  });

  test('a group cannot open more seats than it has', async ({ page }) => {
    const host = await newHost();

    const { status } = await createGroup(host.accessToken, { seats: 2, seatsOpen: 3 });

    // Caught in the service, so a 400 rather than the 422 a bean-validation rule would give.
    // Both are refusals; the distinction is pinned here so that later moving this check into an
    // annotation shows up as a deliberate contract change rather than a silent one.
    expect(status).toBe(400);
  });

  test('a group with no title is refused, and says so by field', async ({ page }) => {
    const host = await newHost();

    const res = await fetch(`${API}/flatmates/groups`, {
      method: 'POST',
      headers: auth(host.accessToken),
      body: JSON.stringify({ ...groupBody(), title: '' }),
    });

    expect(res.status).toBe(422);
    const problem = await res.json();
    // `error`, not `code`: the envelope is `ApiError(error, message, status, traceId)`.
    expect(problem.error).toBe('validation_failed');
    expect(problem.fields.map((f) => f.field)).toContain('title');
  });

  test('host can read their own groups', async ({ page }) => {
    const host = await newHost();

    const { status, body: created } = await createGroup(host.accessToken, {
      title: 'My Group', locality: 'Kothrud', rent: 30000, seats: 3, seatsOpen: 2, policy: 'women',
    });
    expect(status).toBe(201);

    const readRes = await fetch(`${API}/me/flatmate-groups`, {
      headers: auth(host.accessToken),
    });
    expect(readRes.status).toBe(200);
    const list = await readRes.json();

    // A page envelope here, unlike saved searches — a host's own groups are a feed read.
    expect(list.content.some((g) => g.id === created.id)).toBe(true);
  });

  test('a host sees their own group whether or not the public feed does', async ({ page }) => {
    const host = await newHost();
    const { body: created } = await createGroup(host.accessToken, { locality: 'Kothrud' });

    const mine = await (await fetch(`${API}/me/flatmate-groups`, {
      headers: auth(host.accessToken),
    })).json();
    expect(mine.content.some((g) => g.id === created.id)).toBe(true);

    // `findMine` is deliberately unfiltered by moderation status and the public feed is not, so
    // this pair is the assertion that a group held for review stays visible to its author while
    // being invisible to strangers — the D72 rule that stops moderation looking like a failed
    // submit. Driven off the group's own `modStatus` rather than a hardcoded expectation, so the
    // test states the rule instead of restating today's default.
    const feed = await (await fetch(`${API}/flatmates/groups?locality=Kothrud&size=100`)).json();
    const isPublic = ['live', 'approved'].includes(created.modStatus);
    expect(feed.content.some((g) => g.id === created.id)).toBe(isPublic);
  });

  test('a brand-new group is pending, and therefore not yet joinable', async ({ page }) => {
    const host = await newHost();
    const seeker = await newSeeker();
    const { body: group } = await createGroup(host.accessToken, { seats: 3, seatsOpen: 2 });

    // Nothing in the create path publishes a group: the column defaults to `pending` and only an
    // admin verdict moves it. Pinned as a fact rather than left implicit, because it is the
    // reason every seeker-side test in this file has to approve first, and because an
    // identity-tier group is not even enqueued for review — so today it stays here forever.
    expect(group.modStatus).toBe('pending');

    const joinRes = await fetch(`${API}/flatmates/groups/${group.id}/join`, {
      method: 'POST',
      headers: auth(seeker.accessToken),
      body: JSON.stringify({ share: 'solo' }),
    });
    // 404, not 403: an unpublished group is not "you may not", it is "there is no such group",
    // which is the right answer to a stranger and a confusing one to its own host.
    expect(joinRes.status).toBe(404);

    await approve(group.id);
    const afterRes = await fetch(`${API}/flatmates/groups/${group.id}/join`, {
      method: 'POST',
      headers: auth(seeker.accessToken),
      body: JSON.stringify({ share: 'solo' }),
    });
    expect(afterRes.status).toBe(201);
  });

  test('the public feed answers without a token and carries no host mobile', async ({ page }) => {
    const host = await newHost();
    const { status } = await createGroup(host.accessToken, {
      locality: 'Baner', rent: 25000, seats: 2, seatsOpen: 1,
    });
    expect(status).toBe(201);

    const feedRes = await fetch(`${API}/flatmates/groups?locality=Baner`);
    expect(feedRes.status).toBe(200);
    const feed = await feedRes.json();
    expect(Array.isArray(feed.content)).toBe(true);

    // `FlatmateGroupFeed` has no `ownerMobile`, unlike the host-facing `FlatmateGroup`. Asserted
    // rather than assumed, because the two DTOs are mapped by the same mapper and a field added
    // to the wrong record would publish every host's number to an unauthenticated feed.
    for (const g of feed.content) expect(g.ownerMobile).toBeUndefined();
  });

  test('filter by locality', async ({ page }) => {
    const host = await newHost();
    await createGroup(host.accessToken, { locality: 'Kothrud' });

    const res = await fetch(`${API}/flatmates/groups?locality=Kothrud&size=100`);
    expect(res.status).toBe(200);
    const data = await res.json();
    // Matched case-insensitively by the query, so compare the same way.
    expect(data.content.every((g) => g.locality.toLowerCase() === 'kothrud')).toBe(true);
  });

  test('filter by budget range', async ({ page }) => {
    const host = await newHost();
    await createGroup(host.accessToken, { rent: 25000 });

    const res = await fetch(`${API}/flatmates/groups?minRent=20000&maxRent=30000&size=100`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.content.every((g) => g.rent >= 20000 && g.rent <= 30000)).toBe(true);
  });

  test('a gender-policy filter keeps the open groups too', async ({ page }) => {
    const women = await newHost();
    await createGroup(women.accessToken, { policy: 'women', locality: 'Aundh' });
    const open = await newHost();
    await createGroup(open.accessToken, { policy: 'any', locality: 'Aundh' });

    const res = await fetch(`${API}/flatmates/groups?policy=women&locality=Aundh&size=100`);
    expect(res.status).toBe(200);
    const data = await res.json();

    // `g.policy = :policy or g.policy = 'any'` — a women-only filter is a floor, not an equality.
    // Asserting `every(policy === 'women')` would assert the opposite of the product rule: an
    // open group is one a woman may join, so hiding it would hide real inventory from her.
    expect(data.content.every((g) => g.policy === 'women' || g.policy === 'any')).toBe(true);
    expect(data.content.some((g) => g.policy === 'any')).toBe(true);
  });

  test('pagination of group feed', async ({ page }) => {
    const firstPageRes = await fetch(`${API}/flatmates/groups?size=5&page=0`);
    expect(firstPageRes.status).toBe(200);
    const firstPage = await firstPageRes.json();

    expect(firstPage.content).toBeDefined();
    expect(firstPage.totalElements).toBeDefined();
    expect(firstPage.size).toBe(5);
    expect(firstPage.content.length).toBeLessThanOrEqual(5);
  });

  test('a seeker cannot change seats on another host\'s group', async ({ page }) => {
    const host = await newHost();
    const seeker = await newSeeker();

    const { body: group } = await createGroup(host.accessToken, {
      title: 'Host Only Group', seats: 2, seatsOpen: 1,
    });

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

  test('the group takes a whole-representation PATCH, which is why seats keep their own door', async () => {
    const host = await newHost();
    const { body: group } = await createGroup(host.accessToken);
    expect(group.seatsOpen).toBe(1);

    // The partial body is the point. If this were accepted, `PATCH .../seats` would be redundant
    // and the sub-resource could be deleted; the 422 is what earns it. Assert the named fields
    // rather than the bare status, so a server that starts refusing for some unrelated reason
    // cannot keep this green. The three are `FlatmateGroupCreateRequest`'s @NotBlank/@NotNull set,
    // and `name` being among them is the sharpest part: it is the *host's* display name, so moving
    // one seat through the parent would mean resending who you are.
    const partial = await fetch(`${API}/flatmates/groups/${group.id}`, {
      method: 'PATCH',
      headers: auth(host.accessToken),
      body: JSON.stringify({ seatsOpen: 0 }),
    });
    expect(partial.status).toBe(422);
    const refused = await partial.json();
    expect(refused.fields.map((f) => f.field).sort()).toEqual(['name', 'rent', 'title']);

    // And the whole representation is accepted, with the derived per-head rent recomputed off the
    // new rent rather than left at the old one — a stale `perHead` is the failure that would not
    // show up in the status code.
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

  test('a stranger cannot edit a group, and PUT is still the unsupported verb', async () => {
    const host = await newHost();
    const stranger = await newSeeker();
    const { body: group } = await createGroup(host.accessToken);

    const hijack = await fetch(`${API}/flatmates/groups/${group.id}`, {
      method: 'PATCH',
      headers: auth(stranger.accessToken),
      body: JSON.stringify(groupBody({ title: 'Hijacked' })),
    });
    expect(hijack.status).toBe(403);

    // 405, not 404: the path is registered, this verb is not. Worth pinning because a client that
    // aims here is told something that reads like "no such group" when the group is fine. It used
    // to be PATCH that answered this way; PATCH now works, so the assertion moved to the verb that
    // is genuinely unsupported rather than being deleted.
    const put = await fetch(`${API}/flatmates/groups/${group.id}`, {
      method: 'PUT',
      headers: auth(host.accessToken),
      body: JSON.stringify(groupBody()),
    });
    expect(put.status).toBe(405);
  });

  test('a group with no seats open cannot be joined', async ({ page }) => {
    const host = await newHost();
    const seeker = await newSeeker();

    const { body: group } = await createGroup(host.accessToken, {
      title: 'Full Group', seats: 1, seatsOpen: 0,
    });
    await approve(group.id);

    const joinRes = await fetch(`${API}/flatmates/groups/${group.id}/join`, {
      method: 'POST',
      headers: auth(seeker.accessToken),
      body: JSON.stringify({ share: 'solo', message: 'Any room left?' }),
    });

    expect(joinRes.status).toBe(409);
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

  test('joining an open group takes the seat', async ({ page }) => {
    const host = await newHost();
    const seeker = await newSeeker();

    const { body: group } = await createGroup(host.accessToken, {
      policy: 'any', seats: 3, seatsOpen: 2,
    });
    await approve(group.id);

    const joinRes = await fetch(`${API}/flatmates/groups/${group.id}/join`, {
      method: 'POST',
      headers: auth(seeker.accessToken),
      body: JSON.stringify({ share: 'solo', message: 'Hi, I would like to join.' }),
    });
    expect(joinRes.status).toBe(201);
    // An `any`-policy group auto-accepts, so this is a join rather than a request to be decided.
    expect((await joinRes.json()).action).toBe('join');

    // The seat is really gone, read back through the host's own list rather than inferred from
    // the 201 — the seat count is the thing a seeker acts on, and it lives on the group.
    const after = await (await fetch(`${API}/me/flatmate-groups`, {
      headers: auth(host.accessToken),
    })).json();
    expect(after.content.find((g) => g.id === group.id).seatsOpen).toBe(1);
  });

  test('host removes their group and it leaves both the feed and their own list', async ({ page }) => {
    const host = await newHost();
    const { body: group } = await createGroup(host.accessToken, { locality: 'Wakad' });

    const del = await fetch(`${API}/flatmates/groups/${group.id}`, {
      method: 'DELETE',
      headers: auth(host.accessToken),
    });
    expect(del.status).toBe(204);

    const feed = await (await fetch(`${API}/flatmates/groups?locality=Wakad&size=100`)).json();
    expect(feed.content.some((g) => g.id === group.id)).toBe(false);

    // Archived rather than unpublished, so it is gone from the host's list as well. Asserting
    // only the feed would pass equally for a group that had merely been held for moderation.
    const mine = await (await fetch(`${API}/me/flatmate-groups`, {
      headers: auth(host.accessToken),
    })).json();
    expect(mine.content.some((g) => g.id === group.id)).toBe(false);
  });
});
