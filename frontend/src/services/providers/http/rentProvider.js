/**
 * HTTP rent provider.
 *
 * Eighteen endpoints across four controllers, one domain:
 *
 * ```
 *   tenancy    GET /me/tenancies · GET /tenancies · GET/PUT /me/tenant-profile
 *              GET /tenant-profiles/{mobile} · POST /tenant-profiles/verified
 *   agreements GET /me/rent-agreements
 *   finances   GET/POST /me/finances/{propId}/transactions · PATCH/DELETE .../{txnId}
 *              GET/PUT .../basis · GET .../summary · GET .../cashflow · GET .../dues
 *   rentals    GET/POST /me/rentals · PATCH/DELETE /me/rentals/{rentalId}
 * ```
 *
 * Every route is caller-scoped: the tenant's own tenancies, the owner's own ledger. Nothing here
 * takes a mobile or an owner id to say *whose* data to read — with one deliberate exception,
 * `getTenantProfile(mobile)`, which is a screening read the owner is entitled to make.
 *
 * ## No rent moves through here
 *
 * `/me/rent-payments`, `/me/rent-ledger`, `/me/rent-mandate` and `/me/payout-account` used to. That
 * rail was withdrawn and those routes no longer exist on the server, so calling them would 404 —
 * they are absent here rather than kept as a dormant branch. `/pay-rent` is a static page now.
 *
 * `/me/rentals` is not that rail returning under a new name. It is a note the tenant writes about
 * a home they rent somewhere else: nothing on it moves money, nothing on it is evidence, and
 * nothing it returns may reach the Rent Passport, which claims to be verified.
 */
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

/**
 * Unwrap a `PageResponse` and map its rows in one step.
 *
 * The envelope reading itself lives in `http.js` as `unwrapPage` — this is only the mapping half.
 * It used to be a second local function *also* called `unwrapPage`, with a different signature, so
 * importing the shared one here would have silently shadowed it (D106).
 */
const unwrapMapped = (res, fn, requested = 0) => {
  const { items, ...rest } = unwrapPage(res, { page: requested });
  return { items: toList(items, fn), ...rest };
};

/* ─── Tenancies ─────────────────────────────────────────────────────────────────────────────── */

/** `GET /me/tenancies` — tenancies where the caller is the **tenant**. */
export async function myTenancies() {
  if (!signedIn()) return [];
  return toList(await get('/me/tenancies'), toTenancyViewModel);
}

/** `GET /tenancies` — tenancies on the caller's own listings, where they are the **owner**. */
export async function ownerTenancies() {
  if (!signedIn()) return [];
  return toList(await get('/tenancies'), toTenancyViewModel);
}

/* ─── Tenancy declarations (D194) ───────────────────────────────────────────────────────────── */

/**
 * `GET /properties/{propId}/tenancy-declarations` — stays claimed on one listing.
 *
 * The server decides what comes back: every claim if the caller owns the listing, their own
 * otherwise. The client does not filter, and must not — a client-side filter over a list the server
 * was willing to hand out is not a rule, it is a rendering preference.
 *
 * `propId` must be the listing's **UUID**, exactly as the review routes require: this path binds
 * `@PathVariable UUID propId` and the seam's `p.id` is the slug. Callers resolve that with
 * `p.uuid || p.id` — see `ReviewsSection.jsx`.
 *
 * The route is paged server-side (an owner's inbox is written by strangers, one row each), but this
 * returns a bare array to match the mock and to keep the caller — a listing page that renders every
 * claim it is given — from having to know. A claimant's own view is a single row on page 0; an
 * owner with more claims than one page holds is the case that needs a UI, and does not have one
 * yet, so the first page is what the section shows.
 */
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

/**
 * `GET /tenant-profiles/{mobile}` — someone else's profile, by mobile.
 *
 * The one read in this domain that names a person rather than the caller, and it is deliberate: an
 * owner screening an applicant is exactly what a tenant profile is *for*. The server decides what a
 * stranger may see; this passes the answer through rather than second-guessing it.
 *
 * 404 for a mobile with no profile is a normal answer, not an error — most people have never
 * written one.
 */
export async function tenantProfileFor(mobile) {
  const digits = String(mobile || '').replace(/\D/g, '');
  if (!signedIn() || digits.length !== 10) return null;
  try {
    return toTenantProfileViewModel(await get(`/tenant-profiles/${digits}`));
  } catch (err) {
    if (err?.status === 404) return null;
    throw err;
  }
}

