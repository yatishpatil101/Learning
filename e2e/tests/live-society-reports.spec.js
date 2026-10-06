// @ts-check
// Society hub content reports, API-level, against the live backend. Edge cases are in SocietyContentReportTest.
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
  test('removing a question takes its answers with it and spares its neighbour; removing an answer spares the question and its sibling answer', async ({ request }) => {
    const slug = await freshSociety(request);
    const author = await newAccount();
    const reporter = await newAccount();
    const tag = Date.now().toString(36);

    const doomed = await question(request, author, slug, `Doomed ${tag}?`);
    await answer(request, author, slug, doomed, 'An answer that goes with it.');
    const survivor = await question(request, author, slug, `Survivor ${tag}?`);

    const questionReport = await fileOk(request, reporter, 'society_question', doomed, 'abuse');
    expect((await triage(request, questionReport, { status: 'actioned', enforcement: 'hide_content' })).status()).toBe(200);

    const afterQuestion = (await (await request.get(`${API}/societies/${slug}/hub`)).json()).questions;
    const questionIds = afterQuestion.content.map((q) => q.id);
    // A thread whose question has gone is a page of replies to nothing, so the answers go too —
    // they are only ever readable through the question.
    expect(questionIds).not.toContain(doomed);
    // The neighbouring question is untouched. Moderation removes what was complained about.
    expect(questionIds).toContain(survivor);

    const badAnswer = await answer(request, author, slug, survivor, 'The offensive one.');
    const goodAnswer = await answer(request, author, slug, survivor, 'The useful one.');

    const answerReport = await fileOk(request, reporter, 'society_answer', badAnswer, 'abuse');
    expect((await triage(request, answerReport, { status: 'actioned', enforcement: 'hide_content' })).status()).toBe(200);

    const afterAnswer = (await (await request.get(`${API}/societies/${slug}/hub`)).json()).questions;
    const row = afterAnswer.content.find((q) => q.id === survivor);
    expect(row, 'the question to survive its answer being removed').toBeTruthy();
    const answerIds = row.answers.map((a) => a.id);
    expect(answerIds).not.toContain(badAnswer);
    expect(answerIds).toContain(goodAnswer);
  });
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

});
