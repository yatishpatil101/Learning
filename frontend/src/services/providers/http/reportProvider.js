// `createReport` is open to any signed-in caller; `listReports` and `triageReport` are staff/admin
// and answer 403 to everyone else, so neither read is called from a consumer surface.
import { ApiError, get, patch, post } from '../../http.js';
import { toReportCreate, toReportTriage, toViewModel, toViewModelPage } from './reportMapper.js';

// The queue filters, tabs and counts client-side over the whole set, so it reads one large page.
// 100 is the server's hard ceiling (`spring.data.web.pageable.max-page-size`); more is clamped.
const PAGE_SIZE = 100;

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
export async function listReports({ status, page = 0, size = PAGE_SIZE } = {}) {
  const query = { page, size };
  // Blank means "everything"; the server 400s on an unknown status, so only send a real one.
  if (status) query.status = status;
  const res = await get('/reports', query);
  warnIfTruncated(res);
  return toViewModelPage(res, { page, size });
}

/** Staff/admin. */
export async function triageReport(id, decision) {
  return toViewModel(await patch(`/reports/${encodeURIComponent(id)}`, toReportTriage(decision)));
}

// Silence here would mean a queue that looks handled because the unhandled reports are on page 2.
function warnIfTruncated(res) {
  const returned = Array.isArray(res?.content) ? res.content.length : 0;
  const total = res?.totalElements ?? returned;
  if (total > returned) {
    console.warn(
      `[reports] The queue holds ${total} reports but only ${returned} were fetched. The tab counts, `
        + 'the filters and the repeat-offender badge are computed over what is loaded, so they are now '
        + 'approximations and some reports are unreachable. Paging is needed here.',
    );
  }
}
