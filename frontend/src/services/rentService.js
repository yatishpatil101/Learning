/**
 * Rent Service — the money domain: tenancies, rent payments and property finances.
 *
 * Twenty-one endpoints over three controllers, held together by the **tenancy**: the thing a rent
 * payment is against, a mandate authorises, and an owner's ledger is about.
 *
 *   `/me/tenancies` · `/tenancies` · `/me/tenant-profile` · `/tenant-profiles/{mobile}`
 *   `/me/rent-payments` · `/me/rent-ledger` · `/me/rent-mandate` · `/me/payout-account`
 *   `/me/finances/{propId}/{transactions,basis,summary,cashflow,dues}`
 *
 * ## Paying rent does not settle rent
 *
 * The one thing to carry away. `payRent` opens a payment-gateway order and returns the row **`due`**
 * — only the signature-verified webhook marks it `paid`, and nothing the browser does can make that
 * happen. Read `settled`, never "the call succeeded".
 *
 * The mock granted instantly, because a localStorage write cannot fail. It no longer does, so a
 * call site cannot be written against "tap, therefore paid" and discover the difference in
 * production, with somebody's rent.
 *
 * ## Whose money is it — the argument that had to go
 *
 * `getRentLedger(ownerMobile)`, `getPayoutAccount(mobile)`, `getTenanciesFor(mobile)`: each took
 * *whose data to read* as a parameter, because localStorage has no identity so the reader supplies
 * one. Any reader could supply anyone's. The server scopes by token, so those parameters are gone.
 *
 * `tenantProfileFor(mobile)` is the deliberate exception and reads as one: an owner screening an
 * applicant is what a tenant profile exists for, and the server decides what a stranger may see.
 *
 * ## Three sums that are now the server's
 *
 * `summary`, `cashflow` and `dues` were client-side reductions over the transaction list. They are
 * endpoints now — not for tidiness, but because the ledger is **paged**, so a reduction over what
 * the client had downloaded was a summary of page one wearing the label of a summary.
 */
import { createProvider } from './config.js';

const provider = createProvider('rent');

/* ─── Tenancies ─────────────────────────────────────────────────────────────────────────────── */

/** Tenancies where the caller is the tenant. */
export const myTenancies = () => provider().myTenancies();
/** Tenancies on the caller's own listings, where they are the owner. */
export const ownerTenancies = () => provider().ownerTenancies();

/** The caller's own renting CV, or `null` if they have never written one. */
export const myTenantProfile = () => provider().myTenantProfile();
/** Save it. `score` and `verified` are server-owned and ignored if sent. */
export const saveTenantProfile = (profile) => provider().saveTenantProfile(profile);
/** Somebody else's profile, by mobile — the screening read. `null` when they have none. */
export const tenantProfileFor = (mobile) => provider().tenantProfileFor(mobile);

/* ─── Rent ──────────────────────────────────────────────────────────────────────────────────── */

/** What the caller has paid, as a tenant. Paged: `{ items, page, size, total, totalPages }`. */
export const myRentPayments = (page, size) => provider().myRentPayments(page, size);
/** What the caller has been paid, as an owner. Same envelope. */
export const rentLedger = (page, size) => provider().rentLedger(page, size);

/**
 * Pay this month's rent. **Returns a `due` payment** — check `settled` before saying it landed.
 *
 * 409 on three states worth distinguishing in the UI: no rent on the tenancy, an `expectedAmount`
 * that no longer matches (send the figure the tenant was shown — that is what makes this safe), and
 * a month already paid or in progress.
 *
 * Idempotent per tenancy per month, so a double-tapped Pay returns the original rather than
 * charging twice.
 */
export const payRent = (req) => provider().payRent(req);

/** The caller's auto-pay authority, or `null`. */
export const getMandate = () => provider().getMandate();
/** Authorise auto-pay. `dayOfMonth` is 1–28: no month is shorter, so a later day would skip some. */
export const setMandate = (req) => provider().setMandate(req);

/** Where the owner's rent lands. **Carries a mask, never the account number.** */
export const getPayoutAccount = () => provider().getPayoutAccount();
/** Set it. Takes `accountNumber`; reads back `maskedAccount` — the server will not re-serve it. */
export const savePayoutAccount = (acc) => provider().savePayoutAccount(acc);

/* ─── Property finances (owner, per property) ───────────────────────────────────────────────── */

/** The property's ledger. Paged. */
export const listTransactions = (propId, page, size) => provider().listTransactions(propId, page, size);
export const addTransaction = (propId, txn) => provider().addTransaction(propId, txn);
/** Partial by design — send only the fields that changed. */
export const updateTransaction = (propId, txnId, patch) => provider().updateTransaction(propId, txnId, patch);
export const deleteTransaction = (propId, txnId) => provider().deleteTransaction(propId, txnId);

/** Purchase price, loan and current value. `null` when nothing has been recorded. */
export const getBasis = (propId) => provider().getBasis(propId);
export const setBasis = (propId, basis) => provider().setBasis(propId, basis);

/** Server-computed income/expense/net/occupancy — not a reduction over the page the client holds. */
export const financeSummary = (propId) => provider().financeSummary(propId);
/** The monthly series the chart draws. */
export const cashflow = (propId) => provider().cashflow(propId);
/** What is coming, with a server-computed `daysUntil` that cannot drift by timezone. */
export const dues = (propId) => provider().dues(propId);
