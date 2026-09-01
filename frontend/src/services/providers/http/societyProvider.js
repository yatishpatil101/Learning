/**
 * HTTP society provider — the live counterpart to `providers/mock/societyProvider.js`.
 *
 * `GET /societies` already carries `avgRating` and `reviewCount` on every row, computed server-side
 * in one grouped query per page, so the entire directory's ratings cost a walk of this one endpoint
 * rather than 348 summary reads. Shape translation lives in `societyMapper.js`.
 *
 * ## Paging
 *
 * The directory renders every society, so this has to read every page — an aggregate that stops at
 * page one is not an aggregate, it is a rating for the first hundred societies alphabetically and
 * "Not rated yet" for the rest, which is indistinguishable from the bug this replaced.
 *
 * Page 0 is fetched first because it is the only way to learn `totalPages`; the remainder go out in
 * parallel. At the seeded 348 societies that is one request and then three.
 *
 * `MAX_PAGES` is a stop, not a page size. Without it a server that reports a wrong `totalPages` (or
 * a catalogue that grows by an order of magnitude) turns one page load into an unbounded request
 * storm. Hitting it is a real defect rather than a slow day, so it warns — a silently short index
 * would put the grid back to showing "Not rated yet" for societies that are rated, which is exactly
 * the failure mode nobody noticed the first time.
 */
import { del, get, patch, post, put, unwrapFullPage } from '../../http.js';
import { toRatingIndex } from './societyMapper.js';

/** The server's hard ceiling (`spring.data.web.pageable.max-page-size`); asking for more is clamped. */
const PAGE_SIZE = 100;

/** 20 × 100 = 2,000 societies. The seeded catalogue is 348. */
const MAX_PAGES = 20;

/**
 * How many follows to ask for in one page.
 *
 * A follow set grows only through the user's own taps, so it is bounded by their own effort in the
 * way a shortlist is — the same reasoning, and the same number, as `SavedContext`. Asking for one
 * page and getting it whole matters here more than it does for a list screen, because the answer
 * feeds a membership check: a second page left unread is not a shorter list, it is a set of
 * societies the directory would draw as unfollowed and invite the user to follow again.
 */
const FOLLOW_PAGE_SIZE = 500;

export async function listSocietyRatings() {
  const first = await get('/societies', { page: 0, size: PAGE_SIZE });
  const reported = Number(first?.totalPages) || 1;
  const pages = Math.min(reported, MAX_PAGES);
  if (reported > MAX_PAGES) {
    console.warn(
      `[society] GET /societies reports ${reported} pages; reading the first ${MAX_PAGES}. `
      + 'Societies past that will render as unrated even if they have reviews.',
    );
  }

  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, i) => get('/societies', { page: i + 1, size: PAGE_SIZE })),
  );

  const index = {};
  for (const res of [first, ...rest]) Object.assign(index, toRatingIndex(res?.content));
  return index;
}

/**
 * The caller's followed society slugs, newest follow first (D227).
 *
 * `unwrapFullPage` rather than a silent `.content`: if the follow set ever outgrows one page the
 * console says so, because the failure is invisible otherwise — the directory would simply show
 * the overflow as unfollowed, which looks like the user never followed them.
 *
 * Rows without a slug are dropped rather than pushed in as `undefined`, which would make one
 * membership check answer true for every unnamed society.
 */
export async function listFollowedSocieties() {
  const res = await get('/me/societies/following', { page: 0, size: FOLLOW_PAGE_SIZE });
  return unwrapFullPage(res, 'society').map((row) => row?.slug).filter(Boolean);
}

/** Idempotent follow — 204 whether or not the row existed. 404 when the slug is unknown. */
export async function followSociety(slug) {
  await put(`/me/societies/${encodeURIComponent(slug)}/follow`);
}

/** Idempotent unfollow — 204 whether or not the row existed, and 204 for an unknown slug too. */
export async function unfollowSociety(slug) {
  await del(`/me/societies/${encodeURIComponent(slug)}/follow`);
}

/**
 * How many residency requests to ask for in one page.
 *
 * A committee's queue is bounded by the number of flats in the building — a few hundred at the top
 * end — so one page is the honest read. `unwrapFullPage` says so out loud if a society ever
 * exceeds it, because a silently short queue is a queue with people waiting in it that nobody
 * knows about.
 */
const RESIDENT_PAGE_SIZE = 500;

const societyPath = (slug, suffix) => `/societies/${encodeURIComponent(slug)}${suffix}`;

/**
 * Where the caller stands in this society (D240) — one read, four facts.
 *
 * Public and caller-aware: a signed-out reader gets the society's claim state and verified count
 * with `resident: null` and `admin: false`, which is what lets the hub render the "claim this
 * society" invitation on first paint instead of after a sign-in check.
 */
