// @ts-check
/**
 * Reporting society-hub content, and taking it down, against the live API (D240 slice 6).
 *
 * Every recommendation, reply, question, answer and noticeboard item on a society hub carries a
 * "Report" control. Pressing it wrote a row to `dzSocietyReports` **in the reporting member's own
 * browser**, and the ops queue meant to read those complaints read the *moderator's* browser. The
 * queue was empty by construction. A recommendation naming a real tradesman with his real mobile
 * number could be reported by fifty neighbours and not one moderator would see a single complaint,
 * because each of the fifty was sitting in a different phone.
 *
 * The platform-wide `reports` table has worked properly since V18 and simply did not admit society
 * content existed: `reports_target_type_check` allowed `property`, `user`, `review` and `post`.
 *
 * API-level rather than a browser walk, and deliberately so: the whole point is that the complaint
 * leaves the reporter's device and arrives somewhere a *different* person can act on it. Both
 * halves of that need two callers, which is exactly what a UI walk cannot show.
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
 * the second silently signs in as the first. Here that would be worse than a flake: the duplicate
 * guard is per reporter, so a collision turns "a second neighbour reports the same post" into "the
 * same neighbour reports it twice" and the test would assert the opposite of what it means to.
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
 * Minted rather than picked off the first page of the directory. This file counts rows before and
 * after a removal, which is precisely the assertion that shared state breaks — and the `used` set
 * the old picker relied on was module-scoped, so `fullyParallel` handed each worker its own empty
 * copy and the tests of this one file could all take the same building.
 */
async function freshSociety(request) {
  return mintSociety(request, await newAccount(), 'Reports');
}

