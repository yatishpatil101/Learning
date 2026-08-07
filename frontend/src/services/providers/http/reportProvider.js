/**
 * HTTP report provider — the live counterpart to `providers/mock/reportProvider.js`.
 *
 * Method names, argument order and return shapes mirror the mock exactly; `reportService.js` is the
 * only contract between them. Shape translation lives in `reportMapper.js`.
 *
 * **This is the first provider whose operations have different audiences.** `createReport` is open
 * to any signed-in caller; `listReports` and `triageReport` are staff/admin and answer 403 to
 * everyone else. That is not an error to handle — it is the endpoint working — so neither read is
 * called from a consumer surface.
 */
import { ApiError, get, patch, post } from '../../http.js';
import { toReportCreate, toReportTriage, toViewModel, toViewModelPage } from './reportMapper.js';

/**
 * One large page rather than real paging.
 *
 * The queue filters, searches, tabs and counts client-side, and computes a per-target repeat count
 * across the whole set to flag escalations. Those numbers are wrong if they are computed over page
 * 1 of n. 100 is the server's hard ceiling (`spring.data.web.pageable.max-page-size`); asking for
 * more is silently clamped, which is why `warnIfTruncated` compares against the rows returned
 * rather than against this constant.
 */
const PAGE_SIZE = 100;

/**
 * File a report.
 *
 * A duplicate — a second live report of the same target by the same person — is a **409**, enforced
 * by a partial unique index rather than only by a check, so two concurrent submissions get the same
 * answer. It is returned as `'duplicate'` rather than thrown: it is not a failure, it is the server
 * telling the user something true, and the modal has a sentence for it.
 */
export async function createReport(report) {
  try {
    return toViewModel(await post('/reports', toReportCreate(report)));
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) return 'duplicate';
    throw err;
  }
}

/** The moderation queue. Staff/admin — a consumer session gets 403. */
export async function listReports({ status, page = 0, size = PAGE_SIZE } = {}) {
  const query = { page, size };
  // Blank means "everything"; the server 400s on an unknown status, so only send a real one.
  if (status) query.status = status;
  const res = await get('/reports', query);
  warnIfTruncated(res);
  return toViewModelPage(res, { page, size });
}

/** Move a report through triage. Staff/admin. */
export async function triageReport(id, decision) {
  return toViewModel(await patch(`/reports/${encodeURIComponent(id)}`, toReportTriage(decision)));
}

/**
 * Say so when the queue is larger than the page every count is computed over.
 *
 * Silence here would mean an ops queue that looks handled because the unhandled ones are on page 2
 * — the failure mode that gets *more* likely the busier moderation becomes, and the one nobody
 * reproduces because it needs a hundred reports to appear.
 */
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
