// @ts-check
// Society community tab, API-level, against the live backend. Edge cases are in SocietyContributionTest.
import { expect, test } from '@playwright/test';
import { API, apiLogin, authHeaders, uniqueMobile } from '../helpers/liveAuth.js';
import { mintSociety } from '../helpers/liveSociety.js';

const minted = new Set();

/**
 * A brand-new account, guaranteed distinct from every other one this file makes.
 *
 * `uniqueMobile()` is derived from the clock, so two calls inside the same millisecond collide and
 * the second silently signs in as the first — which turns an authorship test into a tautology.
 */
async function newAccount() {
  for (let i = 0; i < 40; i += 1) {
    const mobile = uniqueMobile();
    if (!minted.has(mobile)) {
      minted.add(mobile);
      await apiLogin(mobile, { api: API });
      return mobile;
    }
    await new Promise((r) => setTimeout(r, 2));
  }
  throw new Error('could not mint a unique mobile');
}

/**
 * A society nobody else in this run is writing to.
 *
 * Minted rather than picked out of the directory: the live database is shared across the whole
 * suite, and the old picker's `used` set was module-scoped, so `fullyParallel` gave each worker its
 * own empty copy and two tests of this one file could write to the same building. An unclaimed row
 * also has no sitting committee, which keeps the moderation assertions honest — the only person who
 * can remove something is its author or staff — and a freshly minted one is unclaimed.
 */
async function freshSociety(request) {
  return mintSociety(request, await newAccount(), 'Contributions');
}

async function share(request, mobile, slug, payload) {
  return request.post(`${API}/societies/${slug}/contributions`, {
    headers: await authHeaders(mobile),
    data: payload,
  });
}

async function shareTip(request, mobile, slug, body) {
  const res = await share(request, mobile, slug, { kind: 'tip', body });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).id;
}

test.describe('society community tab (live)', () => {
  test('a tip is readable with no account at all — that is what the page is for', async ({ request }) => {
    const slug = await freshSociety(request);
    const author = await newAccount();
    await shareTip(request, author, slug, 'The back gate is quicker before 9am.');

    const res = await request.get(`${API}/societies/${slug}/hub`);
    expect(res.status()).toBe(200);
    const page = (await res.json()).contributions;
    const mine = page.content.find((c) => c.body === 'The back gate is quicker before 9am.');
    expect(mine, 'the tip to be readable without a token').toBeTruthy();
    // Most e2e accounts have no profile name, which is also the state of most real users on their
    // first visit. A null here renders a blank byline beside a real sentence.
    expect(mine.authorName).toBeTruthy();
    expect(mine.helpfulCount).toBe(0);
    expect(mine.helpfulByMe).toBe(false);
    // A reader with no account has nothing to remove, so no control is offered.
    expect(mine.canRemove).toBe(false);
    expect(mine.replies).toEqual([]);
  });

  test('the author removing their own tip takes it, and its thread, off the public list', async ({ request }) => {
    const slug = await freshSociety(request);
    const author = await newAccount();
    const neighbour = await newAccount();
    const id = await shareTip(request, author, slug, 'Visitor parking fills by 8pm.');

    const reply = await request.post(`${API}/societies/${slug}/contributions/${id}/replies`, {
      headers: await authHeaders(neighbour),
      data: { body: 'Confirmed.' },
    });
    expect(reply.status(), await reply.text()).toBe(201);

    const byAuthor = await request.delete(`${API}/societies/${slug}/contributions/${id}`, {
      headers: await authHeaders(author),
    });
    expect(byAuthor.status()).toBe(204);

    const after = (await (await request.get(`${API}/societies/${slug}/hub`)).json()).contributions;
    expect(after.content.find((c) => c.id === id), 'the tip and its thread are gone').toBeFalsy();
  });

  test('the seeded fixture carries all three kinds, a vote and a thread', async ({ request }) => {
    // The point of seeding rather than waiving: a hub whose community tab is empty on every fresh
    // database renders an empty state and proves nothing, and a spec that posts then reads back is
    // equally happy against a tab that only ever shows you your own writes.
    const res = await request.get(`${API}/societies/blue-ridge-towers-hinjawadi/hub`);
    expect(res.status()).toBe(200);
    const rows = (await res.json()).contributions.content;

    const pick = rows.find((c) => c.referralName === 'Vishal Kadam (electrician)');
    expect(pick, 'the seeded trusted pick').toBeTruthy();
    // Voted for by somebody other than its author — the state a counter column cannot represent.
    expect(pick.helpfulCount).toBeGreaterThanOrEqual(1);
    expect(pick.helpfulByMe).toBe(false);
    expect(pick.replies.length).toBeGreaterThanOrEqual(1);
    // Anonymous read: the electrician's number is not on the open web.
    expect(pick.referralContact).toBeFalsy();

    const photo = rows.find((c) => c.kind === 'photo' && c.photoUrl);
    expect(photo, 'the seeded photo').toBeTruthy();
    // A URL, never a data URI. Base64 in localStorage is exactly why a shared photo used to be
    // invisible on every device except the one that shared it.
    expect(photo.photoUrl.startsWith('https://')).toBe(true);

    expect(rows.some((c) => c.kind === 'tip'), 'the seeded tip').toBe(true);
  });
});
