/**
 * HTTP rent provider — the live counterpart to `providers/mock/rentProvider.js`.
 *
 * Twenty-one endpoints across three controllers, one domain:
 *
 * ```
 *   tenancy    GET /me/tenancies · GET /tenancies · GET/PUT /me/tenant-profile
 *              GET /tenant-profiles/{mobile} · POST /tenant-profiles/verified
 *   rent       GET/POST /me/rent-payments · GET /me/rent-ledger
 *              GET/PUT /me/rent-mandate · GET/PUT /me/payout-account
 *   finances   GET/POST /me/finances/{propId}/transactions · PATCH/DELETE .../{txnId}
 *              GET/PUT .../basis · GET .../summary · GET .../cashflow · GET .../dues
 * ```
 *
 * Every route is caller-scoped: the tenant's own tenancies, the owner's own ledger. Nothing here
 * takes a mobile or an owner id to say *whose* data to read — with one deliberate exception,
 * `getTenantProfile(mobile)`, which is a screening read the owner is entitled to make.
 *
 * ## Paying rent does not settle rent
 *
 * `POST /me/rent-payments` opens a gateway order and stores the row **`due`**. The webhook settles
 * it. Nothing the browser does can. See the note at the top of `rentMapper.js`.
 */
import { del, get, patch, post, put, unwrapPage } from '../../http.js';
import { readAccessToken } from '../../../lib/auth.js';
import {
  toBasisViewModel,
  toCashflowPoint,
  toDueViewModel,
  toMandateViewModel,
  toPayoutAccountViewModel,
  toRentPaymentViewModel,
  toSummaryViewModel,
  toTenancyViewModel,
  toTenancyDeclarationViewModel,
  toTenantProfileViewModel,
  toTransactionViewModel,
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

/* ─── Rent ──────────────────────────────────────────────────────────────────────────────────── */

/** `GET /me/rent-payments` — what the caller has paid, as a tenant. Paged. */
export async function myRentPayments(page = 0, size = 20) {
  if (!signedIn()) return unwrapMapped(null, toRentPaymentViewModel, page);
  return unwrapMapped(await get('/me/rent-payments', { page, size }), toRentPaymentViewModel, page);
}

/** `GET /me/rent-ledger` — what the caller has been paid, as an owner. Paged. */
export async function rentLedger(page = 0, size = 20) {
  if (!signedIn()) return unwrapMapped(null, toRentPaymentViewModel, page);
  return unwrapMapped(await get('/me/rent-ledger', { page, size }), toRentPaymentViewModel, page);
}

/**
 * `POST /me/rent-payments` — pay this month's rent.
 *
 * **Returns a `due` payment, not a settled one.** The server computes the fee, opens a gateway
 * order and stores the row against it; only the signature-verified webhook marks it `paid`. Read
 * `settled` before telling anyone their rent is in.
 *
 * Three ways this answers 409, all of them the server protecting money:
 *   - the tenancy has no rent on record (billing zero would record a settled month for nothing);
 *   - `expectedAmount` disagrees with the current rent — optimistic concurrency, the same shape as
 *     a stale ETag, and the entire point of sending the figure the tenant was shown;
 *   - rent for this month is already paid or in progress.
 *
 * `Idempotency-Key` is derived from the tenancy and the month, not randomised: a random key per tap
 * is not idempotency, it is a second charge. A double-tapped Pay returns the original row.
 */
export async function payRent({ tenancyId, expectedAmount, method = 'upi' } = {}) {
  const month = new Date().toISOString().slice(0, 7);
  const row = await post('/me/rent-payments', {
    tenancyId,
    expectedAmount: expectedAmount == null ? undefined : Number(expectedAmount),
    method,
  }, { headers: { 'Idempotency-Key': `rent:${tenancyId}:${month}` } });
  return toRentPaymentViewModel(row);
}

/** `GET /me/rent-mandate` — the caller's auto-pay authority, or `null`. */
export async function getMandate() {
  if (!signedIn()) return null;
  return toMandateViewModel(await get('/me/rent-mandate'));
}

/** `PUT /me/rent-mandate` — authorise auto-pay. `dayOfMonth` is capped at 28 by the contract. */
export async function setMandate({ tenancyId, maxAmount, dayOfMonth, status } = {}) {
  return toMandateViewModel(await put('/me/rent-mandate', {
    tenancyId,
    maxAmount: maxAmount == null ? undefined : Number(maxAmount),
    dayOfMonth: dayOfMonth == null ? undefined : Number(dayOfMonth),
    status: status || undefined,
  }));
}

/** `GET /me/payout-account` — where the owner's rent lands. Never carries the full account number. */
export async function getPayoutAccount() {
  if (!signedIn()) return toPayoutAccountViewModel(null);
  return toPayoutAccountViewModel(await get('/me/payout-account'));
}

/**
 * `PUT /me/payout-account` — set it.
 *
 * Takes `accountNumber`; the response carries only `maskedAccount`. That asymmetry is the server
 * refusing to re-serve a bank account number to anyone, including its owner — so a call site that
 * expects to read back what it wrote will get a mask, and should.
 *
 * `ifsc` is validated against `^[A-Z]{4}0[A-Z0-9]{6}$`, so it is upper-cased here rather than
 * bouncing a lower-case entry off the server as a validation error the user cannot interpret.
 */
export async function savePayoutAccount(acc = {}) {
  return toPayoutAccountViewModel(await put('/me/payout-account', {
    accountHolder: acc.accountHolder || '',
    accountNumber: acc.accountNumber ? String(acc.accountNumber).replace(/\D/g, '') : undefined,
    ifsc: acc.ifsc ? String(acc.ifsc).toUpperCase().trim() : undefined,
    upiId: acc.upiId || undefined,
  }));
}

/* ─── Property finances (owner, per property) ───────────────────────────────────────────────── */

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
