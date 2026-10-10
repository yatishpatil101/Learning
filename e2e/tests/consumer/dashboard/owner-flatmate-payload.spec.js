import { test, expect } from '@playwright/test';
import { API, apiLogin, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const track = flatmateCleanup(test);

const CARD_HIDDEN = ['members', 'ownerMobile', 'ownerName', 'ownerConsentMobile', 'addressFingerprint', 'flagForReview', 'verificationTier', 'reviewStatus', 'preferences'];

async function newUser() {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);
  return { mobile, accessToken };
}

async function createGroup(host, policy) {
  const res = await fetch(`${API}/flatmates/groups`, {
    method: 'POST',
    headers: auth(host.accessToken),
    body: JSON.stringify({
      title: `Owner payload ${Date.now().toString(36)}`, name: 'Host', locality: 'Baner', rent: 30000,
      seats: 2, seatsOpen: 1, policy, role: 'tenant',
    }),
  });
  expect(res.status, await res.clone().text()).toBe(201);
  const group = await res.json();
  track('groups', group.id, host.accessToken);
  const admin = await apiLogin(ACTORS.admin);
  const live = await fetch(`${API}/admin/flatmates/${group.id}/moderation`, {
    method: 'PATCH', headers: auth(admin.accessToken), body: JSON.stringify({ modStatus: 'live', note: 'e2e' }),
  });
  expect(live.status).toBeLessThan(300);
  return group;
}

test.describe('Owner flatmate lists and inbox (live API)', () => {
  test('my groups is a card: seats and moderation state, no members, contact or claim forensics', async () => {
    const host = await newUser();
    const group = await createGroup(host, 'any');

    const res = await fetch(`${API}/me/flatmate-groups?size=100`, { headers: auth(host.accessToken) });
    expect(res.status).toBe(200);
    const row = (await res.json()).content.find((g) => g.id === group.id);
    expect(row, 'the host sees their own group').toBeTruthy();
    expect(CARD_HIDDEN.filter((k) => k in row)).toEqual([]);
    expect(row).toMatchObject({ seatsTotal: 2, memberCount: 1, locality: 'Baner' });
  });

  test('an own seeker post is read by id for the edit form, and never by another account', async () => {
    const author = await newUser();
    const stranger = await newUser();
    const moveIn = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    const created = await fetch(`${API}/flatmates/posts`, {
      method: 'POST',
      headers: auth(author.accessToken),
      body: JSON.stringify({
        name: 'Poster', gender: 'female', age: 26, occupation: 'Designer', budget: 18000,
        localities: ['Baner'], moveIn, flatPref: 'women', roomPref: 'private', tags: ['Vegetarian'],
      }),
    });
    expect(created.status, await created.clone().text()).toBe(201);
    const post = await created.json();
    track('posts', post.id, author.accessToken);

    const own = await fetch(`${API}/me/flatmate-posts/${post.id}`, { headers: auth(author.accessToken) });
    expect(own.status).toBe(200);
    expect(await own.json()).toMatchObject({ id: post.id, mobile: author.mobile });
    const other = await fetch(`${API}/me/flatmate-posts/${post.id}`, { headers: auth(stranger.accessToken) });
    expect(other.status).toBe(404);
  });

  test('the requester number is masked on the host inbox until the host accepts', async () => {
    const host = await newUser();
    const seeker = await newUser();
    const group = await createGroup(host, 'women');
    const masked = `${seeker.mobile.slice(0, 2)}XXXXX${seeker.mobile.slice(-3)}`;

    const join = await fetch(`${API}/flatmates/groups/${group.id}/join`, {
      method: 'POST', headers: auth(seeker.accessToken), body: JSON.stringify({}),
    });
    expect(join.status, await join.clone().text()).toBe(201);

    const inbox = async () => (await (await fetch(`${API}/me/flatmate-requests?size=100`, {
      headers: auth(host.accessToken),
    })).json()).content.find((r) => r.targetId === group.id);
    const pending = await inbox();
    expect(pending.status).toBe('pending');
    expect(pending.requesterMobile).toBe(masked);

    const decided = await fetch(`${API}/me/flatmate-requests/${pending.id}`, {
      method: 'PATCH', headers: auth(host.accessToken), body: JSON.stringify({ decision: 'accepted' }),
    });
    expect(decided.status).toBe(200);
    expect((await decided.json()).requesterMobile).toBe(seeker.mobile);
    expect((await inbox()).requesterMobile).toBe(seeker.mobile);
  });
});
