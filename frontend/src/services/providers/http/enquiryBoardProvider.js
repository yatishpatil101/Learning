/** The lists are server-paged and server-filtered; the summary carries the tab counts, GMV and the funnel. */
import { get, unwrapPage } from '../../http.js';
import { toDeal, toEnquiry, toVisit } from './enquiryBoardMapper.js';

const query = ({ status, deal, q, days, page = 0, size = 10 } = {}) => ({
  page,
  size,
  status: status || undefined,
  deal: deal || undefined,
  q: q || undefined,
  days: days || undefined,
});

async function listPage(path, params, map) {
  const res = await get(path, query(params));
  const wrapped = unwrapPage(res, { page: params?.page ?? 0, size: params?.size ?? 10 });
  return { ...wrapped, items: wrapped.items.map(map) };
}

export const listEnquiries = (params) => listPage('/admin/enquiries', params, toEnquiry);
export const listVisits = (params) => listPage('/admin/visits', params, toVisit);
export const listDeals = (params) => listPage('/admin/deals', params, toDeal);

export async function getEnquirySummary({ days, deal } = {}) {
  return get('/admin/enquiries/summary', { days: days || undefined, deal: deal || undefined });
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