import { test, expect } from '@playwright/test';
import { API, apiLogin, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';

/**
 * Flatmates — the three interest doors, and what they have in common.
 *
 * There is no single "flatmate interest" resource. Interest is expressed against the thing you
 * are interested in, and each thing owns its own verb:
 *
 *   POST /flatmates/rooms/{id}/interest   → 201, no body
 *   POST /flatmates/posts/{id}/interest   → 201, no body
 *   POST /flatmates/groups/{id}/join      → 201 FlatmateRequest
 *
 * Three verbs for one user intent — "I want in" — is the shape the UI has to reconcile, so it is
 * worth stating rather than hiding behind a helper. What they share is the row they write: one
 * `flatmate_requests` per (kind, target, requester), a 409 `already_interested` on the second
 * ask, and one ten-an-hour budget across all three doors.
 *
 * That row has two ends, and both are asserted below because reading only one of them is what
 * made this file wrong before: `/me/flatmate-requests` is the *host's* inbox and
 * `/me/flatmate-interests` is the *seeker's* outbox. Until `de91a4e` the outbox did not exist and
 * neither did withdrawal, and the tests here pinned those absences as contract facts. They are
 * facts no longer — the pin is what turned a shipped feature into a red assertion, so the absence
 * of a route is now only worth asserting when something depends on it staying absent.
 */

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

async function newSeeker() {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);
  return { mobile, accessToken };
}

/**
 * Let a room or group out of moderation — everything flatmate-side is born `pending`.
 *
 * The admin token is resolved once per worker. `apiLogin` costs two round trips, and the budget
 * test alone approves a dozen posts.
 */
let adminToken;
async function approve(id) {
  adminToken ??= (await apiLogin(ACTORS.admin)).accessToken;
  const res = await fetch(`${API}/admin/flatmates/${id}/moderation`, {
    method: 'PATCH',
    headers: auth(adminToken),
    body: JSON.stringify({ modStatus: 'live', note: 'e2e' }),
  });
  expect(res.status).toBeLessThan(300);
}

/**
 * A room, seeded through the API rather than read off the board.
 *
 * Taking `content[0]` from the public feed would make every assertion here depend on fixture
 * data this file does not own, and on a room whose host might be the seeker. Creating one costs
 * a request and makes the host identity knowable, which the inbox assertions need.
 */
const track = flatmateCleanup(test);

async function seedRoom(hostToken) {
  const res = await fetch(`${API}/flatmates/rooms`, {
    method: 'POST',
    headers: auth(hostToken),
    body: JSON.stringify({
      roomType: 'Private room',
      locality: 'Baner',
      rentShare: 18000,
      bhk: '2',
      attachedBath: 'attached',
      furnishing: 'semi',
      hostRole: 'tenant',
      photos: ['https://example.test/room.jpg'],
    }),
  });
  expect(res.status).toBe(201);
  const room = await res.json();
  track('rooms', room.id, hostToken);
  await approve(room.id);
  return room;
}

async function seedGroup(hostToken, over = {}) {
  const res = await fetch(`${API}/flatmates/groups`, {
    method: 'POST',
    headers: auth(hostToken),
    body: JSON.stringify({
      title: `Group ${uniqueMobile()}`,
      name: 'Asha K',
      locality: 'Baner',
      rent: 30000,
      seats: 3,
      seatsOpen: 2,
      policy: 'any',
      role: 'tenant',
      ...over,
    }),
  });
  expect(res.status).toBe(201);
  const group = await res.json();
  track('groups', group.id, hostToken);
  await approve(group.id);
  return group;
}

