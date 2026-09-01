/**
 * Rent Service — the tenancy domain: who is renting what, and an owner's per-property finances.
 *
 * Eighteen endpoints over four controllers, held together by the **tenancy**: the thing a rent
 * agreement papers, a declaration claims, and an owner's per-property ledger is about.
 *
 *   `/me/tenancies` · `/tenancies` · `/me/tenant-profile` · `/tenant-profiles/{mobile}`
 *   `/me/rent-agreements`
 *   `/me/finances/{propId}/{transactions,basis,summary,cashflow,dues}`
 *   `/me/rentals` · `/me/rentals/{rentalId}`
 *
 * ## There is no rent payment here
 *
 * There used to be: `/me/rent-payments`, `/me/rent-ledger`, `/me/rent-mandate` and
 * `/me/payout-account` moved money between a tenant and an owner. That rail was withdrawn — the
 * tables are dropped and the endpoints are gone from the contract — and `/pay-rent` is now a static
 * coming-soon page that calls nothing.
 *
 * Named here rather than deleted silently, because the absence is the surprising part: this file is
 * called `rentService` and a reader looking for "where does paying rent happen" needs to find the
 * answer *nowhere*, rather than assume they are reading the wrong file and go on looking.
 *
 * `/me/rentals` is emphatically not that rail wearing a new name. It stores what a tenant *tells*
 * us they pay someone else, so that a tenant who found their home off-platform has a dashboard and
 * an HRA figure at all. Nothing on it settles, and nothing it returns may reach the Rent Passport.
 *
 * ## Whose money is it — the argument that had to go
 *
 * `getTenanciesFor(mobile)` took *whose data to read* as a parameter, because localStorage has no
 * identity so the reader supplies one. Any reader could supply anyone's. The server scopes by
 * token, so that parameter is gone.
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
export const myTenancies = async () => (await provider()).myTenancies();
/** Tenancies on the caller's own listings, where they are the owner. */
export const ownerTenancies = async () => (await provider()).ownerTenancies();

/* ─── Tenancy declarations (D194) ───────────────────────────────────────────────────────────── */

/**
 * The other way a stay gets proved.
 *
 * A brokered tenancy only exists when a rent deal closed on this platform, which most Indian leases
 * never do — they are signed off-platform and the flat is simply listed again afterwards. So the
 * person best placed to review a listing is usually one this API has never seen a tenancy for. A
 * declaration is that person saying so, and it is worth nothing until the **listing's owner** agrees:
 * `status` is `pending` until then, and only `confirmed` opens the review door. Read `status`, never
 * the row's existence.
 *
 * `propId` is the listing's UUID against the live API and its slug under the mock — resolve it as
 * `p.uuid || p.id`, the same value the review routes take. Comparing the wrong one of those two is
 * the bug this whole surface exists to close.
 */
export const listTenancyDeclarations = async (propId) => (await provider()).listTenancyDeclarations(propId);
/** Claim a past stay. 409 if you own the listing, already have a tenancy on it, or already claimed. */
export const declareTenancy = async (propId, body) => (await provider()).declareTenancy(propId, body);
/** Owner only — agree the stay happened. This is the step that turns a claim into evidence. */
export const confirmTenancyDeclaration = async (id) => (await provider()).confirmTenancyDeclaration(id);
/** Owner only — disagree, or take back a confirmation. The row survives; the eligibility does not. */
export const revokeTenancyDeclaration = async (id) => (await provider()).revokeTenancyDeclaration(id);

/** The caller's own renting CV, or `null` if they have never written one. */
export const myTenantProfile = async () => (await provider()).myTenantProfile();
/** Save it. `score` and `verified` are server-owned and ignored if sent. */
export const saveTenantProfile = async (profile) => (await provider()).saveTenantProfile(profile);
/** Somebody else's profile, by mobile — the screening read. `null` when they have none. */
export const tenantProfileFor = async (mobile) => (await provider()).tenantProfileFor(mobile);

