import { get, post } from '../../http.js';

/** Drop empty strings so the server stores absence as null rather than as a place named "". */
const trimmed = (v) => {
  const s = String(v ?? '').trim();
  return s === '' ? undefined : s;
};

/** Returns true/false because the 202 has no body; the rejection is left to demandService.recordSignal. */
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

/** Every count is a count(*), so 0 is a measurement; coercing keeps the table's arithmetic free of NaN. */
const count = (v) => Number(v) || 0;

const toRow = (row) => ({
  // Absent (NON_NULL) on the row that aggregates signals which carried no locality at all.
  localitySlug: row?.localitySlug ?? null,
  // Absent when the slug has no row in `localities` — somebody asking for somewhere Draazy does
  // not cover. Kept as null so the table can label it rather than print a slug as a place name.
  localityName: row?.localityName ?? null,
  supply: count(row?.supply),
  searches: count(row?.searches),
  alerts: count(row?.alerts),
  views: count(row?.views),
  // Anonymous searches are excluded: a shared 'anon' id would count several strangers as one repeat seeker.
  repeatSeekers: count(row?.repeatSeekers),
  demand: count(row?.demand),
  demandPerListing: Number(row?.demandPerListing) || 0,
});

/** Ordered by demand per listing descending by the server, no-locality row last; not re-derived here. */
export async function supplyGap(opts = {}) {
  const rows = await get('/admin/supply-gap', opts?.days ? { days: opts.days } : undefined);
  return (Array.isArray(rows) ? rows : []).map(toRow);
}
