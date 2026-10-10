// `createReport` is open to any signed-in caller; `listReports` and `triageReport` are staff/admin
// and answer 403 to everyone else, so neither read is called from a consumer surface.
import { ApiError, get, patch, post } from '../../http.js';
import { toReportCreate, toReportTriage, toViewModel, toViewModelPage } from './reportMapper.js';

// The queue is server-paged and server-filtered; `counts` asks for the tab/status totals, which
// the caller needs only on first load, tab change and after a decision.
const PAGE_SIZE = 10;

// A duplicate is a 409, returned as `'duplicate'` rather than thrown: it is the server telling the
// user something true, and the modal has a sentence for it.
export async function createReport(report) {
  try {
    return toViewModel(await post('/reports', toReportCreate(report)));
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) return 'duplicate';
    throw err;
  }
}

/** Staff/admin — a consumer session gets 403. */
export async function listReports({
  status, reason, targetType, q, sinceDays, page = 0, size = PAGE_SIZE, counts = false,
} = {}) {
  const query = { page, size };
  // Blank means "everything"; the server 400s on an unknown value, so only send a real one.
  if (status) query.status = status;
  if (reason) query.reason = reason;
  if (targetType) query.targetType = targetType;
  if (q) query.q = q;
  if (sinceDays) query.sinceDays = sinceDays;
  if (counts) query.counts = true;
  return toViewModelPage(await get('/reports', query), { page, size });
}

/** Staff/admin. */
export async function triageReport(id, decision) {
  return toViewModel(await patch(`/reports/${encodeURIComponent(id)}`, toReportTriage(decision)));
}
