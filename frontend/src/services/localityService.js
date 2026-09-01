/**
 * Locality Service — Pune's areas, the unit almost every search, price signal and URL is keyed on.
 *
 * `GET /localities` (public).
 *
 * ## Why the seam is one method wide
 *
 * The server also exposes `GET /localities/{slug}`, and nothing here calls it. The locality landing
 * page reads `data/localities.js` and `data/localityIntel.js` — bundled editorial modules, not the
 * mock API — so it sits on a different migration entirely, and pointing it at the server would be a
 * content decision (whose "about" copy wins) rather than a provider swap. Adding a `getLocality`
 * that no caller uses would suggest the page had already been considered and moved.
 *
 * The mock's `getLocality(slug)` also returns a `listingsList`, and the server deliberately does
 * not: `LocalityDetailResponse` says so in as many words, because the page fetches listings
 * separately anyway and an unpaged property array inside an unauthenticated response is a different
 * kind of endpoint. That difference is another reason not to pre-build the method.
 *
 * ## Shape
 *
 *   { slug, name, city, listingCount, avgRentPsf, avgBuyPsf, ratePerSqft, avgRent, demand, focus,
 *     lat, lng, active }
 *
 * Only `slug` and `name` have a consumer today — the listings page merges them into its filter
 * options. The rest is passed through rather than trimmed, because the endpoint returns it and a
 * provider that dropped fields would have to be revisited by the first caller that wanted a price
 * signal, at which point the trimming would look deliberate.
 *
 * ## What the server promises that the mock did not
 *
 * **Only active localities, and the counts are real.** The server filters `active = true` and
 * computes `listingCount` on read (D7.2), where the mock returned every row it had and carried a
 * stored count that nothing ever wrote — three of fifteen were already wrong when it was last
 * checked. The order is alphabetical by name, and here that *is* promised: it is
 * `findByActiveTrueOrderByNameAsc()`, not an accident of insertion.
 */
import { createProvider } from './config.js';

const provider = createProvider('locality');

/**
 * Every active locality, alphabetical.
 *
 * **Public** — this feeds the search filters, which have to work for the signed-out visitor who
 * arrived from a search engine. No token, no short-circuit on a missing session.
 *
 * @returns {Promise<{slug: string, name: string, city: string, listingCount: number,
 *   avgRentPsf: (number|null), avgBuyPsf: (number|null), ratePerSqft: (number|null),
 *   avgRent: (number|null), demand: (number|null), focus: string, lat: (number|null),
 *   lng: (number|null), active: boolean}[]>}
 */
export const listLocalities = async () => (await provider()).listLocalities();
