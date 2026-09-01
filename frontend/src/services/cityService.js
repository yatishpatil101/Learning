import { createProvider } from './config.js';

/**
 * The curated city roster: which cities exist, which are live, and how much inventory each has.
 *
 * **Opt this domain in alongside `settings`.** `lib/geoConfig.js` composes one policy from two
 * routes — `GET /geo` (bounds, blacklist) on the `settings` domain and `GET /cities` (roster,
 * launch state) on this one. A deployment whose `VITE_API_DOMAINS` names `settings` but not `city`
 * gets a live map policy blended with a mock roster, and `config.js` will not warn, because this
 * domain does have an http provider — it simply was not asked for.
 */
const provider = createProvider('city');

/** The curated city roster shoppers can pick from (`GET /cities`). */
export const listCities = async () => (await provider()).listCities();

/** Flip one curated city's launch state from the back office (`PATCH /admin/cities/{slug}`). */
export const updateCityLive = async (slug, live) =>
  (await provider()).updateCity(slug, { live });

/**
 * Ask to be told when Draazy launches somewhere (`POST /cities/waitlist`).
 *
 * This used to be a `localStorage` array, which made it the one demand signal the operator could
 * never see: the shopper's ask was filed in the shopper's own browser. Resolves on 201 and throws
 * on anything else, so the caller's success toast means the server has the row.
 */
export const joinCityWaitlist = async (request) => (await provider()).joinCityWaitlist(request);

/**
 * Which cities people have asked for, most-wanted first (`GET /admin/cities/waitlist`).
 *
 * The read half of the line above, and the reason it was worth wiring: an ask nobody can count is
 * not a demand signal. Rows are `{ city, requests, lastRequestedAt }` — aggregate only, by design.
 */
export const listCityWaitlist = async () => (await provider()).listCityWaitlist();

