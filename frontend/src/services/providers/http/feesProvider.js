/**
 * HTTP fees provider.
 *
 * `GET /fees` (public, `security: []` in the contract).
 *
 * The response is a bare JSON array of the contract's `Fees` schema — not a `PageResponse` — so
 * there is nothing to unwrap here. One row per deal intent (`rent`, `buy`), ordered by deal.
 *
 * Verified against `backend/src/main/resources/static/openapi/punenest-api.yaml` (`/fees` and the
 * `Fees` schema) and `catalog/fee/FeeResponse.java`. Field-for-field:
 *
 *   deal · brokerage · platformFee · stampDuty · registration · gst · notes
 *
 * `notes` is the only string; the five money fields are `int64` whole rupees.
 */
import { get } from '../../http.js';

/**
 * Coerce one wire row into the service's shape.
 *
 * `Number(...)` rather than a trusting spread because a money field that arrives as a string would
 * otherwise turn the sidebar's addition into string concatenation — `1999 + 360` becoming
 * `"1999360"` is the kind of wrong that renders without erroring.
 *
 * A missing or unparseable figure becomes `0`, not `null` — absence is a contract break rather than
 * "not published", and `null` is reserved for the genuine "there is no published statutory
 * schedule" state (see `feesService.js`). Reusing it for a broken response would make a bug
 * indistinguishable from a documented state.
 *
 * `stampDuty` and `registration` are the two exceptions, and only since D163 (migration V52 dropped
 * their `NOT NULL`). A Maharashtra leave-and-licence duty is 0.25% of the consideration, so it has
 * no correct flat value to publish; the server now sends `null` and computes the real figure per
 * agreement in `LeaveAndLicenceCharges`. Coercing that `null` to `0` here would quote the customer
 * ₹0 for a line the server is about to charge them for — so an explicit `== null` check comes
 * first, and only a *present* value falls through to the `Number(...)` coercion the others get.
 */
const money = (v) => Number(v) || 0;

const toFeeBreakdown = (row) => ({
  deal: String(row?.deal || ''),
  brokerage: money(row?.brokerage),
  platformFee: money(row?.platformFee),
  stampDuty: row?.stampDuty == null ? null : money(row.stampDuty),
  registration: row?.registration == null ? null : money(row.registration),
  gst: money(row?.gst),
  notes: row?.notes || null,
});

/** Every published fee breakdown. Public — no token, no session short-circuit. */
export async function listFees() {
  const rows = await get('/fees');
  return (Array.isArray(rows) ? rows : []).map(toFeeBreakdown);
}
