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
import { get } from '../../http.js';
import { toRatingIndex } from './societyMapper.js';

/** The server's hard ceiling (`spring.data.web.pageable.max-page-size`); asking for more is clamped. */
const PAGE_SIZE = 100;

/** 20 × 100 = 2,000 societies. The seeded catalogue is 348. */
const MAX_PAGES = 20;

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
