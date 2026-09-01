/**
 * HTTP society provider.
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
import { del, get, patch, post, put, unwrapFullPage, unwrapPage } from '../../http.js';
import { MAX_PAGE_SIZE } from '../../apiLimits.js';
import { toRatingIndex, toSociety } from './societyMapper.js';

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

/**
 * The whole society directory in one read — the rows **and** the rating index that came with them.
 *
 * This replaced `listSocietyRatings()`, which walked exactly these pages and then threw every
 * column but two away. The page that called it went on to build its grid from `data/societies.js`,
 * the 348 rows compiled into the bundle, so `/societies` was in the strange position of having
 * asked the server for the catalogue, received it, and drawn a different one. Everything minted
 * through the API since the seed was missing from the directory — including societies the same
 * page's own "add your society" box had just created, which is as close to a self-refuting screen
 * as this codebase has. Returning the rows costs nothing: it is the same four requests.
 *
 * The rating index is returned alongside rather than folded into the rows because it is keyed by
 * slug and read by slug — the grid looks a card's rating up, it does not iterate rows to find one —
 * and because `toSociety` deliberately does not carry `avgRating`. A society with no published
 * reviews sends `null`, `Number(null)` is 0, and a mapper that coerced it would turn "nobody has
 * rated this" into "everybody rated it zero" on every unrated building in the directory.
 *
 * The page ceiling is the one `listSocietyRatings` set and for the same reason: a catalogue past
 * {@link MAX_PAGES} pages is a data problem, and reading it whole on a public page would be a slow
 * one. Truncation is announced rather than silent, because the symptom — societies simply absent
 * from the directory — reads as a filter bug and would send the next reader to the wrong file.
 *
 * @returns {Promise<{rows: object[], ratings: Record<string, {avg: number|null, count: number}>}>}
 */
export async function listSocietyCatalogue() {
  const first = await get('/societies', { page: 0, size: PAGE_SIZE });
  const reported = Number(first?.totalPages) || 1;
  const pages = Math.min(reported, MAX_PAGES);
  if (reported > MAX_PAGES) {
    console.warn(
      `[society] GET /societies reports ${reported} pages; reading the first ${MAX_PAGES}. `
      + 'Societies past that are absent from the directory and render as unrated.',
    );
  }

  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, i) => get('/societies', { page: i + 1, size: PAGE_SIZE })),
  );

  const rows = [];
  const ratings = {};
  for (const res of [first, ...rest]) {
    for (const row of Array.isArray(res?.content) ? res.content : []) {
      const soc = toSociety(row);
      if (soc) rows.push(soc);
    }
    Object.assign(ratings, toRatingIndex(res?.content));
  }
  return { rows, ratings };
}

/**
 * How many type-ahead candidates to ask the server for.
 *
 * More than the 20 the picker shows, because the ordering the user sees is not the ordering the
 * server returns: the service re-ranks verified societies to the top and drops blacklisted ones.
 * Asking for exactly 20 would let the server's own sort decide which 20 were eligible for that
 * re-rank, so a verified match sitting 25th by name would never surface. 60 is the smallest number
 * that makes that unlikely without turning a keystroke into a large page read.
 */
const SEARCH_CANDIDATES = 60;

/**
 * Type-ahead candidates from the catalogue.
 *
 * Projected to the six fields the picker renders, rather than passed through whole. `SocietyResponse`
 * carries twenty-odd fields including follower counts and claim status, and a picker that could
 * reach them would grow a dependency on data the mock provider does not return — which is how a
 * component ends up working in one mode and blank in the other.
 *
 * `verified` is derived here rather than read: the server has no such field, and the badge has
 * always meant "has both a registration and a conveyance on file". A community-added society is
 * never verified, whatever its own row claims, which is the same rule the mock applies.
 *
 * Ordering, the geo blacklist and the cap are the service's job, not this function's — see
 * `societyService.searchSocieties` for why they belong in one place.
 *
 * **The locality is deliberately not sent.** `GET /societies?locality=` is a hard filter, and to
 * this picker a locality is a *preference*: the wizard offers societies outside the chosen area,
 * ranked below the ones inside it, because a user who picked the wrong locality first should still
 * find their building rather than be told it does not exist. Sending the parameter would turn that
 * ranking into an exclusion and quietly delete the rows it was meant to demote.
 */
