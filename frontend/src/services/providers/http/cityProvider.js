import { get, patch } from '../../http.js';

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

