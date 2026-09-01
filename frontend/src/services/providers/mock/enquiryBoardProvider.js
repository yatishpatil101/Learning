/**
 * Mock enquiry-board provider — the browser-store side of the demand console (D25).
 *
 * ## It masks too
 *
 * The mock store holds raw mobiles, and the obvious mock provider hands them straight to the page.
 * That would make masking a property of the *server* rather than of the board, and the mock suite —
 * which is where most of this console's coverage lives — would then be exercising a screen that
 * behaves differently from the one that ships. So this file masks on the way out and unmasks only in
 * the reveal calls, which is exactly the shape of the live contract.
 *
 * There is no mock audit row for the reveal. `logAudit` writes to a browser array nobody reads back,
 * and a fake record of a disclosure that did not disclose anything is worse than no record: it would
 * make the mock look like it had the guarantee the server actually provides.
 *
 * ## The board is read-only here as well
 *
 * The mock store still has `status` fields on all three collections and the console still writes
 * them, but that write goes through `updateCollection` in the page's own helpers, not through this
 * provider. Statuses on this board were only ever a browser-local scratchpad; giving them a provider
 * call would have made them look like part of the contract.
 */
import { rawLoad, delay } from '../../../lib/mockApi/core.js';

/**
 * Same rule as the server's `MobileMask`: ten digits become `98XXXXX210`, and anything that is not
 * exactly ten digits becomes nothing at all. Failing closed matters more in the mock than in the
 * server, because seed data is where malformed numbers actually come from.
 */
function mask(mobile) {
  const digits = String(mobile ?? '').replace(/\D/g, '');
  if (digits.length !== 10) return null;
  return `${digits.slice(0, 2)}XXXXX${digits.slice(7)}`;
}

const rows = (coll) => (rawLoad()[coll] || []).filter((x) => !x.archived);

const find = (coll, id) => rows(coll).find((r) => String(r.id) === String(id)) || null;

const masked = (r) => ({ ...r, mobile: mask(r.mobile) });

const byStatus = (list, status) => (status ? list.filter((r) => r.status === status) : list);

export async function listEnquiries({ status } = {}) {
  return delay(byStatus(rows('enquiries'), status).map(masked));
}

export async function listVisits({ status } = {}) {
  return delay(byStatus(rows('visits'), status).map(masked));
}

export async function listDeals({ status } = {}) {
  return delay(byStatus(rows('deals'), status).map(masked));
}

/**
 * The reveal. A missing row throws rather than resolving to `null`, because the live route answers
 * 404 and a console that renders an empty detail panel for a deleted row is a console whose
 * behaviour depends on which provider it is running against.
 */
function reveal(coll, label, id) {
  const row = find(coll, id);
  if (!row) throw new Error(`${label} ${id} not found`);
  return delay({ ...row });
}

export async function revealEnquiry(id) {
  return reveal('enquiries', 'Enquiry', id);
}

export async function revealVisit(id) {
  return reveal('visits', 'Visit', id);
}

export async function revealDeal(id) {
  return reveal('deals', 'Deal', id);
}
