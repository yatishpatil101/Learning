import { post } from '../../http.js';

/** Drop empty strings so the server stores absence as null rather than as a host named "". */
const trimmed = (v) => {
  const s = String(v ?? '').trim();
  return s === '' ? undefined : s;
};

/** Body is rebuilt field by field so nothing identifying can ride along on a queued event.
 * `agoMs` is floored at 0: a backwards clock step would give a negative the server rejects. */
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
    attributed: batch?.attributed === true,
  }, { keepReads: true });
  return true;
}
