/** Server has no payment rail yet; `/pay-rent` stays a static page. */
import { del, get, patch, post, put, unwrapPage } from '../../http.js';
import { readAccessToken } from '../../../lib/auth.js';
import {
  toBasisViewModel,
  toCashflowPoint,
  toDueViewModel,
  toSummaryViewModel,
  toTenancyViewModel,
  toTenancyDeclarationViewModel,
  toTenantProfileViewModel,
  toTransactionViewModel,
  toRentAgreementViewModel,
  toRentalViewModel,
} from './rentMapper.js';

/** Answered locally for a signed-out caller: every route here is caller-scoped, so it can only 401. */
const signedIn = () => !!readAccessToken();

const toList = (rows, fn) => (Array.isArray(rows) ? rows : []).map(fn);

/** The envelope reading itself lives in `http.js` as `unwrapPage` — this is only the mapping half, under a different
 * name so it cannot shadow the shared one. */
const unwrapMapped = (res, fn, requested = 0) => {
  const { items, ...rest } = unwrapPage(res, { page: requested });
  return { items: toList(items, fn), ...rest };
};

/** `GET /me/tenancies` — tenancies where the caller is the **tenant**. */
export async function myTenancies() {
  if (!signedIn()) return [];
  return toList(await get('/me/tenancies'), toTenancyViewModel);
}

/** The server decides what comes back: every claim if the caller owns the listing, their own otherwise. The client
 * does not filter, and must not. */
export async function listTenancyDeclarations(propId) {
  if (!signedIn()) return [];
  return unwrapMapped(await get(`/properties/${encodeURIComponent(propId)}/tenancy-declarations`),
    toTenancyDeclarationViewModel).items;
}

/** `POST /properties/{propId}/tenancy-declarations` — claim a past stay. 201, starts `pending`. */
export async function declareTenancy(propId, body = {}) {
  return toTenancyDeclarationViewModel(
    await post(`/properties/${encodeURIComponent(propId)}/tenancy-declarations`, {
      livedFrom: body.livedFrom || null,
      livedTo: body.livedTo || null,
    }));
}

/** `POST /tenancy-declarations/{id}/confirm` — the owner agrees the stay happened. */
export async function confirmTenancyDeclaration(id) {
  return toTenancyDeclarationViewModel(
    await post(`/tenancy-declarations/${encodeURIComponent(id)}/confirm`, {}));
}

/** `POST /tenancy-declarations/{id}/revoke` — the owner disagrees, or takes a confirmation back. */
export async function revokeTenancyDeclaration(id) {
  return toTenancyDeclarationViewModel(
    await post(`/tenancy-declarations/${encodeURIComponent(id)}/revoke`, {}));
}

/** `GET /me/tenant-profile` — the caller's own renting CV. `null` when they have never filled it in. */
export async function myTenantProfile() {
  if (!signedIn()) return null;
  return toTenantProfileViewModel(await get('/me/tenant-profile'));
}

/** `PUT /me/tenant-profile` — save it. `score` and `verified` are server-owned and not sent. */
export async function saveTenantProfile(profile = {}) {
  return toTenantProfileViewModel(await put('/me/tenant-profile', {
    name: profile.name || undefined,
    occupation: profile.occupation || undefined,
    income: profile.income == null ? undefined : Number(profile.income),
    occupants: profile.occupants || undefined,
    moveIn: profile.moveIn || undefined,
    priorLandlord: profile.priorLandlord || undefined,
    about: profile.about || undefined,
  }));
}

/** The server's own cap on one batch. Mirrored here so a long list is *paged* rather than refused — a 400 in the
 * middle of a render would cost every row its badge, including the earned ones. */
const VERIFIED_BATCH_SIZE = 50;

/** Last ten digits, or `''`. A masked number (`98XXXXX210`) yields five, and is therefore dropped. */
const tenDigits = (mobile) => {
  const d = String(mobile || '').replace(/\D/g, '').slice(-10);
  return d.length === 10 ? d : '';
};

/** A `POST` that reads: the input is a list of mobile numbers, and putting those in a query string would write the
 * identifier the contact gate exists to protect into access logs and proxy caches. */
export async function tenantsVerified(mobiles = []) {
  const wanted = [...new Set((Array.isArray(mobiles) ? mobiles : []).map(tenDigits).filter(Boolean))];
  const verified = new Set();
  if (!signedIn() || !wanted.length) return verified;
  for (let i = 0; i < wanted.length; i += VERIFIED_BATCH_SIZE) {
    const rows = await post('/tenant-profiles/verified', {
      mobiles: wanted.slice(i, i + VERIFIED_BATCH_SIZE),
    });
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      // The server echoes the caller's own input back, so this is the same string that went out.
      if (row?.verified) verified.add(tenDigits(row.mobile));
    });
  }
  verified.delete('');
  return verified;
}

/** A bare array, not a page: a person rents a handful of homes in a lifetime, and the tenant finance tab totals all
 * of them, so paging would only introduce a way for the total to be wrong. */
export async function myRentals() {
  if (!signedIn()) return [];
  return toList(await get('/me/rentals'), toRentalViewModel);
}

