// @ts-check
/**
 * The society hub's community tab, against the live API (D240 slice 3).
 *
 * Every tip, every recommended electrician and every photo of the actual lobby used to live in
 * `dzSocietyContributions` in the author's own browser. The "community" tab showed each visitor a
 * community of exactly one person: themselves. The single most useful thing on the page — a
 * neighbour's number for a plumber who turns up — was only ever visible to somebody who already
 * had it.
 *
 * API-level rather than a browser walk, for the same reason as the sibling residency and Q&A
 * specs: what is being proved here is that the writes leave the device and that the server decides
 * who may see what. The hub does not read these endpoints until slice C7 repoints it.
 */
import { expect, test } from '@playwright/test';
import { API, apiLogin, authHeaders, uniqueMobile } from '../helpers/liveAuth.js';
import { mintSociety } from '../helpers/liveSociety.js';

/** The seeded platform admin. Real staff mobiles are not guessable and an invented one 403s. */
const OPS = '9000000000';

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

    const res = await request.get(`${API}/societies/${slug}/contributions`);
    expect(res.status()).toBe(200);
    const page = await res.json();
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

  test("a recommended person's number is withheld from a reader with no account", async ({ request }) => {
    const slug = await freshSociety(request);
    const author = await newAccount();
    const contact = `98${String(Date.now()).slice(-8)}`;
    const created = await share(request, author, slug, {
      kind: 'pick',
      referralName: 'Vishal the electrician',
      referralContact: contact,
      body: 'Same day, fair rates.',
    });
    expect(created.status(), await created.text()).toBe(201);

    const anon = await (await request.get(`${API}/societies/${slug}/contributions`)).json();
    const publicRow = anon.content.find((c) => c.referralName === 'Vishal the electrician');
    expect(publicRow, 'the pick to be publicly visible').toBeTruthy();
    // The rest of the recommendation stays visible — it still reads as a recommendation. Only the
    // third party's number, which they never agreed to put on the open web, is held back.
    expect(publicRow.referralContact).toBeFalsy();

    const reader = await newAccount();
    const signedIn = await (
      await request.get(`${API}/societies/${slug}/contributions`, {
        headers: await authHeaders(reader),
      })
    ).json();
    const privateRow = signedIn.content.find((c) => c.referralName === 'Vishal the electrician');
    expect(privateRow.referralContact).toBe(contact);
  });

  test('marking helpful twice is one vote — the whole reason it is not a toggle', async ({ request }) => {
    const slug = await freshSociety(request);
    const author = await newAccount();
    const voter = await newAccount();
    const id = await shareTip(request, author, slug, 'Lift B is the fast one.');
    const url = `${API}/societies/${slug}/contributions/${id}/helpful`;

    const first = await request.put(url, { headers: await authHeaders(voter) });
    expect(first.status()).toBe(200);
    expect(await first.json()).toMatchObject({ helpfulCount: 1, helpfulByMe: true });

    // A retry after a dropped connection. A toggle would undo the vote it just cast, and neither
    // side could tell that apart from a deliberate second tap.
    const retry = await request.put(url, { headers: await authHeaders(voter) });
    expect(await retry.json()).toMatchObject({ helpfulCount: 1, helpfulByMe: true });

    const cleared = await request.delete(url, { headers: await authHeaders(voter) });
    expect(await cleared.json()).toMatchObject({ helpfulCount: 0, helpfulByMe: false });

    // Withdrawing a vote never cast is also a no-op, not a 404.
    const again = await request.delete(url, { headers: await authHeaders(voter) });
    expect(again.status()).toBe(200);
    expect(await again.json()).toMatchObject({ helpfulCount: 0 });
  });

  test('the most helpful tip outranks the newest one', async ({ request }) => {
    const slug = await freshSociety(request);
    const author = await newAccount();
    const voter = await newAccount();
    const older = await shareTip(request, author, slug, 'Older but useful.');
    const newer = await shareTip(request, author, slug, 'Newer and unvoted.');

    const before = await (await request.get(`${API}/societies/${slug}/contributions`)).json();
    expect(before.content[0].id, 'newest first until somebody weighs in').toBe(newer);

    const voted = await request.put(`${API}/societies/${slug}/contributions/${older}/helpful`, {
      headers: await authHeaders(voter),
    });
    expect(voted.status()).toBe(200);

    const after = await (await request.get(`${API}/societies/${slug}/contributions`)).json();
    expect(after.content[0].id).toBe(older);
    expect(after.content[1].id).toBe(newer);
  });

  test('each kind carries its own minimum, and a stray number on a tip is dropped', async ({ request }) => {
    const slug = await freshSociety(request);
    const mobile = await newAccount();

    expect((await share(request, mobile, slug, { kind: 'tip' })).status()).toBe(400);
    expect((await share(request, mobile, slug, { kind: 'pick', body: 'Great chap' })).status()).toBe(400);
    expect((await share(request, mobile, slug, { kind: 'photo', body: 'The lobby' })).status()).toBe(400);
    expect((await share(request, mobile, slug, { kind: 'rumour', body: 'I heard' })).status()).toBe(400);

    // The composer draws no referral fields for a tip, so a 400 would point at something the
    // author cannot see. Dropping them also keeps a stray contact detail off a row that offers
    // nobody a way to have it removed.
    const dropped = await share(request, mobile, slug, {
      kind: 'tip',
      body: 'Park on the left.',
      referralName: 'Someone',
      referralContact: '9822009988',
      photoUrl: 'https://cdn.example/x.jpg',
    });
    expect(dropped.status(), await dropped.text()).toBe(201);
    const row = await dropped.json();
    expect(row.referralName).toBeFalsy();
    expect(row.referralContact).toBeFalsy();
    expect(row.photoUrl).toBeFalsy();
  });

  test('a reply belongs to its own author, not to the tip it sits under', async ({ request }) => {
    const slug = await freshSociety(request);
    const author = await newAccount();
    const replier = await newAccount();
    const id = await shareTip(request, author, slug, 'The society has a shared drill.');

    const posted = await request.post(`${API}/societies/${slug}/contributions/${id}/replies`, {
      headers: await authHeaders(replier),
      data: { body: 'Who holds it?' },
    });
    expect(posted.status(), await posted.text()).toBe(201);
    const replyId = (await posted.json()).id;

    const listed = await (await request.get(`${API}/societies/${slug}/contributions`)).json();
    const parent = listed.content.find((c) => c.id === id);
    expect(parent.replies.map((r) => r.body)).toContain('Who holds it?');

    // Owning a tip does not make you the moderator of the conversation about it.
    const byTipAuthor = await request.delete(
      `${API}/societies/${slug}/contributions/${id}/replies/${replyId}`,
      { headers: await authHeaders(author) },
    );
    expect(byTipAuthor.status()).toBe(403);

    const byReplier = await request.delete(
      `${API}/societies/${slug}/contributions/${id}/replies/${replyId}`,
      { headers: await authHeaders(replier) },
    );
    expect(byReplier.status()).toBe(204);
  });

  test('a neighbour cannot remove your tip; you and staff can, and the thread goes with it', async ({ request }) => {
    const slug = await freshSociety(request);
    const author = await newAccount();
    const neighbour = await newAccount();
    const id = await shareTip(request, author, slug, 'Visitor parking fills by 8pm.');

    await request.post(`${API}/societies/${slug}/contributions/${id}/replies`, {
      headers: await authHeaders(neighbour),
      data: { body: 'Confirmed.' },
    });

    const byNeighbour = await request.delete(`${API}/societies/${slug}/contributions/${id}`, {
      headers: await authHeaders(neighbour),
    });
    expect(byNeighbour.status(), 'residency buys contributing, not moderating').toBe(403);

    const byAuthor = await request.delete(`${API}/societies/${slug}/contributions/${id}`, {
      headers: await authHeaders(author),
    });
    expect(byAuthor.status()).toBe(204);

    const after = await (await request.get(`${API}/societies/${slug}/contributions`)).json();
    expect(after.content.find((c) => c.id === id), 'the tip and its thread are gone').toBeFalsy();

    // Staff moderate anybody's, on any society — ops run an unclaimed page.
    const theirs = await shareTip(request, neighbour, slug, 'The terrace is open till 10.');
    const byOps = await request.delete(`${API}/societies/${slug}/contributions/${theirs}`, {
      headers: await authHeaders(OPS),
    });
    expect(byOps.status()).toBe(204);
  });

  test('writing needs an account; reading does not; and another society cannot reach it', async ({ request }) => {
    const here = await freshSociety(request);
    const elsewhere = await freshSociety(request);
    const mobile = await newAccount();

    const anonWrite = await request.post(`${API}/societies/${here}/contributions`, {
      headers: { 'content-type': 'application/json' },
      data: { kind: 'tip', body: 'Hello' },
    });
    expect(anonWrite.status()).toBe(401);
    expect((await request.get(`${API}/societies/${here}/contributions`)).status()).toBe(200);

    const id = await shareTip(request, mobile, here, 'Gate 2 is closed at night.');
    // Without the re-check, a card could be voted on or deleted through a URL where the result
    // would be invisible — the hub only ever reads a society's own list.
    const crossVote = await request.put(
      `${API}/societies/${elsewhere}/contributions/${id}/helpful`,
      { headers: await authHeaders(mobile) },
    );
    expect(crossVote.status()).toBe(404);

    expect((await request.get(`${API}/societies/no-such-society-anywhere/contributions`)).status()).toBe(404);
  });

  test('the seeded fixture carries all three kinds, a vote and a thread', async ({ request }) => {
    // The point of seeding rather than waiving: a hub whose community tab is empty on every fresh
    // database renders an empty state and proves nothing, and a spec that posts then reads back is
    // equally happy against a tab that only ever shows you your own writes.
    const res = await request.get(`${API}/societies/blue-ridge-towers-hinjawadi/contributions`);
    expect(res.status()).toBe(200);
    const rows = (await res.json()).content;

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
