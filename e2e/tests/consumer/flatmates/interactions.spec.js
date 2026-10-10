import { test, expect } from '@playwright/test';
import { API, apiLogin, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';
import { tenantRoomAgreement } from '../../../helpers/flatmateAgreement.js';

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

async function newSeeker() {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);
  return { mobile, accessToken };
}

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
      ...(await tenantRoomAgreement(hostToken)),
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
      title: `Group ${Number(uniqueMobile()).toString(36)}`,
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
    expect(await interestRes.text()).toBe('');

    const inbox = await (await fetch(`${API}/me/flatmate-requests`, {
      headers: auth(host.accessToken),
    })).json();
    const row = inbox.content.find((r) => r.targetId === room.id);
    expect(row).toBeDefined();
    expect(row.kind).toBe('room');
    expect(row.status).toBe('pending');
    expect(row.message).toBe('Is the room still free?');
    // The contact gate runs backwards here on purpose: pressing "I'm interested" hands the host the
    // *requester's* number, but only once they accept — until then the inbox carries a masked one.
    expect(row.requesterMobile).toBe(`${seeker.mobile.slice(0, 2)}XXXXX${seeker.mobile.slice(-3)}`);
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
    // Asserted so a reworded message cannot quietly drop the machine-readable half of the answer.
    expect(second.status).toBe(409);
    expect((await second.json()).message).toContain('already_interested');

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

    const urls = [];
    for (let i = 0; i < 11; i += 1) {
      const host = await newSeeker();
      urls.push(i !== 1 && i !== 3
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
    expect((await eleventh.json()).message).not.toContain('already_interested');
  });

  test('a seeker reads their asks from the outbox, not the inbox', async () => {
    const host = await newSeeker();
    const seeker = await newSeeker();
    const room = await seedRoom(host.accessToken);

    expect((await fetch(`${API}/flatmates/rooms/${room.id}/interest`, {
      method: 'POST', headers: auth(seeker.accessToken), body: JSON.stringify({ share: 'solo' }),
    })).status).toBe(201);

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

    const wrongNoun = await withdraw('rooms');
    expect(wrongNoun.status).toBe(400);
    expect((await wrongNoun.json()).message).toContain('room');
    expect(await outboxCount()).toBe(1);

    expect((await withdraw('room')).status).toBe(204);
    expect(await outboxCount()).toBe(0);
    // Not idempotent: a second withdraw is a 404, not a second 204. Worth pinning because the UI
    // has to tell "you already took this back" apart from "that never existed".
    expect((await withdraw('room')).status).toBe(404);

    expect((await ask()).status).toBe(201);
  });
});
