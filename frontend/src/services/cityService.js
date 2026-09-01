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

