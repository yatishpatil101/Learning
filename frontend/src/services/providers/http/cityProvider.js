import { get, patch, post } from '../../http.js';
import { bootstrapSection } from './bootstrap.js';

/** The public city roster, live cities first. */
export async function listCities() {
  const rows = await bootstrapSection('cities');
  return Array.isArray(rows) ? rows : [];
}

/** Fires draazy-settings-change so main.jsx re-runs loadGeoPolicy(); otherwise the operator's own
 * tab keeps serving a stale city roster from geoConfig's cache. */
export async function updateCity(slug, body) {
  await patch(`/admin/cities/${encodeURIComponent(slug)}`, body);
  window.dispatchEvent(new CustomEvent('draazy-settings-change'));
}

/** `auth: false`: the contract marks the route `security: []`, so visitors in unserved cities can still ask.
 * `name` is dropped on purpose: the request has no such field and a waitlist has no use for it. */
export async function joinCityWaitlist({ city, mobile, email }) {
  const body = { city, mobile };
  if (email) body.email = email;
  await post('/cities/waitlist', body, { auth: false });
}

/** Authenticated unlike the write above: anyone may ask, only staff may read. Counts only, never contacts:
 * the server aggregates in the database so no mobile reaches this response. */
export async function listCityWaitlist() {
  const rows = await get('/admin/cities/waitlist');
  /* Throw rather than coerce to [] so the panel can tell "the read failed" from "nobody asked", which
     would otherwise close the expansion queue on the strength of an outage. */
  if (!Array.isArray(rows)) throw new Error('GET /admin/cities/waitlist: expected an array');
  return rows;
}

