/**
 * HTTP enquiry-board provider.
 *
 * ## The lists are paged and this provider drains them
 *
 * The console renders all three tabs' rows into KPI tiles, a funnel and a client-side filter, so it
 * needs the set rather than a window of it. The server pages at twenty; asking for a large page once
 * is the honest translation of what the page does today, and it keeps the funnel from being a chart
 * of the first twenty rows — which is what a paged reader plus in-page aggregation quietly produces.
 *
 * `size` is capped rather than unbounded. A board with more rows than this is a board that needs
 * server-side aggregation, not a bigger request, and the cap makes that the day it becomes obvious
 * instead of the day the console stops responding.
 *
 * ## The reveals return the same shape as the list
 *
 * `revealEnquiry(id)` gives back a row identical to the one already on screen except that the mobile
 * is readable. The caller replaces the row in place; there is no second record type to hold, and no
 * "detail" state that can drift from the list state.
 */
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

export async function revealEnquiry(id) {
  return toEnquiry(await get(`/admin/enquiries/${encodeURIComponent(id)}`));
}

export async function revealVisit(id) {
  return toVisit(await get(`/admin/visits/${encodeURIComponent(id)}`));
}

export async function revealDeal(id) {
  return toDeal(await get(`/admin/deals/${encodeURIComponent(id)}`));
}
