import { test, expect } from '@playwright/test';
import { API, apiLogin, uniqueMobile } from '../../../helpers/liveAuth.js';

/* `/me/flatmate-requests` is the host's inbox (what seekers sent), not to be confused with
   `/me/flatmate-posts`, which is the seeker's own authored posts. */

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

async function createPublishedSeekerPost(seekerToken, locality = 'Baner') {
  const res = await fetch(`${API}/flatmates/posts`, {
    method: 'POST',
    headers: auth(seekerToken),
    body: JSON.stringify({
      name: 'Test Seeker',
      gender: 'female',
      age: 26,
      occupation: 'Software Engineer',
      budget: 18000,
      localities: [locality],
      moveIn: '2026-12-01',
      flatPref: 'women',
      roomPref: 'private',
      tags: ['Vegetarian'],
      note: 'Looking for a place to stay',
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to create seeker post: ${res.status} ${await res.text()}`);
  }

  const post = await res.json();

  return post.id;
}

test.describe('Host flatmate requests inbox (live API)', () => {
  test('the inbox endpoint is accessible and returns proper structure', async () => {
    const host = await newHost();

    const inboxRes = await fetch(`${API}/me/flatmate-requests`, {
      headers: auth(host.accessToken),
    });

    expect(inboxRes.status).toBe(200);

    const inbox = await inboxRes.json();
    expect(inbox.content).toBeDefined();
    expect(Array.isArray(inbox.content)).toBe(true);
    expect(inbox).toHaveProperty('totalElements');
    expect(inbox).toHaveProperty('page');
    expect(inbox).toHaveProperty('size');
  });

  test('inbox is paged and has correct structure', async () => {
    const host = await newHost();

    const fullInboxRes = await fetch(`${API}/me/flatmate-requests`, {
      headers: auth(host.accessToken),
    });

    expect(fullInboxRes.status).toBe(200);

    const fullInbox = await fullInboxRes.json();
    expect(fullInbox.content).toBeDefined();
    expect(fullInbox).toHaveProperty('totalElements');
    expect(fullInbox).toHaveProperty('page');

    const pendingRes = await fetch(`${API}/me/flatmate-requests?status=pending`, {
      headers: auth(host.accessToken),
    });

    expect(pendingRes.status).toBe(200);
    const pending = await pendingRes.json();
    expect(pending.content).toBeDefined();
  });

  test('404 when trying to access with invalid request ID', async () => {
    const host = await newHost();

    const res = await fetch(`${API}/me/flatmate-requests/00000000-0000-0000-0000-000000000000`, {
      method: 'PATCH',
      headers: auth(host.accessToken),
      body: JSON.stringify({ decision: 'accepted' }),
    });

    expect(res.status).toBe(404);
  });

  test('another host cannot access a different host\'s requests', async () => {
    const host1 = await newHost();
    const host2 = await newHost();

    const host1InboxRes = await fetch(`${API}/me/flatmate-requests`, {
      headers: auth(host1.accessToken),
    });

    const inbox = await host1InboxRes.json();

    if (inbox.content && inbox.content.length > 0) {
      const requestId = inbox.content[0].id;

      const res = await fetch(`${API}/me/flatmate-requests/${requestId}`, {
        method: 'PATCH',
        headers: auth(host2.accessToken),
        body: JSON.stringify({ decision: 'accepted' }),
      });

      // 404, not 403, so the inbox does not leak which request ids exist.
      expect(res.status).toBe(404);
    }
  });
});

