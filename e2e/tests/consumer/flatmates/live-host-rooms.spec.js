import { test, expect } from '@playwright/test';
import { API, apiLogin, uniqueMobile } from '../../../helpers/liveAuth.js';

/**
 * The host's own view of the rooms they posted, and their ability to take one down.
 *
 * ## Why these two routes exist at all
 *
 * `GET /flatmates/rooms` is public and hard-floored to approved supply, which is right for the
 * board and useless for the person who filled the form. A host whose room is sitting in moderation
 * sees it nowhere, concludes the post failed, and posts it again — so the flat that was one room on
 * the board becomes two, and the duplicate is the platform's fault rather than the host's. The
 * caller-scoped read is the fix, and the thing worth testing about it is precisely the rows the
 * public read refuses to return.
 *
 * The withdraw is a soft archive, not a status flag, and not the same act as closing the last seat.
 * A room with no seats open is taken; a withdrawn room was never really on offer. Only the second
 * frees the host's slot under the anti-broker cap.
 *
 * ## Every subject here is minted, never seeded
 *
 * `draazy_e2e` seeds five flatmate supply rows and other specs assert on them. A test that
 * archived one would be deleting another spec's fixture, so every room this file touches is posted
 * by a throwaway account inside the test that reads it. That also makes the ownership assertions
 * real: the 403 case needs two genuinely different people, not two roles on one.
 */

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });

async function newHost() {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);
  return { mobile, accessToken };
}

/**
 * The smallest room the server will accept.
 *
 * `photos` is `@NotEmpty` because a room with no pictures is the shape broker spam takes, so the
 * fixture carries one rather than discovering the refusal as a mystery 422.
 */
async function postRoom(accessToken, note) {
  const res = await fetch(`${API}/flatmates/rooms`, {
    method: 'POST',
    headers: auth(accessToken),
    body: JSON.stringify({
      bhk: '2',
      roomType: 'Private room',
      attachedBath: 'attached',
      furnishing: 'semi',
      locality: 'Kothrud',
      rentShare: 14000,
      deposit: 28000,
      availableFrom: '2026-12-01',
      lookingFor: 'any',
      foodPref: 'any',
      photos: ['https://cdn.example/1.jpg'],
      note,
      hostRole: 'owner',
    }),
  });
  /* Read the body exactly once and reuse the text for both the assertion message and the parse. A
     `expect(res.status, await res.text())` reads it even when the status is right, and the next
     `res.json()` then dies with "Body is unusable" — a helper that fails every test in the file for
     a reason that has nothing to do with what any of them assert. */
  const body = await res.text();
  expect(res.status, body).toBe(201);
  return JSON.parse(body);
}

/* `PageResponse` names the array `content`, not `items`. Worth stating, because the frontend
   provider unwraps it into `items` before anything in `src/` sees it, so the shape a component
   reads and the shape on the wire are genuinely different and only one of them is the contract. */
const myRooms = (accessToken) =>
  fetch(`${API}/me/flatmate-rooms?size=50`, { headers: auth(accessToken) }).then((r) => r.json());

test.describe('A host and the rooms they posted', () => {
  /**
   * The point of the route in one assertion: the room is mine and I can see it *before* a moderator
   * has looked at it. Anchored on the room's own id rather than on a count, because this database
   * lives for the whole run and other workers are posting rooms into it at the same time.
   */
  test('a freshly posted room is visible to its host while the public board still hides it', async () => {
    const host = await newHost();
    const room = await postRoom(host.accessToken, 'live-host-rooms: mine while pending');

    const mine = await myRooms(host.accessToken);
    expect(mine.content.map((r) => r.id)).toContain(room.id);

    /* The same room through the public read, which applies the approved-only floor. If this ever
       starts finding it, the two reads have stopped being different and the caller-scoped one has
       no reason to exist. */
    const board = await fetch(`${API}/flatmates/rooms?size=100`).then((r) => r.json());
    const publicIds = board.content.map((r) => r.id);
    expect(publicIds).not.toContain(room.id);
  });

  /**
   * The host's own number comes back on this read and on no other.
   *
   * Every public projection masks it — that masking is the anti-broker measure the whole flatmate
   * product rests on — so a test that only checked "the field is a string" would pass against a
   * build that had started leaking it everywhere. What makes this safe is *whose* number it is.
   */
  test('the host read carries the caller own mobile, which the public board masks', async () => {
    const host = await newHost();
    await postRoom(host.accessToken, 'live-host-rooms: own mobile');

    const mine = await myRooms(host.accessToken);
    const row = mine.content[0];
    expect(row.ownerMobile).toBe(host.mobile);
  });

  test('withdrawing a room takes it off the host board', async () => {
    const host = await newHost();
    const room = await postRoom(host.accessToken, 'live-host-rooms: withdrawn');

    const del = await fetch(`${API}/flatmates/rooms/${room.id}`, {
      method: 'DELETE',
      headers: auth(host.accessToken),
    });
    expect(del.status).toBe(204);

    const mine = await myRooms(host.accessToken);
    expect(mine.content.map((r) => r.id)).not.toContain(room.id);
  });

  /**
   * Withdrawing is not idempotent, and that is deliberate.
   *
   * A second `DELETE` answering 204 would mean "the room is gone" and "there was never such a room"
   * are the same reply, which is exactly the ambiguity a host hitting the button twice on a flaky
   * connection needs the server to resolve.
   */
  test('withdrawing a room that is already withdrawn is a 404, not a second success', async () => {
    const host = await newHost();
    const room = await postRoom(host.accessToken, 'live-host-rooms: twice');

    expect((await fetch(`${API}/flatmates/rooms/${room.id}`, { method: 'DELETE', headers: auth(host.accessToken) })).status).toBe(204);
    expect((await fetch(`${API}/flatmates/rooms/${room.id}`, { method: 'DELETE', headers: auth(host.accessToken) })).status).toBe(404);
  });

  /** Two genuinely different accounts, because the refusal being tested is about identity. */
  test('somebody else cannot withdraw my room', async () => {
    const host = await newHost();
    const stranger = await newHost();
    const room = await postRoom(host.accessToken, 'live-host-rooms: not yours');

    const del = await fetch(`${API}/flatmates/rooms/${room.id}`, {
      method: 'DELETE',
      headers: auth(stranger.accessToken),
    });
    expect(del.status).toBe(403);

    // And the room survived the attempt — a 403 that still deleted would be the worse bug.
    const mine = await myRooms(host.accessToken);
    expect(mine.content.map((r) => r.id)).toContain(room.id);
  });

  test('the host board is caller-scoped, not a filter the caller could widen', async () => {
    const host = await newHost();
    const stranger = await newHost();
    const room = await postRoom(host.accessToken, 'live-host-rooms: scoping');

    const theirs = await myRooms(stranger.accessToken);
    expect(theirs.content.map((r) => r.id)).not.toContain(room.id);
  });

  test('the host board requires a caller', async () => {
    const res = await fetch(`${API}/me/flatmate-rooms`);
    expect(res.status).toBe(401);
  });
});
