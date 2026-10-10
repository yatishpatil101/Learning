import { test, expect } from '@playwright/test';
import { API, apiLogin, uniqueMobile } from '../../../helpers/liveAuth.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';
import { tenantRoomAgreement } from '../../../helpers/flatmateAgreement.js';
import { withSocietyId } from '../../../helpers/liveSociety.js';

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const track = flatmateCleanup(test);

async function newHost() {
  const { accessToken } = await apiLogin(uniqueMobile());
  return accessToken;
}

let addresses = 0;
const newSociety = () => `Terms Test ${Date.now().toString(36)}-${(addresses += 1)}`;

async function postRoom(token, overrides = {}) {
  const agreement = await tenantRoomAgreement(token);
  const res = await fetch(`${API}/flatmates/rooms`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify({
      bhk: '2',
      roomType: 'Private room',
      locality: 'Baner',
      ...(await withSocietyId(token, { society: newSociety() })),
      rentShare: 16000,
      availableFrom: '2026-12-01',
      photos: ['https://cdn.example.com/room.png'],
      ...agreement,
      ...overrides,
    }),
  });
  return res;
}

async function createdRoom(token, overrides = {}) {
  const res = await postRoom(token, overrides);
  expect(res.status, 'posting a room').toBe(201);
  const room = await res.json();
  track('rooms', room.id, token);
  return room;
}

test.describe('flatmate terms, occupancy and the budget range', () => {
  test('a room carries its occupancy and its four terms back out of the server', async () => {
    const token = await newHost();
    const room = await createdRoom(token, {
      occupants: 2,
      maxOccupants: 4,
      deposit: 32000,
      noticePeriodDays: 30,
      lockInMonths: 6,
      maintenanceBilling: 'included',
      electricityBilling: 'shared',
    });

    const mine = await fetch(`${API}/me/flatmate-rooms`, { headers: auth(token) }).then((r) => r.json());
    const rows = mine.content || mine.items || mine;
    expect(rows.find((r) => r.id === room.id)).toMatchObject({ occupants: 2 });
    const detail = await fetch(`${API}/flatmates/rooms/${room.id}`, { headers: auth(token) }).then((r) => r.json());
    expect(detail.item).toMatchObject({
      maxOccupants: 4,
      deposit: 32000,
      noticePeriodDays: 30,
      lockInMonths: 6,
      maintenanceBilling: 'included',
      electricityBilling: 'shared',
    });
  });

  test('a term the host did not state stays unstated rather than defaulting to included', async () => {
    const token = await newHost();
    const room = await createdRoom(token);

    expect(room.maintenanceBilling ?? null).toBeNull();
    expect(room.electricityBilling ?? null).toBeNull();
    expect(room.noticePeriodDays ?? null).toBeNull();
    expect(room.lockInMonths ?? null).toBeNull();
  });

  test('a billing split the vocabulary does not know is refused', async () => {
    const res = await postRoom(await newHost(), { maintenanceBilling: 'call me' });

    expect(res.status, 'an unknown billing token').toBe(400);
    expect((await res.json()).message).toMatch(/included, separate, shared/);
  });

  test('a group takes a deposit and the same terms a room does', async () => {
    const token = await newHost();
    const res = await fetch(`${API}/flatmates/groups`, {
      method: 'POST',
      headers: auth(token),
      body: JSON.stringify({
        title: `Terms Group ${Date.now().toString(36)}`,
        name: 'Asha K',
        locality: 'Baner',
        rent: 40000,
        deposit: 80000,
        seats: 3,
        seatsOpen: 1,
        policy: 'any',
        role: 'tenant',
        noticePeriodDays: 45,
        lockInMonths: 11,
        maintenanceBilling: 'separate',
        electricityBilling: 'separate',
      }),
    });
    expect(res.status).toBe(201);
    const group = await res.json();
    track('groups', group.id, token);

    expect(group).toMatchObject({
      deposit: 80000,
      noticePeriodDays: 45,
      lockInMonths: 11,
      maintenanceBilling: 'separate',
      electricityBilling: 'separate',
    });
  });

  test('a group must say where it is rather than being filed under a default locality', async () => {
    const res = await fetch(`${API}/flatmates/groups`, {
      method: 'POST',
      headers: auth(await newHost()),
      body: JSON.stringify({
        title: `No Locality ${Date.now().toString(36)}`,
        name: 'Asha K',
        rent: 40000,
        seats: 3,
        seatsOpen: 1,
        policy: 'any',
        role: 'tenant',
      }),
    });

    expect(res.status, 'a group with no locality').toBe(422);
    expect((await res.json()).fields.map((f) => f.field)).toContain('locality');
  });

  test('a seeker states a budget range, and a ceiling under the floor is refused', async () => {
    const token = await newHost();
    const body = {
      name: 'Range Seeker',
      gender: 'female',
      age: 26,
      occupation: 'Engineer',
      budget: 15000,
      localities: ['Baner'],
      moveIn: '2026-12-01',
      flatPref: 'women',
      roomPref: 'private',
    };

    const ok = await fetch(`${API}/flatmates/posts`, {
      method: 'POST', headers: auth(token), body: JSON.stringify({ ...body, budgetMax: 22000 }),
    });
    expect(ok.status).toBe(201);
    const post = await ok.json();
    track('posts', post.id, token);
    expect(post).toMatchObject({ budget: 15000, budgetMax: 22000 });

    const inverted = await fetch(`${API}/flatmates/posts`, {
      method: 'POST', headers: auth(await newHost()), body: JSON.stringify({ ...body, budgetMax: 9000 }),
    });
    expect(inverted.status, 'a ceiling below the floor').toBe(422);
    expect((await inverted.json()).message).toMatch(/cannot be below/i);
  });

  test('a room may be posted before it has been photographed, but not published', async () => {
    const token = await newHost();

    const pictured = await createdRoom(token);
    expect(pictured.modStatus, 'below owner tier even a photographed room waits for Ops').toBe('pending');

    const pictureless = await createdRoom(token, { photos: [] });
    expect(pictureless.photos, 'an omitted gallery must arrive empty, not null').toEqual([]);
    expect(pictureless.modStatus, 'a pictureless room must not put itself on the board').toBe('pending');
  });
});