async function contribution(request, mobile, slug, body) {
  const res = await request.post(`${API}/societies/${slug}/contributions`, {
    headers: await authHeaders(mobile),
    data: { kind: 'tip', body },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).id;
}

async function question(request, mobile, slug, body) {
  const res = await request.post(`${API}/societies/${slug}/questions`, {
    headers: await authHeaders(mobile),
    data: { body },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).id;
}

async function answer(request, mobile, slug, questionId, body) {
  const res = await request.post(`${API}/societies/${slug}/questions/${questionId}/answers`, {
    headers: await authHeaders(mobile),
    data: { body },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).id;
}

/**
 * Posted as ops, because the noticeboard is the one society surface with a gate on the way *in* —
 * only a verified resident, the committee or staff may post a notice. What is under test here is
 * the way out, so the fixture takes the shortest legal route in.
 */
async function boardItem(request, slug, title) {
  const res = await request.post(`${API}/societies/${slug}/board`, {
    headers: await authHeaders(OPS),
    data: { kind: 'notice', title, body: 'Fixture notice.' },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).id;
}

async function file(request, mobile, targetType, targetId, reason, details) {
  return request.post(`${API}/reports`, {
    headers: await authHeaders(mobile),
    data: { targetType, targetId, reason, details: details || 'Filed by the live suite.' },
  });
}

async function fileOk(request, mobile, targetType, targetId, reason) {
  const res = await file(request, mobile, targetType, targetId, reason);
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).id;
}

async function triage(request, id, body) {
  return request.patch(`${API}/reports/${id}`, {
    headers: await authHeaders(OPS),
    data: body,
  });
}

test.describe('society content reports (live)', () => {
  test('all five society surfaces can be complained about at all', async ({ request }) => {
    const slug = await freshSociety(request);
    const author = await newAccount();
    const reporter = await newAccount();

    const contributionId = await contribution(request, author, slug, 'Fixture tip.');
    const questionId = await question(request, author, slug, 'Fixture question?');
    const answerId = await answer(request, author, slug, questionId, 'Fixture answer.');
    const boardId = await boardItem(request, slug, `Fixture ${Date.now().toString(36)}`);

    const replyRes = await request.post(
      `${API}/societies/${slug}/contributions/${contributionId}/replies`,
      { headers: await authHeaders(author), data: { body: 'Fixture reply.' } },
    );
    expect(replyRes.status(), await replyRes.text()).toBe(201);
    const replyId = (await replyRes.json()).id;

    for (const [targetType, targetId] of [
      ['society_contribution', contributionId],
      ['society_reply', replyId],
      ['society_question', questionId],
      ['society_answer', answerId],
      ['society_board', boardId],
    ]) {
      const id = await fileOk(request, reporter, targetType, targetId, 'abuse');
      expect(id, `a report id for ${targetType}`).toBeTruthy();
    }
  });

  test('the reason vocabulary is the society one, and `personal` exists only here', async ({ request }) => {
    const slug = await freshSociety(request);
    const author = await newAccount();
    const reporter = await newAccount();
    const contributionId = await contribution(request, author, slug, 'Fixture tip.');

    // `personal` names what this surface actually attracts: somebody's contact details published
    // by a third party. It is the complaint the old free-text box could only express as prose.
    await fileOk(request, reporter, 'society_contribution', contributionId, 'personal');

    // A listing complaint on a society post is refused rather than stored under a word that means
    // nothing here.
    const wrong = await file(request, await newAccount(), 'society_contribution', contributionId, 'pricing');
    expect(wrong.status()).toBe(400);

    // And the reverse: `personal` is not a thing you can say about a listing.
    const props = await (await request.get(`${API}/properties?size=1`)).json();
    const propertyId = props.content?.[0]?.id;
    expect(propertyId, 'a seeded property to complain about').toBeTruthy();
    const notThere = await file(request, await newAccount(), 'property', propertyId, 'personal');
    expect(notThere.status()).toBe(400);
  });

  test('the duplicate guard is per reporter — fifty neighbours are fifty complaints', async ({ request }) => {
    const slug = await freshSociety(request);
    const author = await newAccount();
    const first = await newAccount();
    const second = await newAccount();
    const contributionId = await contribution(request, author, slug, 'Fixture tip.');

    await fileOk(request, first, 'society_contribution', contributionId, 'spam');

    // The same person again is a 409: one complaint per person is what stops a queue being
    // flooded by one angry resident.
    const again = await file(request, first, 'society_contribution', contributionId, 'spam');
    expect(again.status()).toBe(409);

    // A different neighbour is a real, separate signal. This is the whole point of the feature —
    // under the old browser-local store, these two people could never have been counted together.
    await fileOk(request, second, 'society_contribution', contributionId, 'spam');
  });

  test('upholding a complaint actually takes the post off the hub', async ({ request }) => {
    const slug = await freshSociety(request);
    const author = await newAccount();
    const reporter = await newAccount();
    const body = `Ring me on 98220 01122 — ${Date.now().toString(36)}`;
    const contributionId = await contribution(request, author, slug, body);

    const before = await (await request.get(`${API}/societies/${slug}/contributions`)).json();
    expect(before.content.some((c) => c.id === contributionId)).toBe(true);

    const reportId = await fileOk(request, reporter, 'society_contribution', contributionId, 'personal');
    const decided = await triage(request, reportId, {
      status: 'actioned',
      enforcement: 'hide_content',
      note: 'Third party contact details.',
    });
    expect(decided.status(), await decided.text()).toBe(200);
    expect((await decided.json()).status).toBe('actioned');

    // The assertion the whole slice exists for: a stranger reading the hub no longer sees it.
    const after = await (await request.get(`${API}/societies/${slug}/contributions`)).json();
    expect(after.content.some((c) => c.id === contributionId)).toBe(false);
  });

  test('removing a question takes its answers with it, and nothing else', async ({ request }) => {
    const slug = await freshSociety(request);
    const author = await newAccount();
    const reporter = await newAccount();

    const doomed = await question(request, author, slug, `Doomed ${Date.now().toString(36)}?`);
    await answer(request, author, slug, doomed, 'An answer that goes with it.');
    const survivor = await question(request, author, slug, `Survivor ${Date.now().toString(36)}?`);

    const reportId = await fileOk(request, reporter, 'society_question', doomed, 'abuse');
    expect((await triage(request, reportId, { status: 'actioned', enforcement: 'hide_content' })).status()).toBe(200);

    const after = await (await request.get(`${API}/societies/${slug}/questions`)).json();
    const ids = after.content.map((q) => q.id);
    // A thread whose question has gone is a page of replies to nothing, so the answers go too —
    // they are only ever readable through the question.
    expect(ids).not.toContain(doomed);
    // The neighbouring question is untouched. Moderation removes what was complained about.
    expect(ids).toContain(survivor);
  });

  test('removing an answer leaves the question standing', async ({ request }) => {
    const slug = await freshSociety(request);
    const author = await newAccount();
    const reporter = await newAccount();

    const questionId = await question(request, author, slug, `Still asked ${Date.now().toString(36)}?`);
    const doomed = await answer(request, author, slug, questionId, 'The offensive one.');
    const survivor = await answer(request, author, slug, questionId, 'The useful one.');

    const reportId = await fileOk(request, reporter, 'society_answer', doomed, 'abuse');
    expect((await triage(request, reportId, { status: 'actioned', enforcement: 'hide_content' })).status()).toBe(200);

    const after = await (await request.get(`${API}/societies/${slug}/questions`)).json();
    const row = after.content.find((q) => q.id === questionId);
    expect(row, 'the question to survive its answer being removed').toBeTruthy();
    const answerIds = row.answers.map((a) => a.id);
    expect(answerIds).not.toContain(doomed);
    expect(answerIds).toContain(survivor);
  });

  test('a second moderator clearing the same target is a no-op, not a 409', async ({ request }) => {
    const slug = await freshSociety(request);
    const author = await newAccount();
    const one = await newAccount();
    const two = await newAccount();
    const contributionId = await contribution(request, author, slug, 'Fixture tip.');

    const firstReport = await fileOk(request, one, 'society_contribution', contributionId, 'abuse');
    const secondReport = await fileOk(request, two, 'society_contribution', contributionId, 'abuse');

    expect((await triage(request, firstReport, { status: 'actioned', enforcement: 'hide_content' })).status()).toBe(200);

    // Two neighbours reporting one post is the ordinary case, not a conflict. The second decision
    // must be resolvable, or the queue accumulates complaints nobody can close.
    const second = await triage(request, secondReport, { status: 'actioned', enforcement: 'hide_content' });
    expect(second.status(), await second.text()).toBe(200);
    expect((await second.json()).status).toBe('actioned');
  });

  test('a decision cannot enforce unless it is upholding the complaint', async ({ request }) => {
    const slug = await freshSociety(request);
    const author = await newAccount();
    const reporter = await newAccount();
    const contributionId = await contribution(request, author, slug, 'Perfectly fine tip.');

    const reportId = await fileOk(request, reporter, 'society_contribution', contributionId, 'abuse');

    // "Dismissed, and also taken down" is not a decision anybody means.
    const contradictory = await triage(request, reportId, { status: 'dismissed', enforcement: 'hide_content' });
    expect(contradictory.status()).toBe(400);

    // Suspending an account over one noticeboard notice is not a verb this target has. It is
    // refused rather than accepted and silently discarded.
    const wrongVerb = await triage(request, reportId, { status: 'actioned', enforcement: 'suspend_account' });
    expect(wrongVerb.status()).toBe(400);

    // The post is still there, because neither refused decision did anything.
    const after = await (await request.get(`${API}/societies/${slug}/contributions`)).json();
    expect(after.content.some((c) => c.id === contributionId)).toBe(true);
  });

  test('the queue is staff-only and filters by society kind', async ({ request }) => {
    const slug = await freshSociety(request);
    const author = await newAccount();
    const reporter = await newAccount();
    const boardId = await boardItem(request, slug, `Queue fixture ${Date.now().toString(36)}`);
    const contributionId = await contribution(request, author, slug, 'Fixture tip.');
    await fileOk(request, reporter, 'society_board', boardId, 'spam');
    await fileOk(request, reporter, 'society_contribution', contributionId, 'spam');

    // An ordinary member cannot read the queue. An empty queue would read as "nothing to do",
    // which is the failure mode this whole slice is about.
    const denied = await request.get(`${API}/reports?targetType=society_board`, {
      headers: await authHeaders(reporter),
    });
    expect(denied.status()).toBe(403);

    const ops = await request.get(`${API}/reports?targetType=society_board&size=100`, {
      headers: await authHeaders(OPS),
    });
    expect(ops.status()).toBe(200);
    const page = await ops.json();
    // Shared database, so no absolute counts — the filter is proved by what it excludes.
    expect(page.content.every((r) => r.targetType === 'society_board')).toBe(true);
    expect(page.content.some((r) => r.targetId === boardId)).toBe(true);

    // An invented kind is refused rather than quietly returning everything.
    const nonsense = await request.get(`${API}/reports?targetType=society_notaThing`, {
      headers: await authHeaders(OPS),
    });
    expect(nonsense.status()).toBe(400);
  });

  test('living in the society does not make you a moderator', async ({ request }) => {
    const slug = await freshSociety(request);
    const author = await newAccount();
    const resident = await newAccount();
    const contributionId = await contribution(request, author, slug, 'Fixture tip.');

    const reportId = await fileOk(request, resident, 'society_contribution', contributionId, 'abuse');

    // The person who filed it cannot also decide it, however close to home the post is.
    const attempt = await request.patch(`${API}/reports/${reportId}`, {
      headers: await authHeaders(resident),
      data: { status: 'actioned', enforcement: 'hide_content' },
    });
    expect(attempt.status()).toBe(403);

    const after = await (await request.get(`${API}/societies/${slug}/contributions`)).json();
    expect(after.content.some((c) => c.id === contributionId)).toBe(true);
  });

  test('a complaint about content that never existed fails the decision', async ({ request }) => {
    const reporter = await newAccount();
    // The target is deliberately not resolved at filing time — a report is a safety signal and
    // losing one to a stale id is worse than filing one that cannot be upheld.
    const reportId = await fileOk(
      request,
      reporter,
      'society_contribution',
      '00000000-0000-4000-8000-000000000000',
      'abuse',
    );

    const decided = await triage(request, reportId, { status: 'actioned', enforcement: 'hide_content' });
    expect(decided.status()).toBe(404);
  });
});
