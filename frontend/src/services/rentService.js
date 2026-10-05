import { createProvider } from './config.js';

const provider = createProvider('rent');

/** Tenancies where the caller is the tenant. */
export const myTenancies = async () => (await provider()).myTenancies();

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

/* Batch tenant verification so list rows do not each ask for the same badge state. */
export const tenantsVerified = async (mobiles) => (await provider()).tenantsVerified(mobiles);

/** This is the tenant's answer to the owner's per-property ledger, and it exists because a tenancy row is only ever
 * created when a rent deal closes *on the platform*. */
export const myRentals = async () => (await provider()).myRentals();
export const addRental = async (rental) => (await provider()).addRental(rental);
export const updateRental = async (rentalId, patch) => (await provider()).updateRental(rentalId, patch);
export const deleteRental = async (rentalId) => (await provider()).deleteRental(rentalId);

/** The property's ledger. Paged. */
export const listTransactions = async (propId, page, size) => (await provider()).listTransactions(propId, page, size);
export const addTransaction = async (propId, txn) => (await provider()).addTransaction(propId, txn);
/** Partial by design — only dirty fields cross the seam. */
export const updateTransaction = async (propId, txnId, patch) => (await provider()).updateTransaction(propId, txnId, patch);
export const deleteTransaction = async (propId, txnId) => (await provider()).deleteTransaction(propId, txnId);

/** Purchase price, loan and current value. `null` when nothing has been recorded. */
export const getBasis = async (propId) => (await provider()).getBasis(propId);
export const setBasis = async (propId, basis) => (await provider()).setBasis(propId, basis);

export const financeSummary = async (propId, period) => (await provider()).financeSummary(propId, period);
/** The monthly series the chart draws. */
export const cashflow = async (propId) => (await provider()).cashflow(propId);
/** What is coming, with a server-computed `daysUntil` that cannot drift by timezone. */
export const dues = async (propId) => (await provider()).dues(propId);

/* Agreements stay in the rent domain because they record the same tenancy relationship. */
export const myRentAgreements = async () => (await provider()).myRentAgreements();