/**
 * The server's own cap on one batch. Mirrored here so a long list is *paged* rather than refused —
 * a 400 in the middle of a render would cost every row its badge, including the earned ones.
 */
const VERIFIED_BATCH_SIZE = 50;

/** Last ten digits, or `''`. A masked number (`98XXXXX210`) yields five, and is therefore dropped. */
const tenDigits = (mobile) => {
  const d = String(mobile || '').replace(/\D/g, '').slice(-10);
  return d.length === 10 ? d : '';
};

/**
 * `POST /tenant-profiles/verified` — the Verified Tenant badge for a whole list at once (D114).
 *
 * A `POST` that reads: the input is a list of mobile numbers, and putting those in a query string
 * would write the identifier the contact gate exists to protect into access logs and proxy caches.
 *
 * Junk is filtered here rather than sent. The important case is a **masked** number — live offer
 * and finalization rows arrive with `98XXXXX210` until the owner approves contact (D5), and five
 * digits is not a question worth asking. Those rows simply get no badge, which is the same answer
 * the mask itself is making.
 *
 * Duplicates are collapsed before sending: the caller's list is one row per offer, not one row per
 * person, and a buyer with three offers is one question.
 */
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

/* ─── Property finances (owner, per property) ───────────────────────────────────────────────── */

/** `GET /me/rentals` — the homes the caller says they rent, most recent lease first.
 *
 * A bare array, not a page: a person rents a handful of homes in a lifetime, and the tenant
 * finance tab totals all of them, so paging would only introduce a way for the total to be wrong.
 *
 * `monthsPaid`, `totalPaid` and `fyPaid` come from the server rather than being recomputed here.
 * The April–March financial year has one definition, on the server, so the figure a tenant reads
 * on screen and the figure an export shows cannot drift apart by a month.
 */
export async function myRentals() {
  if (!signedIn()) return [];
  return toList(await get('/me/rentals'), toRentalViewModel);
}

/** `POST /me/rentals` — record a home you already rent. */
export async function addRental(rental = {}) {
  return toRentalViewModel(await post('/me/rentals', {
    address: rental.address,
    landlordName: rental.landlordName || undefined,
    monthlyRent: Number(rental.monthlyRent) || 0,
    deposit: rental.deposit === undefined || rental.deposit === '' ? undefined : Number(rental.deposit),
    leaseStart: rental.leaseStart,
    leaseEnd: rental.leaseEnd || undefined,
  }));
}

/**
 * `PATCH /me/rentals/{rentalId}` — partial by design: send only what changed.
 *
 * An absent key leaves the stored value alone; an empty string clears `landlordName`. That is the
 * same contract the transaction ledger uses, and it is why `undefined` is filtered out here rather
 * than coerced — sending `landlordName: undefined` as `""` would silently wipe a name the form
 * never showed.
 */
export async function updateRental(rentalId, patchBody = {}) {
  const body = {};
  ['address', 'landlordName', 'leaseStart', 'leaseEnd', 'status'].forEach((k) => {
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

/** `PATCH .../transactions/{txnId}` — partial by design: send only what changed. */
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

/**
 * `GET /me/finances/{propId}/summary` — income, expense, net and occupancy.
 *
 * Server-computed, and that is the point. The client's version reduced over the transaction list it
 * happened to have downloaded, and that list is paged — so it was a summary of page one, wearing
 * the label of a summary.
 *
 * `period` is forwarded rather than defaulted here: the server's `SummaryPeriods` owns what each
 * window means (its `year` is the Indian FY, 1 April), and re-deciding that on this side is exactly
 * how the card and the table came to disagree (D178). A null/`all` period is dropped from the query
 * string and the server applies its own `all`.
 */
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

/**
 * `GET /me/rent-agreements` — the caller's agreements on either side, newest first.
 *
 * The server answers for both signatories, so this needs no `party` argument: a landlord who also
 * rents a home elsewhere is one person, and the pages that read the list already narrow it by the
 * property they are showing.
 */
export async function myRentAgreements() {
  if (!signedIn()) return [];
  return toList(await get('/me/rent-agreements'), toRentAgreementViewModel);
}
