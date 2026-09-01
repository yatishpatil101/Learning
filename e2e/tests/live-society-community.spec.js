import { expect, test } from '@playwright/test';
import { API, apiLogin, authHeaders, uniqueMobile } from '../helpers/liveAuth.js';
import { mintSociety } from '../helpers/liveSociety.js';

/**
 * D240 slice 2 — society questions and the noticeboard, against the live API.
 *
 * ## What was actually broken
 *
 * Both surfaces lived in `localStorage`. A committee that posted "water off Tuesday 6-10am"
 * published it to itself; every answer a resident wrote to a prospective buyer's question was
 * stored in the resident's own browser and read by nobody. The hub rendered convincingly
 * throughout, which is why it survived this long.
 *
 * ## Why this is API-level rather than a browser walk
 *
 * `useSocietyHub.js` still reads localStorage — repointing it is slice C7 — so a UI-driven spec
 * today would be testing localStorage with extra steps. What these tests prove is the part no unit
 * test can: that the board really refuses a stranger over the wire, that the reads really are
 * reachable with no token at all, and that the resident badge really is recomputed rather than
 * frozen at posting time.
 *
 * ## Fixtures
 *
 * Every account is minted here. The seeded society fixture (`blue-ridge-towers-hinjawadi` and
 * `kumar-palaash-hinjawadi`) is deliberately *not* touched — `live-society-residency.spec.js`
 * anchors on it, and two specs writing to one society's queue would contend.
 */

/** The seeded platform admin. Only 16 staff/admin rows exist and this is the one every live spec uses. */
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

