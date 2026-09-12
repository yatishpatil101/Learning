/**
 * HTTP page view provider.
 *
 * `POST /page-views` (public, 202, no body).
 *
 * Verified against `engagement/pageview/PageViewBatchCreate.java`.
 */
import { post } from '../../http.js';

/** Drop empty strings so the server stores absence as null rather than as a host named "". */
const trimmed = (v) => {
  const s = String(v ?? '').trim();
  return s === '' ? undefined : s;
};

/**
 * Post one flush.
 *
 * The body is rebuilt field by field rather than forwarded, which matters more here than it usually
 * does: the caller is a beacon holding a queue of objects it built itself, and forwarding them
 * wholesale would send whatever a future contributor happened to park on a queued event — into the
 * one table whose justification is that it holds nothing identifying. Naming the four fields means
 * a fifth cannot arrive by accident.
 *
 * `agoMs` is floored at zero because the beacon computes it from two `Date.now()` readings and a
 * clock that steps backwards between them would otherwise produce a negative, which the server
 * rejects — losing the whole batch over one arithmetic artefact.
 *
 * The rejection is deliberately not caught here; `pageViewService.recordPageViews` owns that
 * decision for both providers, so the swallowing lives in one place instead of two.
 */
export async function recordPageViews(batch) {
  const events = (batch?.events || []).map((e) => ({
    path: String(e?.path || ''),
    referrerHost: trimmed(e?.referrerHost),
    device: String(e?.device || ''),
    agoMs: Math.max(0, Math.round(Number(e?.agoMs) || 0)),
  }));

  await post('/page-views', {
    sessionId: String(batch?.sessionId || ''),
    events,
  });
  return true;
}
