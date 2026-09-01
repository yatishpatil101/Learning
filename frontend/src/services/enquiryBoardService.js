/**
 * Enquiry board — the demand-side console (D25).
 *
 * Three lists and three reveals, all against `/admin/…`:
 *
 *   listEnquiries / listVisits / listDeals   the board, one row per contact request, visit or deal,
 *                                            with the one contact number on each row **masked**
 *   revealEnquiry / revealVisit / revealDeal the same row with that number readable, and an
 *                                            `audit_log` entry recording that an administrator
 *                                            asked for it
 *
 * ## Why the reveal is six calls and not one flag
 *
 * The obvious design is `listEnquiries({ reveal: true })`, and it is the wrong one. A parameter on
 * the list makes bulk disclosure a single request — the shape of an export, not of a support action
 * — and it makes the audit trail a row saying "somebody looked at forty numbers", which answers no
 * question anyone will later ask. A detail read per row costs a click and buys a log that names the
 * record.
 *
 * The three are separate functions rather than `reveal(kind, id)` for the same reason the server has
 * three methods: the deals case is not a variation on the other two. A deal's counterparty may be
 * somebody who never held an account here — the number was typed by an owner closing off-platform —
 * so it is not "the same lookup against a different table", and a shared helper would make that
 * difference look incidental.
 *
 * ## What is not here
 *
 * No writes. The board is read-only on the server and stays read-only through this seam: an operator
 * who needs to record that they acted writes an **internal note** against the listing, which is a
 * sentence somebody will read, rather than flipping a status field the two people in the
 * conversation cannot see and did not agree to.
 *
 * `kind` is also absent. The mock board labelled every enquiry `contact`, `chat` or `call`; only
 * `contact` was ever a row in a table. Chats have their own moderated surface and the platform
 * places no calls, so the enquiry "type" filter was a picker over a vocabulary with one real value.
 */
import { createProvider } from './config.js';

const provider = createProvider('enquiryBoard');

export async function listEnquiries(params) {
  return (await provider()).listEnquiries(params);
}

export async function listVisits(params) {
  return (await provider()).listVisits(params);
}

export async function listDeals(params) {
  return (await provider()).listDeals(params);
}

/** One enquiry with the requester's mobile readable. Audited server-side; admin only. */
export async function revealEnquiry(id) {
  return (await provider()).revealEnquiry(id);
}

/** One visit with the visitor's mobile readable. Audited server-side; admin only. */
export async function revealVisit(id) {
  return (await provider()).revealVisit(id);
}

/** One deal with the counterparty's mobile readable. Audited server-side; admin only. */
export async function revealDeal(id) {
  return (await provider()).revealDeal(id);
}