/** `POST /me/rentals` — record a home you already rent. */
export async function addRental(rental = {}) {
  return toRentalViewModel(await post('/me/rentals', {
    address: rental.address,
    monthlyRent: Number(rental.monthlyRent) || 0,
    deposit: rental.deposit === undefined || rental.deposit === '' ? undefined : Number(rental.deposit),
    leaseStart: rental.leaseStart,
    leaseEnd: rental.leaseEnd || undefined,
  }));
}

/** That is the same contract the transaction ledger uses, and it is why `undefined` is filtered out here rather than
 * coerced — sending `landlordName: undefined` as `""` would silently wipe a name the form never showed. */
export async function updateRental(rentalId, patchBody = {}) {
  const body = {};
  ['address', 'leaseStart', 'leaseEnd', 'status'].forEach((k) => {
    if (patchBody[k] !== undefined) body[k] = patchBody[k];
  });
  ['monthlyRent', 'deposit'].forEach((k) => {
    if (patchBody[k] !== undefined) body[k] = patchBody[k] === '' ? null : Number(patchBody[k]);
  });
  return toRentalViewModel(await patch(`/me/rentals/${encodeURIComponent(rentalId)}`, body));
}

/** `DELETE /me/rentals/{rentalId}` — soft on the server; the row stops being listed. */
export async function deleteRental(rentalId) {
  await del(`/me/rentals/${encodeURIComponent(rentalId)}`);
}

/** `GET /me/finances/{propId}/transactions` — the property's ledger. Paged. */
export async function listTransactions(propId, page = 0, size = 50) {
  if (!signedIn() || !propId) return unwrapMapped(null, toTransactionViewModel, page);
  return unwrapMapped(
    await get(`/me/finances/${encodeURIComponent(propId)}/transactions`, { page, size }),
    toTransactionViewModel,
    page,
  );
}

/** `POST /me/finances/{propId}/transactions` — record income or an expense. */
export async function addTransaction(propId, txn = {}) {
  return toTransactionViewModel(
    await post(`/me/finances/${encodeURIComponent(propId)}/transactions`, {
      type: txn.type || 'expense',
      category: txn.category || undefined,
      amount: Number(txn.amount) || 0,
      date: txn.date,
      note: txn.note || undefined,
      recurring: txn.recurring || undefined,
    }),
  );
}

/** `PATCH .../transactions/{txnId}` — partial by design: only dirty fields cross the seam. */
export async function updateTransaction(propId, txnId, patchBody = {}) {
  const body = {};
  ['type', 'category', 'note', 'recurring', 'date'].forEach((k) => {
    if (patchBody[k] !== undefined) body[k] = patchBody[k];
  });
  if (patchBody.amount !== undefined) body.amount = Number(patchBody.amount);
  return toTransactionViewModel(
    await patch(`/me/finances/${encodeURIComponent(propId)}/transactions/${encodeURIComponent(txnId)}`, body),
  );
}

/** `DELETE .../transactions/{txnId}`. */
export async function deleteTransaction(propId, txnId) {
  await del(`/me/finances/${encodeURIComponent(propId)}/transactions/${encodeURIComponent(txnId)}`);
}

/** `GET /me/finances/{propId}/basis` — purchase price, loan, current value. `null` when unrecorded. */
export async function getBasis(propId) {
  if (!signedIn() || !propId) return null;
  return toBasisViewModel(await get(`/me/finances/${encodeURIComponent(propId)}/basis`));
}

/** `PUT /me/finances/{propId}/basis`. */
export async function setBasis(propId, basis = {}) {
  return toBasisViewModel(await put(`/me/finances/${encodeURIComponent(propId)}/basis`, {
    purchasePrice: basis.purchasePrice == null ? undefined : Number(basis.purchasePrice),
    purchaseDate: basis.purchaseDate || undefined,
    loanOutstanding: basis.loanOutstanding == null ? undefined : Number(basis.loanOutstanding),
    emi: basis.emi == null ? undefined : Number(basis.emi),
    currentValue: basis.currentValue == null ? undefined : Number(basis.currentValue),
  }));
}

/** Finance summary is server-computed, not inferred from a paged transaction list. */
export async function financeSummary(propId, period) {
  if (!signedIn() || !propId) return toSummaryViewModel(null);
  return toSummaryViewModel(await get(
    `/me/finances/${encodeURIComponent(propId)}/summary`,
    { period: period && period !== 'all' ? period : undefined },
  ));
}

/** `GET /me/finances/{propId}/cashflow` — the monthly series the chart draws. */
export async function cashflow(propId) {
  if (!signedIn() || !propId) return [];
  return toList(await get(`/me/finances/${encodeURIComponent(propId)}/cashflow`), toCashflowPoint);
}

/** `GET /me/finances/{propId}/dues` — what is coming, with a server-computed `daysUntil`. */
export async function dues(propId) {
  if (!signedIn() || !propId) return [];
  return toList(await get(`/me/finances/${encodeURIComponent(propId)}/dues`), toDueViewModel);
}

export async function myRentAgreements() {
  if (!signedIn()) return [];
  return toList(await get('/me/rent-agreements'), toRentAgreementViewModel);
}
