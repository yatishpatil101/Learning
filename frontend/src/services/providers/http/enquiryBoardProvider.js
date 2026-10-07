/** Drains the paged lists with one large capped page: the console aggregates client-side, so a window would
 * chart only the first rows; the cap makes outgrowing it obvious. */
import { get, unwrapFullPage } from '../../http.js';
import { toDeal, toEnquiry, toVisit } from './enquiryBoardMapper.js';

/** One page big enough to be the whole board, small enough to be a bug report if it is not. */
const PAGE = 200;

const query = ({ status } = {}) => (status ? { status, size: PAGE } : { size: PAGE });

export async function listEnquiries(params = {}) {
  return unwrapFullPage(await get('/admin/enquiries', query(params))).map(toEnquiry);
}

export async function listVisits(params = {}) {
  return unwrapFullPage(await get('/admin/visits', query(params))).map(toVisit);
}

export async function listDeals(params = {}) {
  return unwrapFullPage(await get('/admin/deals', query(params))).map(toDeal);
}

export async function getEnquiry(id) {
  return toEnquiry(await get(`/admin/enquiries/${encodeURIComponent(id)}`));
}

export async function getVisit(id) {
  return toVisit(await get(`/admin/visits/${encodeURIComponent(id)}`));
}

export async function getDeal(id) {
  return toDeal(await get(`/admin/deals/${encodeURIComponent(id)}`));
}
