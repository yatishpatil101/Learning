// `GET /societies` carries `avgRating`/`reviewCount`/`listingCount` per row, so a directory page
// needs no second read for its ratings or home counts.
import { del, get, patch, post, put, unwrapFullPage, unwrapPage } from '../../http.js';
import { MAX_PAGE_SIZE } from '../../apiLimits.js';
import { toRatingIndex, toSociety } from './societyMapper.js';

// The badge half of "strongest" is not a sortable column, so the server can only narrow the
// population. Pinned to the page ceiling, not a second literal.
const LISTED_CANDIDATES = MAX_PAGE_SIZE;

// One page, read whole: the answer feeds a membership check, so an unread second page is not a
// shorter list but societies the directory draws as unfollowed.
const FOLLOW_PAGE_SIZE = 500;

// One server page of the directory, filtered and ordered there; ratings are a slug-keyed index so an unrated `null` stays distinct from zero.
// `total` is the whole filtered set, not this page.
export async function listSocietiesPage({
  q = '', locality = '', sort = 'relevance', page = 0, size = 24,
} = {}) {
  const res = await get('/societies', {
    q: q || undefined,
    locality: locality || undefined,
    sort,
    page,
    size,
  });
  const content = Array.isArray(res?.content) ? res.content : [];
  return {
    rows: content.map(toSociety).filter(Boolean),
    ratings: toRatingIndex(content),
    total: Number(res?.totalElements) || 0,
  };
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

const SEARCH_CANDIDATES = 20;

// **The locality is deliberately not sent** — docs/flows/consumer/societies.md
export async function searchSocieties(query) {
  const res = await get('/societies', {
    q: query || undefined,
    page: 0,
    size: SEARCH_CANDIDATES,
  });
  const rows = Array.isArray(res?.content) ? res.content : [];
  return rows.map(toSociety).filter(Boolean);
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

// `society` is the row already bound to that Place ID; without one, `candidates` are nearby rows
// that may be the same building. Public, so a signed-out owner can still bind an existing society.
export async function resolveSociety({ placeId, name, lat, lng }) {
  const res = await get('/societies/resolve', {
    placeId,
    name: name || undefined,
    lat: lat == null ? undefined : lat,
    lng: lng == null ? undefined : lng,
  });
  const candidates = (Array.isArray(res?.candidates) ? res.candidates : []).map(toSociety).filter(Boolean);
  return { society: toSociety(res?.society), candidates };
}

// Answers the canonical society either way, so the caller's next move works against the real row
// rather than a duplicate they did not know they made.
export async function mintSociety({
  placeId, name, lat, lng, localityLabel, localitySlug, mintOrigin = 'listing',
}) {
  // `withStatus`, because here the code *is* the answer: 201 minted, 200 matched an existing row.
  const { data, status } = await post('/societies', {
    placeId, name, lat, lng, localityLabel, localitySlug, mintOrigin,
  }, { withStatus: true });
  return { society: toSociety(data), created: status === 201 };
}

/** Staff with `societies:read`. */
export async function listSocietyCandidates({ page, size = MAX_PAGE_SIZE } = {}) {
  const res = await get('/admin/society-candidates', { page, size });
  return unwrapFullPage(res, 'society candidates');
}

// A plain array, because the endpoint answers a handful by construction. One request per candidate
// an operator actually opens.
export async function listSocietyCandidateDuplicates(slug, { limit } = {}) {
  const rows = await get(`/admin/society-candidates/${encodeURIComponent(slug)}/duplicates`, { limit });
  return Array.isArray(rows) ? rows : [];
}

export async function getSocietiesSummary() {
  return get('/admin/societies/summary');
}

export async function listSocietyMerges({ page, size } = {}) {
  const res = await get('/admin/society-merges', { page, size });
  return unwrapFullPage(res, 'society merges');
}

// Both slugs travel in the body because they are two halves of one statement, not subject and
// object — putting either in the path would read as an edit of that society.
export async function mergeSocieties(from, into) {
  return post('/admin/society-merges', { from, into });
}

// Addressed by source society: a survivor can absorb several duplicates, so keying on it
// would resolve silently to the wrong one.
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