export async function searchSocieties(query) {
  const res = await get('/societies', {
    q: query || undefined,
    page: 0,
    size: SEARCH_CANDIDATES,
  });
  const rows = Array.isArray(res?.content) ? res.content : [];
  return rows.filter((s) => s?.slug).map((s) => {
    const community = s.source === 'community';
    return {
      // The server's UUID. Carried because the listing wizard still binds a `societyId` into the
      // form, and in this mode that is what a society's id is. The slug is the key everything else
      // joins on; this field exists for the one caller that has not been moved off ids yet.
      id: s.id,
      slug: s.slug,
      name: s.name || '',
      localitySlug: s.localitySlug || '',
      builder: s.builder || '',
      verified: !community && !!(s.registration && s.conveyance),
      community,
    };
  });
}

/**
 * One society, addressed by slug — the hub's own row.
 *
 * `GET /societies/{slug}` rather than a `q=` search of `GET /societies`: a directory read matches
 * on text and would answer with a *near* society, which on a page that renders one building's
 * registration, conveyance and claim status is worse than answering with nothing.
 *
 * A 404 becomes `null`, not a throw. "No such society" is a routine answer here — the hub is
 * reachable from a typed URL and from links minted before a merge — and the page has an honest
 * rendering for it. Every other failure propagates, because "the server is down" and "that
 * building does not exist" must not read the same on screen.
 */
export async function getSociety(slug) {
  try {
    return toSociety(await get(`/societies/${encodeURIComponent(slug)}`));
  } catch (err) {
    if (err?.status === 404) return null;
    throw err;
  }
}

/**
 * One page of the society directory for the back office.
 *
 * Deliberately `GET /societies` rather than an `/admin/societies` of its own. Every column the
 * console renders — name, builder, year, locality, registration, conveyance, claim status,
 * maintenance — is already on `SocietyResponse`, and `q`/`locality` already filter it, so a second
 * listing route would be a second set of filters to keep in step with this one for no reader who
 * lacks one. `Routes.AdminSocieties` says the same thing in the backend, and this is the call site
 * that argument was written about.
 *
 * The consequence to know: because this is the public route, a merged-away society is absent (the
 * spec filters `mergedInto is null`) and the row carries `followedByMe`/`avgRating` the console
 * ignores. The first is correct — a merged society is not a building an operator should be editing
 * — and the second is a few unread fields, not a reason to fork the endpoint.
 *
 * No `sort`: `SocietySort`'s whitelist is not backed by indexes, and `api-standards.md` §5 forbids
 * exposing a sort the schema cannot serve. The server's `name ASC` default stands.
 */