test.describe('Flatmates interactions', () => {
  test('interest in a room reaches the host inbox, carrying the seeker\'s own number', async ({ page }) => {
    const host = await newSeeker();
    const seeker = await newSeeker();
    const room = await seedRoom(host.accessToken);

    const interestRes = await fetch(`${API}/flatmates/rooms/${room.id}/interest`, {
      method: 'POST',
      headers: auth(seeker.accessToken),
      body: JSON.stringify({ share: 'solo', message: 'Is the room still free?' }),
    });
    expect(interestRes.status).toBe(201);
    // Void by design: there is no interest resource to hand back, only a row in the host's inbox.
    expect(await interestRes.text()).toBe('');

    const inbox = await (await fetch(`${API}/me/flatmate-requests`, {
      headers: auth(host.accessToken),
    })).json();
    const row = inbox.content.find((r) => r.targetId === room.id);
    expect(row).toBeDefined();
    expect(row.kind).toBe('room');
    expect(row.status).toBe('pending');
    expect(row.message).toBe('Is the room still free?');
    // The contact gate runs backwards here on purpose: pressing "I'm interested" hands over the
    // *requester's* number, so the host receiving it unmasked is the feature, not a leak.
    expect(row.requesterMobile).toBe(seeker.mobile);
  });

  test('a second ask on the same room is refused as a duplicate', async ({ page }) => {
    const host = await newSeeker();
    const seeker = await newSeeker();
    const room = await seedRoom(host.accessToken);

    const send = () => fetch(`${API}/flatmates/rooms/${room.id}/interest`, {
      method: 'POST',
      headers: auth(seeker.accessToken),
      body: JSON.stringify({ share: 'solo' }),
    });

    expect((await send()).status).toBe(201);

    const second = await send();
    expect(second.status).toBe(409);
    // The sub-code is carried in the prose, which is the only place it exists — `ConflictException`
    // has no code field. Asserted so a reworded message cannot quietly drop the machine-readable
    // half of the answer.
    expect((await second.json()).message).toContain('already_interested');

    // And the first ask was not duplicated or overwritten.
    const inbox = await (await fetch(`${API}/me/flatmate-requests`, {
      headers: auth(host.accessToken),
    })).json();
    expect(inbox.content.filter((r) => r.targetId === room.id)).toHaveLength(1);
  });

  test('a host cannot enquire about their own room', async ({ page }) => {
    const host = await newSeeker();
    const room = await seedRoom(host.accessToken);

    const res = await fetch(`${API}/flatmates/rooms/${room.id}/interest`, {
      method: 'POST',
      headers: auth(host.accessToken),
      body: JSON.stringify({ share: 'solo' }),
    });

    expect(res.status).toBe(403);
  });

  test('joining a group is the group\'s version of the same door', async ({ page }) => {
    const host = await newSeeker();
    const seeker = await newSeeker();
    const group = await seedGroup(host.accessToken);

    const joinRes = await fetch(`${API}/flatmates/groups/${group.id}/join`, {
      method: 'POST',
      headers: auth(seeker.accessToken),
      body: JSON.stringify({ share: 'match', message: 'Looking to move in next month.' }),
    });
    expect(joinRes.status).toBe(201);
    const request = await joinRes.json();

    // Unlike the room door this one answers with the row, because an open group auto-accepts and
    // the caller needs to know they are in rather than waiting.
    expect(request.kind).toBe('group');
    expect(request.action).toBe('join');
    expect(request.share).toBe('match');
    expect(request.targetId).toBe(group.id);

    const inbox = await (await fetch(`${API}/me/flatmate-requests`, {
      headers: auth(host.accessToken),
    })).json();
    expect(inbox.content.some((r) => r.id === request.id)).toBe(true);
  });

  test('a second join on the same group is refused as a duplicate', async ({ page }) => {
    const host = await newSeeker();
    const seeker = await newSeeker();
    const group = await seedGroup(host.accessToken, { seats: 4, seatsOpen: 3 });

    const send = () => fetch(`${API}/flatmates/groups/${group.id}/join`, {
      method: 'POST',
      headers: auth(seeker.accessToken),
      body: JSON.stringify({ share: 'solo' }),
    });

    expect((await send()).status).toBe(201);
    const second = await send();
    expect(second.status).toBe(409);
    expect((await second.json()).message).toContain('already_interested');
  });

  test('a group with no seats open is refused with the full sub-code, not the duplicate one', async ({ page }) => {
    const seeker = await newSeeker();
    const host = await newSeeker();
    const group = await seedGroup(host.accessToken, {
      title: 'Intentionally Full Group', seats: 2, seatsOpen: 0,
    });

    const res = await fetch(`${API}/flatmates/groups/${group.id}/join`, {
      method: 'POST',
      headers: auth(seeker.accessToken),
      body: JSON.stringify({ share: 'solo' }),
    });

    expect(res.status).toBe(409);
    const problem = await res.json();
    // Both refusals are 409, so the status alone cannot tell "come back later" from "you already
    // asked". The sub-code is the only thing that can, and the UI copy branches on it.
    expect(problem.message).toContain('group_full');
    expect(problem.message).not.toContain('already_interested');
  });

  test('the room and group doors share one interest budget', async ({ page }) => {
    const seeker = await newSeeker();

    // Ten an hour, counted per requester across every door — a room enquiry and a group join draw
    // on the same allowance, which is the whole point of the shared lock.
    //
    // Every target needs its own host: the anti-broker guardrail caps one identity at three live
    // non-owner posts, so seeding eleven from one account is refused before the budget is even in
    // play. Two independent caps that both answer 409 is exactly the kind of collision worth
    // keeping visible in the test's shape.
    const urls = [];
    for (let i = 0; i < 11; i += 1) {
      const host = await newSeeker();
      urls.push(i % 2 === 0
        ? `${API}/flatmates/rooms/${(await seedRoom(host.accessToken)).id}/interest`
        : `${API}/flatmates/groups/${(await seedGroup(host.accessToken)).id}/join`);
    }

    const ask = (url) => fetch(url, {
      method: 'POST', headers: auth(seeker.accessToken), body: JSON.stringify({ share: 'solo' }),
    });

    for (const url of urls.slice(0, 10)) {
      expect((await ask(url)).status).toBe(201);
    }

    const eleventh = await ask(urls[10]);
    expect(eleventh.status).toBe(429);
    // 429 rather than 409: this is "not now", not "not you" or "again". The distinction is what
    // lets the UI say come back later instead of accusing the seeker of repeating themselves.
    expect((await eleventh.json()).message).not.toContain('already_interested');
  });

  test('a seeker reads their asks from the outbox, not the inbox', async () => {
    const host = await newSeeker();
    const seeker = await newSeeker();
    const room = await seedRoom(host.accessToken);

    expect((await fetch(`${API}/flatmates/rooms/${room.id}/interest`, {
      method: 'POST', headers: auth(seeker.accessToken), body: JSON.stringify({ share: 'solo' }),
    })).status).toBe(201);

    // One row, two ends. `/me/flatmate-requests` is the *host's* inbox and `/me/flatmate-interests`
    // is the seeker's outbox, and the difference is only visible if the same row is read from both:
    // asserting the seeker's inbox is empty proves nothing on its own, since a seeker who had never
    // pressed anything would also see nothing. The host anchor is what makes the absence a fact.
    const inbox = async (token) =>
      (await (await fetch(`${API}/me/flatmate-requests`, { headers: auth(token) })).json())
        .content.some((r) => r.targetId === room.id);
    expect(await inbox(host.accessToken)).toBe(true);
    expect(await inbox(seeker.accessToken)).toBe(false);

    const outbox = async () =>
      (await (await fetch(`${API}/me/flatmate-interests`, { headers: auth(seeker.accessToken) }))
        .json()).content.filter((r) => r.targetId === room.id);

    // The outbox carries what the board needs to render the pressed state without a local mirror:
    // which door was used, and how the host answered.
    expect(await outbox()).toMatchObject([{ kind: 'room', status: 'pending' }]);
  });

  test('a seeker can withdraw an ask, and the door reopens', async () => {
    const host = await newSeeker();
    const seeker = await newSeeker();
    const room = await seedRoom(host.accessToken);
    const askUrl = `${API}/flatmates/rooms/${room.id}/interest`;
    const ask = () => fetch(askUrl, {
      method: 'POST', headers: auth(seeker.accessToken), body: JSON.stringify({ share: 'solo' }),
    });
    const withdraw = (kind) => fetch(`${API}/flatmates/${kind}/${room.id}/interest`, {
      method: 'DELETE', headers: auth(seeker.accessToken),
    });
    const outboxCount = async () =>
      (await (await fetch(`${API}/me/flatmate-interests`, { headers: auth(seeker.accessToken) }))
        .json()).content.filter((r) => r.targetId === room.id).length;

    expect((await ask()).status).toBe(201);
    expect(await outboxCount()).toBe(1);

    // The ask door spells the noun plural (`/flatmates/rooms/…`) and the withdraw door spells it
    // singular, because withdraw validates against `kind` as it is *stored* in `flatmate_requests`
    // — `room | group | flatmate` since V27. Two spellings for one resource is a wart, not a
    // choice (FlatmateSeekerService, INTEREST_KINDS), and it is asserted rather than smoothed over
    // because the plural cost this file a red assertion once already.
    const wrongNoun = await withdraw('rooms');
    expect(wrongNoun.status).toBe(400);
    expect((await wrongNoun.json()).message).toContain('room');
    expect(await outboxCount()).toBe(1);

    expect((await withdraw('room')).status).toBe(204);
    expect(await outboxCount()).toBe(0);

    // Not idempotent: a second withdraw is a 404, not a second 204. Worth pinning because the UI
    // has to tell "you already took this back" apart from "that never existed".
    expect((await withdraw('room')).status).toBe(404);

    // And the withdrawal is real rather than cosmetic — the unique index on
    // (kind, target, requester) would answer 409 `already_interested` if the row had merely been
    // marked, so a 201 here is the row actually being gone.
    expect((await ask()).status).toBe(201);
  });
});
