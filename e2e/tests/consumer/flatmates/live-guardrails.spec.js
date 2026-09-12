import { test, expect } from '@playwright/test';
import { API, apiLogin, uniqueMobile } from '../../../helpers/liveAuth.js';
import { ACTORS } from '../../../fixtures/live.js';
import { flatmateCleanup } from '../../../helpers/flatmateCleanup.js';

/**
 * Anti-broker guardrails against a real server.
 *
 * ## What this proves
 *
 * 1. **Per-identity cap (server-enforced).** One identity may hold at most 3 non-owner-tier live
 *    flatmate posts (rooms + groups combined). The fourth creation attempt receives a 409 with the
 *    `host_capped` sub-code. The cap is verified at the API layer, not by trusting a browser guard.
 * 2. **Address dedupe, same host.** The same host cannot list the same physical flat twice — the
 *    fingerprint (`addr:normalised_title|normalised_locality`) collides and the server refuses
 *    with `duplicate_address`.
 * 3. **Address dedupe, different host.** A different host claiming an already-claimed address still
 *    posts (the creation succeeds), but the server marks it `flagForReview: true` for Ops. This is
 *    the important direction: flagged, not blocked — a false-positive address collision from two
 *    genuinely different flats in one large society should never refuse an honest post.
 * 4. **D71 takedown.** A live seeker post can be soft-archived via `DELETE /flatmates/posts/{id}`,
 *    which relieves the poster's cap. After the takedown, the same identity can create again.
 *
 * ## Why API-level
 *
 * The guardrails are the server's decision: the frontend's `evaluateHostEligibility()` is advisory
 * only, reading localStorage counts that any open console can reset. A browser-level guardrails
 * spec would be testing the suggestion, not the enforcement. The claims here are about the insert
 * path, which only the backend owns.
 *
 * ## What is deliberately NOT asserted
 *
 * - The browser's toast or error message. The client reads the 409 body and renders the `reason`
 *   field; that mapping is a UI concern already covered by the mock twin's DOM checks.
 * - Owner-tier exemption. An owner needs a verified property to reach that tier, and the
 *   property seam is not in scope here; `live-host-rooms.spec.js` exercises it.
 * - The moderation queue entry for a flagged post — `live-moderate-before-public.spec.js` owns
 *   the moderation whitelist.
 */

const auth = (token) => ({ 'content-type': 'application/json', authorization: `Bearer ${token}` });
const track = flatmateCleanup(test);

function groupBody(title, locality = 'Baner') {
  return {
    title,
    name: 'Guardrail Host',
    locality,
    rent: 30000,
    seats: 3,
    seatsOpen: 1,
    policy: 'any',
    role: 'tenant',
  };
}

async function createGroup(token, title, locality) {
  const res = await fetch(`${API}/flatmates/groups`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify(groupBody(title, locality)),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 201 && body.id) track('groups', body.id, token);
  return { status: res.status, body };
}

function postBody() {
  return {
    name: 'Guardrail Seeker',
    gender: 'female',
    age: 25,
    occupation: 'Engineer',
    budget: 15000,
    localities: ['Baner'],
    moveIn: '2026-12-01',
    flatPref: 'any',
    roomPref: 'any',
    tags: [],
    note: 'Guardrail takedown spec',
  };
}

async function createPost(token) {
  const res = await fetch(`${API}/flatmates/posts`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify(postBody()),
  });
  const body = await res.text();
  expect(res.status, body).toBe(201);
  const post = JSON.parse(body);
  track('posts', post.id, token);
  return post;
}

async function approve(id) {
  const { accessToken } = await apiLogin(ACTORS.admin);
  const res = await fetch(`${API}/admin/flatmates/${id}/moderation`, {
    method: 'PATCH',
    headers: auth(accessToken),
    body: JSON.stringify({ modStatus: 'live', note: 'e2e guardrails' }),
  });
  expect(res.status, `approve ${id}: ${await res.clone().text()}`).toBeLessThan(300);
}

test('per-identity cap: a 4th non-owner group is refused with host_capped', async () => {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);

  // Create three groups — each with a distinct title so fingerprints differ.
  const tag = Date.now().toString(36);
  for (let i = 1; i <= 3; i++) {
    const { status, body } = await createGroup(accessToken, `Cap ${tag} group ${i}`, 'Baner');
    expect(status, `group ${i} should create: ${JSON.stringify(body)}`).toBe(201);
  }

  // The fourth must be refused.
  const { status, body } = await createGroup(accessToken, `Cap ${tag} group 4`, 'Baner');
  expect(status, 'the 4th group must be refused').toBe(409);
  expect(body.message ?? body.error ?? '').toMatch(/host_capped/);
});

test('address dedupe: the same host cannot list the same flat twice', async () => {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);

  const title = `Dedupe ${Date.now().toString(36)} Society`;
  const { status: s1 } = await createGroup(accessToken, title, 'Kothrud');
  expect(s1).toBe(201);

  // Same title + same locality → same fingerprint → blocked.
  const { status: s2, body } = await createGroup(accessToken, title, 'Kothrud');
  expect(s2, 'duplicate address must be refused').toBe(409);
  expect(body.message ?? body.error ?? '').toMatch(/duplicate_address/);
});

test('address dedupe: a DIFFERENT host claiming the same address still posts (flagged, not blocked)', async () => {
  const tag = Date.now().toString(36);
  const title = `Contested ${tag} Society`;

  // Host A claims the address.
  const mobileA = uniqueMobile();
  const { accessToken: tokenA } = await apiLogin(mobileA);
  const { status: s1 } = await createGroup(tokenA, title, 'Hadapsar');
  expect(s1).toBe(201);

  // Host B claims the same address — not blocked, but flagged.
  const mobileB = uniqueMobile();
  const { accessToken: tokenB } = await apiLogin(mobileB);
  const { status: s2, body } = await createGroup(tokenB, title, 'Hadapsar');
  expect(s2, 'a different host must NOT be blocked').toBe(201);
  expect(body.flagForReview, 'the post must be flagged for Ops review').toBe(true);
});

test('D71 takedown: deleting a seeker post relieves the poster so they can post again', async () => {
  const mobile = uniqueMobile();
  const { accessToken } = await apiLogin(mobile);

  // A seeker's cap is 1 live post (server enforces `already_live`).
  const post = await createPost(accessToken);

  // Confirm the cap is hit: a second post is refused.
  const dupRes = await fetch(`${API}/flatmates/posts`, {
    method: 'POST',
    headers: auth(accessToken),
    body: JSON.stringify(postBody()),
  });
  expect(dupRes.status, 'second post should be refused').toBe(409);
  const dupBody = await dupRes.json().catch(() => ({}));
  expect(dupBody.message ?? dupBody.error ?? '').toMatch(/already_live/);

  // Take down the live post via DELETE.
  const delRes = await fetch(`${API}/flatmates/posts/${post.id}`, {
    method: 'DELETE',
    headers: auth(accessToken),
  });
  expect(delRes.status, 'DELETE should 204').toBe(204);

  // Now the poster can create again — the takedown relieved the cap.
  const retryRes = await fetch(`${API}/flatmates/posts`, {
    method: 'POST',
    headers: auth(accessToken),
    body: JSON.stringify(postBody()),
  });
  const retryBody = await retryRes.text();
  expect(retryRes.status, retryBody).toBe(201);
  const retryPost = JSON.parse(retryBody);
  track('posts', retryPost.id, accessToken);
});