export async function getSocietyMembership(slug) {
  return get(societyPath(slug, '/membership'));
}

/**
 * Ask to be recognised as a resident of one flat.
 *
 * Returns the standing request, not a new one: the server amends rather than queueing a second, so
 * calling this twice leaves one row and the caller can render the response either way.
 */
export async function requestResidency(slug, body) {
  return post(societyPath(slug, '/residents'), body);
}

/** The society's residency queue. Committee or staff — a resident gets a 403, by design. */
export async function listSocietyResidents(slug, { status } = {}) {
  const res = await get(societyPath(slug, '/residents'), {
    page: 0,
    size: RESIDENT_PAGE_SIZE,
    ...(status ? { status } : {}),
  });
  return unwrapFullPage(res, 'society residents');
}

/**
 * Verify or reject one request.
 *
 * A 409 here is the flat already having a verified resident. That is a real answer rather than a
 * transport failure — the committee has to reject the outgoing resident first — so it is left to
 * surface as an `ApiError` the caller can read a message off.
 */
export async function decideResidency(slug, residentId, body) {
  return patch(societyPath(slug, `/residents/${encodeURIComponent(residentId)}`), body);
}

/** Claim the society for its committee. 409 when somebody else already has a live claim. */
export async function claimSociety(slug, body) {
  return post(societyPath(slug, '/claim'), body);
}

/**
 * How many questions and board items to read in one page.
 *
 * The hub renders both surfaces in full — there is no "load more" on a society page — so a short
 * read is not a shorter list, it is a question nobody ever answers and a notice nobody sees.
 * `unwrapFullPage` puts a society that outgrows this in the console rather than letting it quietly
 * truncate.
 */
const COMMUNITY_PAGE_SIZE = 200;

/**
 * Questions asked about this society, newest first, answers attached (D240).
 *
 * Public: the hub calls this before it knows whether anyone is signed in, because the person with
 * the most to ask about a building has not moved into it yet.
 */
export async function listSocietyQuestions(slug) {
  const res = await get(societyPath(slug, '/questions'), { page: 0, size: COMMUNITY_PAGE_SIZE });
  return unwrapFullPage(res, 'society questions');
}

/** Ask a question. Any signed-in caller; 401 otherwise. */
export async function askSocietyQuestion(slug, body) {
  return post(societyPath(slug, '/questions'), { body });
}

/** Answer one. The server checks the question really belongs to this society — 404 if not. */
export async function answerSocietyQuestion(slug, questionId, body) {
  return post(societyPath(slug, `/questions/${encodeURIComponent(questionId)}/answers`), { body });
}

/**
 * The society noticeboard — events by when they happen, then notices newest first.
 *
 * `kind` narrows to one or the other. Omitted by the hub, which renders both columns from one read
 * rather than paying two round trips to sort a list the server already sorted.
 */
export async function listSocietyBoard(slug, { kind } = {}) {
  const res = await get(societyPath(slug, '/board'), {
    page: 0,
    size: COMMUNITY_PAGE_SIZE,
    ...(kind ? { kind } : {}),
  });
  return unwrapFullPage(res, 'society board');
}

/**
 * Post an event or a notice.
 *
 * A 403 here means the caller has not verified a flat in this society. That is the rule, not an
 * error to retry — a notice asserts something about the building — so it surfaces as an `ApiError`
 * carrying the server's sentence about verifying a flat.
 */
export async function postBoardItem(slug, body) {
  return post(societyPath(slug, '/board'), body);
}

/** Take one down. Author, committee or staff; 403 otherwise, 204 on success. */
export async function removeBoardItem(slug, itemId) {
  await del(societyPath(slug, `/board/${encodeURIComponent(itemId)}`));
}

/**
 * The community tab — tips, trusted picks and photos (D240 slice 3).
 *
 * Deliberately unfiltered. The tab's chips show a count for every kind including the ones you are
 * not currently viewing, so a filtered read could not draw the page anyway — and a list and a set
 * of counts fetched separately are two answers free to disagree. One read, filtered in the browser.
 *
 * Public: a stranger reading the tips is most of the traffic this page gets. A recommended person's
 * phone number is the one field the server withholds until the reader signs in.
 */
export async function listSocietyContributions(slug) {
  const res = await get(societyPath(slug, '/contributions'), {
    page: 0,
    size: COMMUNITY_PAGE_SIZE,
  });
  return unwrapFullPage(res, 'society contributions');
}

/**
 * Share a tip, a pick or a photo. Any signed-in caller; 401 otherwise.
 *
 * `photoUrl` must already be a URL — upload through `POST /me/photos` first. The browser build kept
 * base64 in localStorage, which is exactly why a shared photo was invisible on every device except
 * the one that shared it.
 */
export async function addSocietyContribution(slug, body) {
  return post(societyPath(slug, '/contributions'), body);
}

