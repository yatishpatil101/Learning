// `GET /societies` carries `avgRating`/`reviewCount` per row, so the whole directory's ratings
// cost one walk of this endpoint.
import { del, get, patch, post, put, unwrapFullPage, unwrapPage } from '../../http.js';
import { MAX_PAGE_SIZE } from '../../apiLimits.js';
import { toRatingIndex, toSociety } from './societyMapper.js';

/** The server's hard ceiling (`spring.data.web.pageable.max-page-size`); asking for more is clamped. */
const PAGE_SIZE = 100;

/** 20 × 100 = 2,000 societies. The seeded catalogue is 348. */
const MAX_PAGES = 20;

// The badge half of "strongest" is not a sortable column, so the server can only narrow the
// population. Pinned to the page ceiling, not a second literal.
const LISTED_CANDIDATES = MAX_PAGE_SIZE;

// One page, read whole: the answer feeds a membership check, so an unread second page is not a
// shorter list but societies the directory draws as unfollowed.
const FOLLOW_PAGE_SIZE = 500;

// Rows plus a separate slug-keyed rating index, so unrated `null` stays distinct from zero.
// Warns when MAX_PAGES caps the walk, because silent truncation resembles a filter failure.
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

// Each row carries `listingCount`. Ratings are omitted because the rail does not render them.
export async function listSocietiesWithListings() {
  const res = await get('/societies', { hasListings: true, page: 0, size: LISTED_CANDIDATES });
  const total = Number(res?.totalElements) || 0;
  if (total > LISTED_CANDIDATES) {
    console.warn(
      `[society] ${total} societies have live listings; ranking within the first ${LISTED_CANDIDATES}. `
      + 'Raise LISTED_CANDIDATES or the rail is ordering a slice of the catalogue, not the catalogue.',
    );
  }
  const rows = [];
  for (const row of Array.isArray(res?.content) ? res.content : []) {
    const soc = toSociety(row);
    if (soc) rows.push(soc);
  }
  return { rows };
}

// More than the 20 the picker shows: the service re-ranks verified societies to the top, so asking
// for exactly 20 would let the server's own sort decide which 20 were eligible for that re-rank.
const SEARCH_CANDIDATES = 60;

// **The locality is deliberately not sent** — docs/flows/consumer/societies.md
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
      // The listing wizard still binds a `societyId` into the form; the slug is the key everything
      // else joins on.
      id: s.id,
      slug: s.slug,
      name: s.name || '',
      localitySlug: s.localitySlug || '',
      // The registry already knows where the society is, which is the whole reason a host who has
      // named one should not also be made to drag a map pin onto it.
      lat: s.lat == null ? null : Number(s.lat),
      lng: s.lng == null ? null : Number(s.lng),
      builder: s.builder || '',
      verified: !community && !!(s.registration && s.conveyance),
      community,
    };
  });
}

// `/societies/{slug}`, not a `q=` search, which would answer with a *near* society. A 404 becomes
// `null` because the hub is reachable from typed URLs; every other failure propagates.
export async function getSociety(slug) {
  try {
    return toSociety(await get(`/societies/${encodeURIComponent(slug)}`));
  } catch (err) {
    if (err?.status === 404) return null;
    throw err;
  }
}

// The back office reads the public `GET /societies` on purpose, and takes no `sort`.
export async function listSocietyDirectory({ q = '', locality = '', page = 0, size = 20 } = {}) {
  const res = await get('/societies', {
    q: q || undefined,
    locality: locality || undefined,
    page,
    size,
  });
  return unwrapPage(res, { page, size });
}

// `unwrapFullPage` rather than a silent `.content`: overflow would otherwise render as unfollowed.
// Slugless rows are dropped, or one membership check answers true for every unnamed society.
export async function listFollowedSocieties() {
  const res = await get('/me/societies/following', { page: 0, size: FOLLOW_PAGE_SIZE });
  return unwrapFullPage(res, 'society').map((row) => row?.slug).filter(Boolean);
}

// Separate from `listFollowedSocieties` because the app-wide follow context only needs a `Set` of
// slugs, not up to 500 full records.
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

// A committee's queue is bounded by the flats in the building, so one page is the honest read;
// `unwrapFullPage` complains if a society ever exceeds it rather than truncating silently.
const RESIDENT_PAGE_SIZE = 500;

const societyPath = (slug, suffix) => `/societies/${encodeURIComponent(slug)}${suffix}`;