/**
 * A society no other test anywhere is using.
 *
 * Minted rather than taken from the directory. The old picker filtered on `claimStatus` and kept a
 * module-scoped `Set` of what it had used, but `fullyParallel` runs the tests of one file in
 * separate worker processes, so the `Set` was per worker and the societies were not — two tests
 * could and did land in the same building. Minting removes the contention instead of arbitrating
 * it, and the row arrives unclaimed, so verifying residents still goes through the ops queue rather
 * than needing a committee this spec has not created.
 */
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
    const publicRead = await request.get(`${API}/societies/${slug}/questions`);
    expect(publicRead.status()).toBe(200);
    const { content } = await publicRead.json();
    const mine = content.find((q) => q.id === question.id);
    expect(mine, 'the question we just asked').toBeTruthy();
    expect(mine.answers).toHaveLength(1);
    expect(mine.answers[0].authorIsResident).toBe(true);
    // A display name and nothing else. A question is not a transaction — there is nobody here for
    // a reader to ring, so no mobile leaves the server.
    expect(mine.authorName).toBeTruthy();
    expect(JSON.stringify(mine)).not.toContain(asker);
  });

  test('rejecting a resident retracts the badge from everything they already wrote', async ({ request }) => {
    const slug = await freshSociety(request);
    const resident = await newAccount();
    const residentId = await makeResident(request, resident, slug, '1202');

    const asked = await request.post(`${API}/societies/${slug}/questions`, {
      headers: await authHeaders(resident),
      data: { body: 'When is the next AGM?' },
    });
    expect(asked.status()).toBe(201);
    const { id } = await asked.json();

    let read = await request.get(`${API}/societies/${slug}/questions`);
    let found = (await read.json()).content.find((q) => q.id === id);
    expect(found.authorIsResident).toBe(true);

    // The committee later finds they never lived here.
    const rejected = await request.patch(`${API}/societies/${slug}/residents/${residentId}`, {
      headers: await authHeaders(OPS),
      data: { status: 'rejected' },
    });
    expect(rejected.status()).toBe(200);

    read = await request.get(`${API}/societies/${slug}/questions`);
    found = (await read.json()).content.find((q) => q.id === id);
    // The badge is recomputed, never stored. A frozen flag would go on asserting "verified
    // resident" forever, which is the one thing a trust badge must not do.
    expect(found.authorIsResident).toBe(false);
  });

  test('a stranger cannot post a notice, a verified resident can, and the board reads publicly', async ({ request }) => {
    const slug = await freshSociety(request);
    const stranger = await newAccount();
    const resident = await newAccount();

    const refused = await request.post(`${API}/societies/${slug}/board`, {
      headers: await authHeaders(stranger),
      data: { kind: 'notice', title: 'Cheap painting service, call me' },
    });
    expect(refused.status()).toBe(403);

    await makeResident(request, resident, slug, '1303');

    const posted = await request.post(`${API}/societies/${slug}/board`, {
      headers: await authHeaders(resident),
      data: { kind: 'notice', title: 'Lift servicing Friday', body: '9am to 1pm' },
    });
    expect(posted.status()).toBe(201);
    const item = await posted.json();
    expect(item.authorIsResident).toBe(true);
    expect(item.canRemove).toBe(true);
    expect(item.eventDate).toBeFalsy();

    // Anonymous read: an active noticeboard is the most honest signal a society page can give
    // somebody deciding where to live, so it must not need an account.
    const publicRead = await request.get(`${API}/societies/${slug}/board`);
    expect(publicRead.status()).toBe(200);
    const anon = (await publicRead.json()).content.find((b) => b.id === item.id);
    expect(anon.title).toBe('Lift servicing Friday');
    // No delete control for a reader who could not use one — the alternative is a button that
    // 403s, which reads as a broken page rather than a rule.
    expect(anon.canRemove).toBe(false);

    // A neighbour is a verified resident too. Residency buys posting, not moderation.
    const neighbour = await newAccount();
    await makeResident(request, neighbour, slug, '1304');
    const neighbourDelete = await request.delete(`${API}/societies/${slug}/board/${item.id}`, {
      headers: await authHeaders(neighbour),
    });
    expect(neighbourDelete.status()).toBe(403);

    const selfDelete = await request.delete(`${API}/societies/${slug}/board/${item.id}`, {
      headers: await authHeaders(resident),
    });
    expect(selfDelete.status()).toBe(204);
  });

  test('upcoming events sort ahead of notices however recently the notice was written', async ({ request }) => {
    const slug = await freshSociety(request);
    const ops = await authHeaders(OPS);

    const later = await request.post(`${API}/societies/${slug}/board`, {
      headers: ops,
      data: { kind: 'event', title: 'Annual general meeting', eventDate: '2027-06-01' },
    });
    expect(later.status()).toBe(201);

    const sooner = await request.post(`${API}/societies/${slug}/board`, {
      headers: ops,
      data: { kind: 'event', title: 'Tanker day', eventDate: '2027-04-02', eventTime: '07:30' },
    });
    expect(sooner.status()).toBe(201);

    // Written last, so a naive newest-first board would put it on top and bury both events.
    const notice = await request.post(`${API}/societies/${slug}/board`, {
      headers: ops,
      data: { kind: 'notice', title: 'New gate code from Monday' },
    });
    expect(notice.status()).toBe(201);

    const read = await request.get(`${API}/societies/${slug}/board`);
    const titles = (await read.json()).content.map((b) => b.title);
    expect(titles).toEqual([
      'Tanker day',
      'Annual general meeting',
      'New gate code from Monday',
    ]);

    const onlyNotices = await request.get(`${API}/societies/${slug}/board?kind=notice`);
    expect((await onlyNotices.json()).totalElements).toBe(1);

    const rubbish = await request.get(`${API}/societies/${slug}/board?kind=rumour`);
    expect(rubbish.status()).toBe(400);
  });

  test('an event needs a date, and a notice that sends one has it dropped', async ({ request }) => {
    const slug = await freshSociety(request);
    const ops = await authHeaders(OPS);

    const undated = await request.post(`${API}/societies/${slug}/board`, {
      headers: ops,
      data: { kind: 'event', title: 'AGM sometime' },
    });
    // An undated event would sort into the calendar and render an empty date cell — a broken page
    // rather than a rejected write.
    expect(undated.status()).toBe(400);

    const datedNotice = await request.post(`${API}/societies/${slug}/board`, {
      headers: ops,
      data: { kind: 'notice', title: 'Water tank cleaned', eventDate: '2027-05-05' },
    });
    expect(datedNotice.status()).toBe(201);
    // Dropped rather than refused: a notice with a date claims to be something that happens.
    expect((await datedNotice.json()).eventDate).toBeFalsy();

    const nonsense = await request.post(`${API}/societies/${slug}/board`, {
      headers: ops,
      data: { kind: 'gossip', title: 'Anything at all' },
    });
    expect(nonsense.status()).toBe(400);
  });

  test('writing needs a token even though reading does not', async ({ request }) => {
    const slug = await freshSociety(request);

    const anonQuestion = await request.post(`${API}/societies/${slug}/questions`, {
      data: { body: 'Posted by nobody' },
    });
    expect(anonQuestion.status()).toBe(401);

    const anonNotice = await request.post(`${API}/societies/${slug}/board`, {
      data: { kind: 'notice', title: 'Posted by nobody' },
    });
    expect(anonNotice.status()).toBe(401);

    // And the reads still work with no token, which is the whole asymmetry.
    expect((await request.get(`${API}/societies/${slug}/questions`)).status()).toBe(200);
    expect((await request.get(`${API}/societies/${slug}/board`)).status()).toBe(200);
  });

  test('an answer cannot be posted to another society\'s question through this society\'s URL', async ({ request }) => {
    const here = await freshSociety(request);
    const elsewhere = await freshSociety(request);
    const asker = await newAccount();

    const asked = await request.post(`${API}/societies/${elsewhere}/questions`, {
      headers: await authHeaders(asker),
      data: { body: 'Anything I should know?' },
    });
    expect(asked.status()).toBe(201);
    const { id } = await asked.json();

    const misdirected = await request.post(
      `${API}/societies/${here}/questions/${id}/answers`,
      { headers: await authHeaders(asker), data: { body: 'Lots.' } },
    );
    // Without this check the answer would be written and then be invisible, because the hub reads
    // answers through the question's own society.
    expect(misdirected.status()).toBe(404);
  });
});
