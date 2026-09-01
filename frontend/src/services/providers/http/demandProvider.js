/**
 * HTTP demand provider.
 *
 * `POST /demand-signals` (public, 202, no body) and `GET /admin/supply-gap` (staff/admin).
 *
 * Verified against `engagement/demand/DemandSignalCreate.java` and `admin/SupplyGapRow.java`.
 */
import { get, post } from '../../http.js';

/** Drop empty strings so the server stores absence as null rather than as a place named "". */
const trimmed = (v) => {
  const s = String(v ?? '').trim();
  return s === '' ? undefined : s;
};

/**
 * Post one signal.
 *
 * Returns `true`/`false` rather than the response, because there is no response: the endpoint
 * answers 202 with an empty body on purpose. Nothing is created that the caller can later address,
 * so an id would be a reference it could never resolve.
 *
 * The rejection is deliberately not caught here — `demandService.recordSignal` owns that decision
 * for both providers, so the swallowing lives in one place instead of two.
 */
export async function recordSignal(signal) {
  await post('/demand-signals', {
    kind: String(signal?.kind || ''),
    localitySlug: trimmed(signal?.localitySlug),
    deal: trimmed(signal?.deal),
    bhk: trimmed(signal?.bhk),
    propertyId: trimmed(signal?.propertyId),
  });
  return true;
}

/**
 * A number the server always sends.
 *
 * Every count on this row is a `count(*)`, so 0 is a measurement rather than a gap — unlike the
 * locality price signals, which are genuinely nullable and stay null. Coercing here is safe and
 * keeps the table's arithmetic from producing `NaN` on a field the server happened to omit.
 */
const count = (v) => Number(v) || 0;

const toRow = (row) => ({
  // Absent (NON_NULL) on the row that aggregates signals which carried no locality at all.
  localitySlug: row?.localitySlug ?? null,
  // Absent when the slug has no row in `localities` — somebody asking for somewhere PuneNest does
  // not cover. Kept as null so the table can label it rather than print a slug as a place name.
  localityName: row?.localityName ?? null,
  supply: count(row?.supply),
  searches: count(row?.searches),
  alerts: count(row?.alerts),
  views: count(row?.views),
  // Signed-in visitors who searched this locality three or more times in the window. Anonymous
  // searches are excluded on purpose: the server cannot tell two strangers apart, and the browser
  // version's attempt to (a literal 'anon' user id) reported three strangers as one repeat seeker.
  repeatSeekers: count(row?.repeatSeekers),
  demand: count(row?.demand),
  // Signed: negative means more homes there than anybody is asking for, which is as actionable as
  // the positive case.
  gap: Number(row?.gap) || 0,
});

/** Ordered by gap descending by the server; the order is not re-derived here. */
export async function supplyGap(opts = {}) {
  const rows = await get('/admin/supply-gap', opts?.days ? { days: opts.days } : undefined);
  return (Array.isArray(rows) ? rows : []).map(toRow);
}