export async function listSocietyDirectory({ q = '', locality = '', page = 0, size = 20 } = {}) {
  const res = await get('/societies', {
    q: q || undefined,
    locality: locality || undefined,
    page,
    size,
  });
  return unwrapPage(res, { page, size });
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

/**
 * The same follow list, as whole societies rather than slugs.
 *
 * A separate operation rather than widening {@link listFollowedSocieties}, because the two callers
 * want genuinely different things and paying for the wrong one is not free either way. The follow
 * *context* wants a membership set: it is mounted app-wide, it answers `has(slug)` for every
 * society card on every page, and it would hold up to 500 full records to compute a `Set` of
 * strings. The dashboard panel wants the records.
 *
 * The alternative — the panel mapping `getSociety` over the slugs — is what this exists to avoid:
 * it is one request per followed society, up to 500 of them, to draw a name and a locality that
 * this endpoint already sends. Same rule as `getSocietyRatings`: a caller holding many societies
 * reads a list, a caller holding one reads that one.
 */
export async function listFollowedSocietyRows() {
  const res = await get('/me/societies/following', { page: 0, size: FOLLOW_PAGE_SIZE });
  return unwrapFullPage(res, 'society').map(toSociety).filter(Boolean);
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

/**
 * The ops queue across every society. Staff with `societies:read`.
 *
 * `size` defaults to the server's ceiling rather than to its `@PageableDefault(size = 20)`: this
 * screen has no pager, and the counts beside each heading are computed over whatever comes back. A
 * silent 20-row cap would show "3 pending links" to an operator with thirty of them. Past 100,
 * `unwrapFullPage` says so out loud instead of the queue quietly lying.
 */
export async function listSocietyProposalQueue({ status, kind, page, size = MAX_PAGE_SIZE } = {}) {
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

/* --- society residents: the ops side ---------------------------------------------------------- */

/**
 * Residency requests across every society, oldest first. Staff with `societies:read`.
 *
 * The fourth ops queue, and the last one to stop reading the operator's own browser. The only
 * residency route was per-society, which serves the committee reviewing its own building but
 * cannot answer "who is waiting anywhere" — so the cross-society tab had nothing to read.
 *
 * `size` defaults to the server's ceiling for the same reason the proposal queue does: this screen
 * has no pager and the count beside the heading is computed over whatever comes back, so a silent
 * 20-row cap would tell an operator with thirty people waiting that three are.
 *
 * There is no matching decide function here on purpose. Deciding stays on `decideResidency`, keyed
 * by the slug every row carries — the per-society route already admits staff and already owns the
 * one-verified-resident-per-flat rule, and a second path to that rule is the one that drifts.
 */
export async function listSocietyResidentQueue({ status, page, size = MAX_PAGE_SIZE } = {}) {
  const res = await get('/admin/society-residents', { status, page, size });
  return unwrapFullPage(res, 'society residents');
}

/* --- society claims: the ops side ------------------------------------------------------------- */

/** Committee claims awaiting a decision, oldest first. Staff with `societies:read`. */
export async function listSocietyClaimQueue({ status, page, size = MAX_PAGE_SIZE } = {}) {
  const res = await get('/admin/society-claims', { status, page, size });
  return unwrapFullPage(res, 'society claims');
}

/**
 * Approve or reject one claim. Staff with `societies:write`.
 *
 * By claim id, not by society slug — the server keeps every claim ever filed, so a slug names a
 * society and not a decision. Approving grants the committee authority over the hub in the same
 * transaction; an already-decided claim answers 409 rather than being rewritten.
 */
export async function decideSocietyClaim(id, decision) {
  return patch(`/admin/society-claims/${encodeURIComponent(id)}`, decision);
}

/**
 * A signed link to this claim's registration certificate. Staff with `societies:read`.
 *
 * One request per certificate actually opened. The queue read is left alone deliberately: at twenty
 * rows a page, embedding the link would sign twenty URLs to serve the one an operator clicks, and
 * each of those is a live handle on somebody's vault sitting in a cached response body.
 *
 * The path is the claim's, not the document's — the server resolves the document id from the row and
 * confirms it is the claimant's own. There is no staff route that takes a document id, and the whole
 * point of this shape is that there should not be one.
 */
export async function getSocietyClaimCertificate(claimId) {
  return get(`/admin/society-claims/${encodeURIComponent(claimId)}/certificate`);
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

/**
 * Societies a queued candidate may already be a copy of, strongest match first.
 *
 * Staff with `societies:read`. A plain array, not a page: the endpoint answers a handful of hints
 * by construction, so there is nothing to page and no total to hide.
 *
 * One request per candidate the operator opens, rather than a `dupes` column folded into the queue.
 * The scan compares a name against the whole catalogue; running it twenty times to render a screen
 * on which at most one row's hints are ever looked at is the wrong trade.
 */
export async function listSocietyCandidateDuplicates(slug, { limit } = {}) {
  const rows = await get(`/admin/society-candidates/${encodeURIComponent(slug)}/duplicates`, { limit });
  return Array.isArray(rows) ? rows : [];
}

/**
 * Society merges currently in force, newest first. Staff with `societies:read`.
 *
 * `unwrapFullPage` rather than a silent `.content`, on the same principle as the queues: a console
 * that shows the first twenty merges and calls it the list is worse than one that says so.
 */
export async function listSocietyMerges({ page, size } = {}) {
  const res = await get('/admin/society-merges', { page, size });
  return unwrapFullPage(res, 'society merges');
}

/**
 * Record that `from` is a duplicate of `into`. Staff with `societies:write`.
 *
 * Both slugs travel in the body because they are the two halves of one statement, not subject and
 * object — putting either in the path would read as an edit of that society.
 */
export async function mergeSocieties(from, into) {
  return post('/admin/society-merges', { from, into });
}

/**
 * Undo a merge, addressed by the society that was **merged away**.
 *
 * Not by the survivor: a survivor can have absorbed several duplicates, and "undo the merge on this
 * society" would then resolve silently to the wrong one.
 */
export async function undoSocietyMerge(slug) {
  await del(`/admin/society-merges/${encodeURIComponent(slug)}`);
}

/**
 * One society as the back-office editor needs it — the four public facts plus the internal note.
 */
export async function getSocietyAdminView(slug) {
  return get(`/admin/societies/${encodeURIComponent(slug)}`);
}

/**
 * Correct one society's own facts.
 *
 * The body is forwarded as given rather than normalised into a full row, because the route is a
 * `PATCH` that treats an absent field as unchanged and this is the layer most likely to undo that
 * by being helpful. In particular `adminNote: ''` and no `adminNote` mean different things — clear
 * the note, versus leave whoever wrote it alone — so neither may be coalesced into the other here.
 */
export async function editSociety(slug, body) {
  return patch(`/admin/societies/${encodeURIComponent(slug)}`, body);
}
