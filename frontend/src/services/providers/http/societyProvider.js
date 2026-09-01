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
import { del, get, put, unwrapFullPage } from '../../http.js';
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