/** Remove one. Author, committee or staff; its replies and votes go with it. */
export async function removeSocietyContribution(slug, contributionId) {
  await del(societyPath(slug, `/contributions/${encodeURIComponent(contributionId)}`));
}

/**
 * Mark or unmark a contribution as helpful.
 *
 * Two verbs rather than one toggle endpoint, so a request retried after a dropped connection
 * produces the state the tap intended instead of undoing it. Answers with `{helpfulCount,
 * helpfulByMe}` — the count is what the button draws, and re-reading the whole page to update one
 * number is the alternative.
 */
export async function setContributionHelpful(slug, contributionId, helpful) {
  const path = societyPath(slug, `/contributions/${encodeURIComponent(contributionId)}/helpful`);
  return helpful ? put(path) : del(path);
}

/** Reply in the thread under a contribution. Any signed-in caller. */
export async function addContributionReply(slug, contributionId, body) {
  return post(societyPath(slug, `/contributions/${encodeURIComponent(contributionId)}/replies`), {
    body,
  });
}

/** Remove a reply. Its own author, the committee or staff — not the contribution's author. */
export async function removeContributionReply(slug, contributionId, replyId) {
  await del(
    societyPath(
      slug,
      `/contributions/${encodeURIComponent(contributionId)}/replies/${encodeURIComponent(replyId)}`,
    ),
  );
}

/**
 * Every pending community proposal for this society, plus whether a resident group exists.
 *
 * One read rather than three, so the page cannot render half a state — a banner saying your pin
 * correction is pending beside a map that has already been corrected.
 *
 * `whatsappJoinUrl` comes back null for anyone without a verified flat here, approved or not; the
 * invite is a key to a private resident space. `whatsappAvailable` still says the group is there,
 * which is what the "verify your flat" nudge is drawn from.
 */
export async function getSocietyProposals(slug) {
  return get(societyPath(slug, '/proposals'));
}

/**
 * Propose a detail, the resident WhatsApp link, or a corrected map pin.
 *
 * One endpoint for all three: they are one lifecycle wearing three names. Details are open to any
 * signed-in caller — enriching a thin, bulk-imported society without first demanding somebody
 * verify a flat is how a community society becomes a verified one — while the invite and the pin
 * answer 403 without a verified flat. Re-submitting corrects your own pending proposal rather than
 * queueing a second; somebody else's pending proposal is a 409.
 */
export async function proposeSocietyChange(slug, payload) {
  return post(societyPath(slug, '/proposals'), payload);
}

/** The ops queue across every society. Staff with `societies:read`. */
export async function listSocietyProposalQueue({ status, kind, page, size } = {}) {
  const res = await get('/admin/society-proposals', { status, kind, page, size });
  return unwrapFullPage(res, 'society proposals');
}

/**
 * Approve or reject one proposal. Staff with `societies:write`.
 *
 * Approving writes the value onto the society in the same transaction; there is no separate apply
 * step to fail in between. An already-decided proposal answers 409 rather than being rewritten.
 */
export async function decideSocietyProposal(id, decision) {
  return patch(`/admin/society-proposals/${encodeURIComponent(id)}`, decision);
}

/* --- community minting (D241 C5) -------------------------------------------------------------- */

/**
 * Add a society the catalogue does not have. Any signed-in caller.
 *
 * Answers the canonical society either way, so the caller's next move — follow it, list in it, open
 * its hub — works against the real row rather than against a duplicate they did not know they had
 * created. The `created` flag comes from the status code, which is the only place the distinction
 * lives: 201 minted, 200 matched something that already existed.
 *
 * @param {{name: string, localityLabel?: string, localitySlug?: string, lat?: number, lng?: number}} body
 * @returns {Promise<{society: object, created: boolean}>}
 */
export async function mintSociety(body) {
  // `withStatus`, because here the code *is* part of the answer: 201 minted, 200 matched something
  // that already existed. Nothing in the body distinguishes the two — a society somebody added
  // yesterday and one added a millisecond ago are the same row.
  const { data, status } = await post('/societies', body, { withStatus: true });
  return { society: data, created: status === 201 };
}

/** Member-added societies nobody has checked yet, oldest first. Staff with `societies:read`. */
export async function listSocietyCandidates({ page, size } = {}) {
  const res = await get('/admin/society-candidates', { page, size });
  return unwrapFullPage(res, 'society candidates');
}

/**
 * Confirm a member-added society is real. Staff with `societies:write`.
 *
 * 409 if somebody already verified it — the record of who did is the only thing that says who to ask
 * about the society later, so the second operator is told rather than silently overwriting it.
 */
export async function verifySocietyCandidate(slug) {
  return post(`/admin/society-candidates/${encodeURIComponent(slug)}/verify`);
}