// Public and caller-aware, so the hub renders the "claim this society" invitation on first paint
// without waiting on a sign-in check.
export async function getSocietyMembership(slug) {
  return get(societyPath(slug, '/membership'));
}

// The server amends the standing request rather than queueing a second, so calling twice leaves
// one row.
export async function requestResidency(slug, body) {
  return post(societyPath(slug, '/residents'), body);
}

/** Committee or staff — a resident gets a 403, by design. */
export async function listSocietyResidents(slug, { status } = {}) {
  const res = await get(societyPath(slug, '/residents'), {
    page: 0,
    size: RESIDENT_PAGE_SIZE,
    ...(status ? { status } : {}),
  });
  return unwrapFullPage(res, 'society residents');
}

// A 409 is the flat already having a verified resident — a real answer, not a transport failure.
export async function decideResidency(slug, residentId, body) {
  return patch(societyPath(slug, `/residents/${encodeURIComponent(residentId)}`), body);
}

/** Claim the society for its committee. 409 when somebody else already has a live claim. */
export async function claimSociety(slug, body) {
  return post(societyPath(slug, '/claim'), body);
}

// The hub renders questions and the board in full — there is no "load more" — so a short read is a
// question nobody answers. `unwrapFullPage` flags a society that outgrows this.
const COMMUNITY_PAGE_SIZE = 200;

// Public, because the person with the most to ask about a building has not moved into it yet.
export async function listSocietyQuestions(slug) {
  const res = await get(societyPath(slug, '/questions'), { page: 0, size: COMMUNITY_PAGE_SIZE });
  return unwrapFullPage(res, 'society questions');
}

/** Any signed-in caller; 401 otherwise. */
export async function askSocietyQuestion(slug, body) {
  return post(societyPath(slug, '/questions'), { body });
}

/** The server checks the question really belongs to this society — 404 if not. */
export async function answerSocietyQuestion(slug, questionId, body) {
  return post(societyPath(slug, `/questions/${encodeURIComponent(questionId)}/answers`), { body });
}

// `kind` narrows to one; the hub omits it and draws both columns from one read rather than paying
// two round trips.
export async function listSocietyBoard(slug, { kind } = {}) {
  const res = await get(societyPath(slug, '/board'), {
    page: 0,
    size: COMMUNITY_PAGE_SIZE,
    ...(kind ? { kind } : {}),
  });
  return unwrapFullPage(res, 'society board');
}

// A 403 means the caller has not verified a flat here — the rule, not an error to retry.
export async function postBoardItem(slug, body) {
  return post(societyPath(slug, '/board'), body);
}

/** Take one down. Author, committee or staff; 403 otherwise, 204 on success. */
export async function removeBoardItem(slug, itemId) {
  await del(societyPath(slug, `/board/${encodeURIComponent(itemId)}`));
}

// Deliberately unfiltered: the chips count every kind, so a filtered read could not draw the page
// and two fetches could disagree. Public — a recommended person's phone is the withheld field.
export async function listSocietyContributions(slug) {
  const res = await get(societyPath(slug, '/contributions'), {
    page: 0,
    size: COMMUNITY_PAGE_SIZE,
  });
  return unwrapFullPage(res, 'society contributions');
}

// `photoUrl` must already be a URL — upload through `POST /me/photos` first, or the photo is
// visible only on the device that shared it.
export async function addSocietyContribution(slug, body) {
  return post(societyPath(slug, '/contributions'), body);
}

/** Author, committee or staff; its replies and votes go with it. */
export async function removeSocietyContribution(slug, contributionId) {
  await del(societyPath(slug, `/contributions/${encodeURIComponent(contributionId)}`));
}

// Two verbs rather than one toggle, so a request retried after a dropped connection produces the
// state the tap intended.
export async function setContributionHelpful(slug, contributionId, helpful) {
  const path = societyPath(slug, `/contributions/${encodeURIComponent(contributionId)}/helpful`);
  return helpful ? put(path) : del(path);
}

/** Any signed-in caller. */
export async function addContributionReply(slug, contributionId, body) {
  return post(societyPath(slug, `/contributions/${encodeURIComponent(contributionId)}/replies`), {
    body,
  });
}

/** Its own author, the committee or staff — not the contribution's author. */
export async function removeContributionReply(slug, contributionId, replyId) {
  await del(
    societyPath(
      slug,
      `/contributions/${encodeURIComponent(contributionId)}/replies/${encodeURIComponent(replyId)}`,
    ),
  );
}

// One read, so the page cannot render half a state. `whatsappJoinUrl` is null without a verified
// flat here; `whatsappAvailable` is not.
export async function getSocietyProposals(slug) {
  return get(societyPath(slug, '/proposals'));
}

