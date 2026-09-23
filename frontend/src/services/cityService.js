import { createProvider } from './config.js';

// `lib/geoConfig.js` composes one map policy from `GET /geo` and `GET /cities` — changing what
// this returns moves that policy.
const provider = createProvider('city');

/** The curated city roster shoppers can pick from (`GET /cities`). */
export const listCities = async () => (await provider()).listCities();

/** Flip one curated city's launch state from the back office (`PATCH /admin/cities/{slug}`). */
export const updateCityLive = async (slug, live) =>
  (await provider()).updateCity(slug, { live });

/** Resolves on 201 and throws otherwise, so a success toast means the server has the row. */
export const joinCityWaitlist = async (request) => (await provider()).joinCityWaitlist(request);

/** Rows are `{ city, requests, lastRequestedAt }` — aggregate only, by design. */
export const listCityWaitlist = async () => (await provider()).listCityWaitlist();