/**
 * Which of these people carry the Verified Tenant badge — **one call for a whole list** (D114).
 *
 * The verified tick renders beside every row of a list: every offer on a property, every applicant,
 * every reviewer. `tenantProfileFor` answers for one person, so asking it per row is an N+1 on a
 * render path — which is why this badge sat on localStorage for so long, and why it was wrong for
 * anyone whose profile this browser had never seen.
 *
 * Takes an array of mobiles and resolves to a **`Set` of normalised 10-digit numbers** that are
 * verified. Ask with `set.has(digits(mobile).slice(-10))`.
 *
 * **Fails closed, by construction.** The set only ever contains people the server confirmed, so
 * every failure mode — a rejected request, a signed-out caller, a number the caller only holds in
 * masked form, a person the caller has no relationship with — produces *absence*, and absence
 * renders no badge. A verified tenant may lose a tick; an unverified one can never gain one. Callers
 * should `.catch(() => new Set())` and mean it.
 *
 * Only numbers the caller already holds ever cross the wire, and the server echoes each one back
 * unchanged, so this cannot be used to obtain a number — see the endpoint's own note.
 */
export const tenantsVerified = async (mobiles) => (await provider()).tenantsVerified(mobiles);

/* --- Self-declared rentals (tenant) --- */

/**
 * The homes the caller says they rent, including ones PuneNest was never involved in.
 *
 * This is the tenant's answer to the owner's per-property ledger, and it exists because a tenancy
 * row is only ever created when a rent deal closes *on the platform* — so a tenant who found their
 * home elsewhere had a permanently empty dashboard. What they type here is their own statement:
 * useful for their own totals and their HRA arithmetic, and never evidence of anything.
 *
 * Each row carries `monthsPaid`, `totalPaid` and `fyPaid`, computed by the server from the lease
 * dates. Do not recompute them.
 */
export const myRentals = async () => (await provider()).myRentals();
export const addRental = async (rental) => (await provider()).addRental(rental);
/** Partial by design — send only the fields that changed; `landlordName: ''` clears it. */
export const updateRental = async (rentalId, patch) => (await provider()).updateRental(rentalId, patch);
export const deleteRental = async (rentalId) => (await provider()).deleteRental(rentalId);

/* ─── Property finances (owner, per property) ───────────────────────────────────────────────── */

/** The property's ledger. Paged. */
export const listTransactions = async (propId, page, size) => (await provider()).listTransactions(propId, page, size);
export const addTransaction = async (propId, txn) => (await provider()).addTransaction(propId, txn);
/** Partial by design — send only the fields that changed. */
export const updateTransaction = async (propId, txnId, patch) => (await provider()).updateTransaction(propId, txnId, patch);
export const deleteTransaction = async (propId, txnId) => (await provider()).deleteTransaction(propId, txnId);

/** Purchase price, loan and current value. `null` when nothing has been recorded. */
export const getBasis = async (propId) => (await provider()).getBasis(propId);
export const setBasis = async (propId, basis) => (await provider()).setBasis(propId, basis);

/**
 * Server-computed income/expense/net/occupancy — not a reduction over the page the client holds.
 *
 * `period` is one of `all` | `month` | `quarter` | `year` and is **the same vocabulary the period
 * selector uses**, so the KPI strip and the transaction table below it answer the same question
 * (D178). Omitting it used to mean the card silently reported all-time next to a filtered table.
 */
export const financeSummary = async (propId, period) => (await provider()).financeSummary(propId, period);
/** The monthly series the chart draws. */
export const cashflow = async (propId) => (await provider()).cashflow(propId);
/** What is coming, with a server-computed `daysUntil` that cannot drift by timezone. */
export const dues = async (propId) => (await provider()).dues(propId);

/**
 * `GET /me/rent-agreements` — every agreement the caller signed, newest first, on **either** side:
 * the ones they filed as landlord and the ones filed against them as tenant.
 *
 * Agreements live in the rent domain rather than in a domain of their own because they are the
 * paper record of the same relationship this service already answers for — the tenancy, the
 * payments and the tenant profile. The pages that read an agreement (the rental hub, the tenant
 * finance tab, the document vault) read those alongside it, so a separate domain would only mean a
 * second provider pair to keep in step.
 */
export const myRentAgreements = async () => (await provider()).myRentAgreements();