// One endpoint for detail, WhatsApp-link and map-pin proposals — one lifecycle wearing three names.
export async function proposeSocietyChange(slug, payload) {
  return post(societyPath(slug, '/proposals'), payload);
}

// `size` defaults to the server's ceiling, not its `@PageableDefault(20)`: this screen has no pager
// and its heading counts are computed over whatever comes back, so a silent cap would understate.
export async function listSocietyProposalQueue({ status, kind, page, size = MAX_PAGE_SIZE } = {}) {
  const res = await get('/admin/society-proposals', { status, kind, page, size });
  return unwrapFullPage(res, 'society proposals');
}

// Approving writes the value onto the society in the same transaction, so there is no separate
// apply step to fail in between. An already-decided proposal answers 409.
export async function decideSocietyProposal(id, decision) {
  return patch(`/admin/society-proposals/${encodeURIComponent(id)}`, decision);
}

// Full-ceiling `size` because this screen has no pager; deciding stays on `decideResidency`, which
// already owns the one-resident-per-flat rule.
export async function listSocietyResidentQueue({ status, page, size = MAX_PAGE_SIZE } = {}) {
  const res = await get('/admin/society-residents', { status, page, size });
  return unwrapFullPage(res, 'society residents');
}

/** Staff with `societies:read`. */
export async function listSocietyClaimQueue({ status, page, size = MAX_PAGE_SIZE } = {}) {
  const res = await get('/admin/society-claims', { status, page, size });
  return unwrapFullPage(res, 'society claims');
}

// By claim id, not society slug — the server keeps every claim ever filed. Approving grants
// committee authority in the same transaction; an already-decided claim answers 409.
export async function decideSocietyClaim(id, decision) {
  return patch(`/admin/society-claims/${encodeURIComponent(id)}`, decision);
}

// Addressed by claim rather than by document, one request per certificate actually opened — the
// queue read is deliberately left alone.
export async function getSocietyClaimCertificate(claimId) {
  return get(`/admin/society-claims/${encodeURIComponent(claimId)}/certificate`);
}

// Answers the canonical society either way, so the caller's next move works against the real row
// rather than a duplicate they did not know they made.
export async function mintSociety(body) {
  // `withStatus`, because here the code *is* the answer: 201 minted, 200 matched an existing row.
  // Nothing in the body distinguishes the two.
  const { data, status } = await post('/societies', body, { withStatus: true });
  return { society: data, created: status === 201 };
}

/** Staff with `societies:read`. */
export async function listSocietyCandidates({ page, size } = {}) {
  const res = await get('/admin/society-candidates', { page, size });
  return unwrapFullPage(res, 'society candidates');
}

// 409 once verified: the record of who did it is the only thing that says who to ask about the
// society later, so it is never silently overwritten.
export async function verifySocietyCandidate(slug) {
  return post(`/admin/society-candidates/${encodeURIComponent(slug)}/verify`);
}

// A plain array, because the endpoint answers a handful by construction. One request per candidate
// an operator actually opens.
export async function listSocietyCandidateDuplicates(slug, { limit } = {}) {
  const rows = await get(`/admin/society-candidates/${encodeURIComponent(slug)}/duplicates`, { limit });
  return Array.isArray(rows) ? rows : [];
}

// `unwrapFullPage` rather than a silent `.content`: a console that shows the first twenty merges
// and calls it the list is worse than one that says so.
export async function listSocietyMerges({ page, size } = {}) {
  const res = await get('/admin/society-merges', { page, size });
  return unwrapFullPage(res, 'society merges');
}

// Both slugs travel in the body because they are two halves of one statement, not subject and
// object — putting either in the path would read as an edit of that society.
export async function mergeSocieties(from, into) {
  return post('/admin/society-merges', { from, into });
}

// Addressed by the society that was **merged away** — a survivor can have absorbed several
// duplicates, so keying on it would resolve silently to the wrong one.
export async function undoSocietyMerge(slug) {
  await del(`/admin/society-merges/${encodeURIComponent(slug)}`);
}

export async function getSocietyAdminView(slug) {
  return get(`/admin/societies/${encodeURIComponent(slug)}`);
}

// Forwarded as given, not normalised into a full row: the route treats an absent field as
// unchanged, and `adminNote: ''` (clear) must not be coalesced with no `adminNote` (leave).
export async function editSociety(slug, body) {
  return patch(`/admin/societies/${encodeURIComponent(slug)}`, body);
}
