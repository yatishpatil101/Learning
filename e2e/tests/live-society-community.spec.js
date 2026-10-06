import { expect, test } from '@playwright/test';
import { API, apiLogin, authHeaders, uniqueMobile } from '../helpers/liveAuth.js';
import { mintSociety } from '../helpers/liveSociety.js';

// Society Q&A and noticeboard, API-level, against the live backend. Edge cases are in SocietyCommunityTest.

/** The seeded platform admin. Only a small back-office seed exists and this is the one every live spec uses. */
const OPS = '9000000000';

const minted = new Set();

/** `uniqueMobile()` is a timestamp tail and collides inside one millisecond. */
async function newAccount() {
  let mobile = uniqueMobile();
  while (minted.has(mobile)) {
    await new Promise((r) => setTimeout(r, 2));
    mobile = uniqueMobile();
  }
  minted.add(mobile);
  await apiLogin(mobile, { api: API });
  return mobile;
}

// Minted rather than taken from the directory: `fullyParallel` workers cannot arbitrate a shared society.
// The seeded society fixture stays untouched because live-society-residency anchors on it.
async function freshSociety(request) {
  return mintSociety(request, await newAccount(), 'Community');
}

/** Verify `mobile` into `flat` the long way round, through the ops queue. */
async function makeResident(request, mobile, slug, flat) {
  const applied = await request.post(`${API}/societies/${slug}/residents`, {
    headers: await authHeaders(mobile),
    data: { flat, relation: 'owner' },
  });
  expect(applied.status()).toBe(200);
  const { id } = await applied.json();

  const decided = await request.patch(`${API}/societies/${slug}/residents/${id}`, {
    headers: await authHeaders(OPS),
    data: { status: 'verified' },
  });
  expect(decided.status()).toBe(200);
  return id;
}

test.describe('society community', () => {
  test('a question is readable with no token at all, and answers carry a live resident badge', async ({ request }) => {
    const slug = await freshSociety(request);
    const asker = await newAccount();
    const resident = await newAccount();
    await makeResident(request, resident, slug, '1101');

    const asked = await request.post(`${API}/societies/${slug}/questions`, {
      headers: await authHeaders(asker),
      data: { body: 'Is there a power backup for the lifts?' },
    });
    expect(asked.status()).toBe(201);
    const question = await asked.json();
    // The asker has no flat here. That is deliberate: the person with the most to ask about a
    // building has not moved into it, so questions are not resident-gated.
    expect(question.authorIsResident).toBe(false);
    expect(question.answers).toEqual([]);

    const answered = await request.post(
      `${API}/societies/${slug}/questions/${question.id}/answers`,
      { headers: await authHeaders(resident), data: { body: 'Yes, DG backup on both lifts.' } },
    );
    expect(answered.status()).toBe(201);
    expect((await answered.json()).authorIsResident).toBe(true);

    // No Authorization header: the read a visitor gets before they have an account.
    const publicRead = await request.get(`${API}/societies/${slug}/hub`);
    expect(publicRead.status()).toBe(200);
    const { content } = (await publicRead.json()).questions;
    const mine = content.find((q) => q.id === question.id);
    expect(mine, 'the question we just asked').toBeTruthy();
    expect(mine.answers).toHaveLength(1);
    expect(mine.answers[0].authorIsResident).toBe(true);
    // A display name and nothing else. A question is not a transaction — there is nobody here for
    // a reader to ring, so no mobile leaves the server.
    expect(mine.authorName).toBeTruthy();
    expect(JSON.stringify(mine)).not.toContain(asker);
  });

});
