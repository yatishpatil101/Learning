import { get, patch, post } from '../../http.js';

/**
 * The public city roster, live cities first.
 *
 * `auth: false` because the contract marks `/cities` `security: []`, and this runs at boot for
 * every visitor including logged-out ones. Attaching a bearer to a route that does not want one
 * puts a second request on the 401 → refresh → sign-out path in `http.js` for no benefit.
 */
export async function listCities() {
  const rows = await get('/cities', null, { auth: false });
  return Array.isArray(rows) ? rows : [];
}

/**
 * Launch or pause one curated city from the back office.
 *
 * Fires `punenest-settings-change` on success, which is what `main.jsx` listens on to re-run
 * `loadGeoPolicy()`. Without it the operator's own tab would keep serving the old roster from
 * `geoConfig`'s cache until the next full load — the console would disagree with the site it
 * just configured.
 */
export async function updateCity(slug, body) {
  await patch(`/admin/cities/${encodeURIComponent(slug)}`, body);
  window.dispatchEvent(new CustomEvent('punenest-settings-change'));
}

/**
 * "Tell me when you launch in my city" (`POST /cities/waitlist`).
 *
 * `auth: false` because the contract marks the route `security: []` — the whole point is that a
 * visitor who cannot transact here yet can still ask, and requiring a session would collect the
 * signal only from the people who already signed up for a city we do not serve.
 *
 * **The form's `name` is dropped on purpose.** `CityWaitlistCreateRequest` has no such field and
 * `city_waitlist` has no column for it: a waitlist needs a way to reach you and a city to reach you
 * about, so a name is personal data with no purpose. Sending it would be silently discarded by
 * Jackson, which reads as "we stored it" to anyone reading this call site.
 *
 * The server answers 201 whether or not a row was written — a repeat ask is not a conflict — so
 * there is no duplicate case to handle here.
 */
export async function joinCityWaitlist({ city, mobile, email }) {
  const body = { city, mobile };
  if (email) body.email = email;
  await post('/cities/waitlist', body, { auth: false });
}

/**
 * The other side of the waitlist: which cities people have asked for (`GET /admin/cities/waitlist`).
 *
 * Authenticated, unlike the write directly above it, and the asymmetry is the design — anybody may
 * ask, only the back office may read. Staff-visible rather than admin-only because it renders on the
 * Supply Gap tab beside `GET /admin/supply-gap`, which has the same guard.
 *
 * **Counts, not contacts.** The server aggregates in the database, so a mobile never reaches this
 * response. Anyone tempted to add a "show me who asked" drill-down should read the endpoint's
 * description first: the constraint is deliberate, not an oversight.
 *
 * Takes no window parameter, unlike every other analytics read. Wanting a city does not decay.
 */
export async function listCityWaitlist() {
  const rows = await get('/admin/cities/waitlist');
  /* Throw rather than coerce to `[]`. The panel above this distinguishes "the read failed" from
     "nobody asked" precisely because the second sentence would close the expansion queue on the
     strength of an outage — and a resolved `[]` is indistinguishable from an empty waitlist, so
     coercing here would defeat that from below. `listCities` does coerce, defensibly: an empty
     roster degrades to the client's Pune default rather than to a false claim. */
  if (!Array.isArray(rows)) throw new Error('GET /admin/cities/waitlist: expected an array');
  return rows;
}

